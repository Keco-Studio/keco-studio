import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { runAgentTurn } from '@/lib/agent/core';
import { resolveUserRole, AgentAccessError } from '@/lib/agent/permissions';
import { getConversation, getOrCreateConversation } from '@/lib/agent/conversation-store';
import { resolveConversationMeta } from '@/lib/agent/conversation-meta';
import { resolveScopeFromNavigation, contextFieldsFromScope } from '@/lib/agent/scope';
import { sseResponse } from '@/lib/agent/sse';
import { sanitizeImageUrls } from '@/lib/agent/image-url-validation';
import { isAgentSelectionContext } from '@/lib/agent/selection-context';
import { resolveCurrentDocumentContext } from '@/lib/agent/current-document-context';
import { getDocumentExportSource } from '@/lib/server/documentExportSourceService';
import { verifyDocumentExportSnapshotToken, type DocumentExportSnapshot } from '@/lib/server/documentExportSnapshotSigning';
import { buildDesignMessage } from '@/lib/design-message';
import { createAuthenticatedAiUsageRecorder } from '@/lib/ai-usage/recorder';
import { isAgentWorkspace, workspaceAllowsAccountScope } from '@/lib/agent/workspace';
import type { AgentWorkspace, DocumentTableExportContext, ToolContext } from '@/lib/agent/types';

// Multi-step ReAct turns (query → create → confirm chains) can exceed 60s.
export const maxDuration = 120;

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

export const POST = withAuth(async function POST(
  request: NextRequest,
  _context,
  { supabase, user }
) {
  let body: {
    conversationId?: string;
    projectId?: string;
    message?: string;
    imageUrls?: unknown;
    selectionContext?: unknown;
    currentDocumentId?: string;
    currentFolderId?: string;
    currentFolderName?: string;
    currentLibraryId?: string;
    currentLibraryName?: string;
    workspace?: AgentWorkspace;
    /** Default for newly created conversations (from user preference). */
    autoExecute?: unknown;
    documentExport?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const clientMessage = String(body.message ?? '').trim();
  if (!clientMessage) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  const isNewConversation = !body.conversationId;
  if (isNewConversation && body.projectId !== undefined && typeof body.projectId !== 'string') {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  const bodyProjectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (isNewConversation && body.workspace !== undefined && !isAgentWorkspace(body.workspace)) {
    return NextResponse.json({ error: 'Invalid workspace' }, { status: 400 });
  }
  const liveWorkspace: AgentWorkspace = isAgentWorkspace(body.workspace) ? body.workspace : 'studio';

  // A new conversation snapshots the workspace and optional project from live
  // navigation. Existing conversations use their persisted binding below.
  if (isNewConversation && (bodyProjectId ? !isUuid(bodyProjectId) : !workspaceAllowsAccountScope(liveWorkspace))) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  // Only accept image URLs that originate from our own public storage bucket, so
  // the agent can never be steered into fetching arbitrary external URLs.
  const imageUrls = sanitizeImageUrls(body.imageUrls, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  const selectionContext = isAgentSelectionContext(body.selectionContext)
    ? body.selectionContext
    : undefined;

  try {
    const storedConversation = body.conversationId
      ? await getConversation(supabase, body.conversationId)
      : null;
    if (body.conversationId && (!storedConversation || storedConversation.user_id !== user.id)) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    }
    const requestedProjectId = bodyProjectId || null;
    const initialAutoExecute =
      typeof body.autoExecute === 'boolean' ? body.autoExecute : false;

    let documentExport: DocumentTableExportContext | undefined;
    let documentSnapshot: DocumentExportSnapshot | undefined;
    if (isNewConversation && body.documentExport !== undefined) {
      const requested = body.documentExport as {
        sourceDocumentId?: unknown;
        exportType?: unknown;
        snapshotToken?: unknown;
      };
      const sourceDocumentId =
        typeof requested?.sourceDocumentId === 'string'
          ? requested.sourceDocumentId.trim()
          : '';
      const snapshotToken =
        typeof requested?.snapshotToken === 'string' ? requested.snapshotToken.trim() : '';
      if (requested?.exportType !== 'table' || !isUuid(sourceDocumentId) || !snapshotToken) {
        return NextResponse.json({ error: 'Invalid documentExport' }, { status: 400 });
      }

      let source;
      try {
        source = await getDocumentExportSource(supabase, user.id, sourceDocumentId);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === 'Only admin users can export project content' ||
            error.name === 'AuthorizationError')
        ) {
          return NextResponse.json(
            { error: 'Only admin users can export project content' },
            { status: 403 }
          );
        }
        throw error;
      }
      if (source.projectId !== bodyProjectId) {
        return NextResponse.json(
          { error: 'Source document not found in this project' },
          { status: 400 }
        );
      }
      try {
        documentSnapshot = verifyDocumentExportSnapshotToken(snapshotToken);
      } catch {
        return NextResponse.json({ error: 'Invalid document export snapshot' }, { status: 400 });
      }
      if (
        documentSnapshot.documentId !== sourceDocumentId ||
        documentSnapshot.projectId !== bodyProjectId
      ) {
        return NextResponse.json({ error: 'Invalid document export snapshot' }, { status: 400 });
      }
      documentExport = { sourceDocumentId, exportType: 'table', snapshotToken };
    }

    // Resource hints are untrusted navigation data. Only bind resources that
    // belong to the same project as this conversation.
    let folderHint: { id: string; name: string } | undefined;
    let libraryHint: { id: string; name: string } | undefined;
    if (isNewConversation && requestedProjectId && body.currentFolderId) {
      if (typeof body.currentFolderId !== 'string' || !isUuid(body.currentFolderId)) {
        return NextResponse.json({ error: 'Invalid folder context' }, { status: 400 });
      }
      const { data, error } = await supabase.from('folders').select('id, name')
        .eq('id', body.currentFolderId).eq('project_id', requestedProjectId).maybeSingle();
      if (error || !data) return NextResponse.json({ error: 'Invalid folder context' }, { status: 400 });
      folderHint = data;
    }
    if (isNewConversation && requestedProjectId && body.currentLibraryId) {
      if (typeof body.currentLibraryId !== 'string' || !isUuid(body.currentLibraryId)) {
        return NextResponse.json({ error: 'Invalid library context' }, { status: 400 });
      }
      const { data, error } = await supabase.from('libraries').select('id, name')
        .eq('id', body.currentLibraryId).eq('project_id', requestedProjectId).maybeSingle();
      if (error || !data) return NextResponse.json({ error: 'Invalid library context' }, { status: 400 });
      libraryHint = data;
    }

    // For a new conversation, snapshot the scope from verified navigation.
    const scopeSnapshot = isNewConversation
      ? resolveScopeFromNavigation({
          projectId: requestedProjectId ?? undefined,
          workspace: liveWorkspace,
          currentFolderId: folderHint?.id,
          currentFolderName: folderHint?.name,
          currentLibraryId: libraryHint?.id,
          currentLibraryName: libraryHint?.name,
        })
      : undefined;

    const conversation = storedConversation ?? await getOrCreateConversation(supabase, {
      userId: user.id,
      projectId: requestedProjectId,
      initialAutoExecute,
      scope: scopeSnapshot,
      ...(documentExport ? { documentExport } : {}),
    });

    // The conversation's own binding is authoritative from here on. For existing
    // conversations this ignores the request body's live navigation entirely.
    const boundMeta = resolveConversationMeta(conversation.meta);
    const boundScope = isNewConversation ? scopeSnapshot : boundMeta.scope;

    const contextFields = contextFieldsFromScope(boundScope, conversation.project_id);
    if (!contextFields.projectId && !workspaceAllowsAccountScope(contextFields.workspace)) {
      return NextResponse.json(
        { error: 'Select a project before using Studio.' },
        { status: 400 }
      );
    }

    const userRole = contextFields.projectId
      ? await resolveUserRole(supabase, contextFields.projectId, user.id)
      : undefined;
    if (boundMeta.documentExport && userRole !== 'admin') {
      throw new AgentAccessError('Only admin users can export project content');
    }
    if (boundMeta.documentExport) {
      try {
        documentSnapshot = verifyDocumentExportSnapshotToken(boundMeta.documentExport.snapshotToken ?? '');
      } catch {
        return NextResponse.json({ error: 'Invalid document export snapshot' }, { status: 400 });
      }
      if (
        documentSnapshot.documentId !== boundMeta.documentExport.sourceDocumentId ||
        documentSnapshot.projectId !== conversation.project_id
      ) {
        return NextResponse.json({ error: 'Invalid document export snapshot' }, { status: 400 });
      }
    }
    const currentDocumentContext = contextFields.projectId
      ? await resolveCurrentDocumentContext(
          supabase,
          contextFields.projectId,
          typeof body.currentDocumentId === 'string' ? body.currentDocumentId.trim() : undefined
        )
      : {};

    const toolContext: ToolContext = {
      userId: user.id,
      conversationId: conversation.id,
      supabase,
      userRole,
      documentExport: boundMeta.documentExport,
      ...contextFields,
      ...currentDocumentContext,
    };

    const message = documentSnapshot
      ? buildDesignMessage({
          fileName: documentSnapshot.documentName,
          documentText: documentSnapshot.markdown,
          intent: 'tables',
          documentId: documentSnapshot.documentId,
          sourceKind: 'project-document',
        })
      : clientMessage;

    const abortController = new AbortController();
    const turnId = crypto.randomUUID();
    const generator = runAgentTurn({
      conversationId: conversation.id,
      userMessage: message,
      signal: abortController.signal,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      selectionContext,
      toolContext,
      conversationMeta: boundMeta,
      turnId,
      usageBinding: {
        context: {
          actorUserId: user.id,
          ...(conversation.project_id ? { projectId: conversation.project_id } : {}),
          feature: 'agent_chat',
          operation: 'react_iteration',
          correlationId: `agent_turn:${turnId}`,
        },
        recorder: createAuthenticatedAiUsageRecorder(supabase),
      },
    });

    const response = sseResponse(generator, { abortController });
    // Surface the (possibly new) conversation id to the client.
    response.headers.set('X-Conversation-Id', conversation.id);
    return response;
  } catch (e) {
    console.error('[POST /api/agent-chat] Agent request failed:', e);
    if (e instanceof AgentAccessError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const err = e as { name?: string; message?: string };
    if (err.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Agent request failed' }, { status: 400 });
  }
});
