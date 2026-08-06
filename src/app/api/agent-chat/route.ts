import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { runAgentTurn } from '@/lib/agent/core';
import { resolveUserRole, AgentAccessError } from '@/lib/agent/permissions';
import { getOrCreateConversation } from '@/lib/agent/conversation-store';
import { resolveConversationMeta } from '@/lib/agent/conversation-meta';
import { resolveScopeFromNavigation, contextFieldsFromScope } from '@/lib/agent/scope';
import { sseResponse } from '@/lib/agent/sse';
import { sanitizeImageUrls } from '@/lib/agent/image-url-validation';
import { isAgentSelectionContext } from '@/lib/agent/selection-context';
import { resolveCurrentDocumentContext } from '@/lib/agent/current-document-context';
import { getDocumentExportSource } from '@/lib/server/documentExportSourceService';
import { verifyDocumentExportSnapshotToken, type DocumentExportSnapshot } from '@/lib/server/documentExportSnapshotSigning';
import { buildDesignMessage } from '@/lib/design-message';
import type { DocumentTableExportContext, ToolContext } from '@/lib/agent/types';

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
  const bodyProjectId = String(body.projectId ?? '').trim();

  // A new conversation must be opened inside a project — that project (and the
  // current folder/table selection) is snapshotted as the conversation's frozen
  // scope. An existing conversation derives its project from its own binding.
  if (isNewConversation && (!bodyProjectId || !isUuid(bodyProjectId))) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  // Only accept image URLs that originate from our own public storage bucket, so
  // the agent can never be steered into fetching arbitrary external URLs.
  const imageUrls = sanitizeImageUrls(body.imageUrls, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  const selectionContext = isAgentSelectionContext(body.selectionContext)
    ? body.selectionContext
    : undefined;

  try {
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

    // For a new conversation, snapshot the scope from live navigation.
    const scopeSnapshot = isNewConversation
      ? resolveScopeFromNavigation({
          projectId: bodyProjectId,
          currentFolderId: body.currentFolderId,
          currentFolderName: body.currentFolderName,
          currentLibraryId: body.currentLibraryId,
          currentLibraryName: body.currentLibraryName,
        })
      : undefined;

    const conversation = await getOrCreateConversation(supabase, {
      conversationId: body.conversationId,
      userId: user.id,
      // Existing conversations ignore this; only used to create a new one.
      projectId: bodyProjectId,
      initialAutoExecute,
      scope: scopeSnapshot,
      ...(documentExport ? { documentExport } : {}),
    });

    // The conversation's own binding is authoritative from here on. For existing
    // conversations this ignores the request body's live navigation entirely.
    const boundMeta = resolveConversationMeta(conversation.meta);
    const boundScope = isNewConversation ? scopeSnapshot : boundMeta.scope;

    // v1: the global scope has no cross-project capability yet (see spec §7).
    if (boundScope?.level === 'global') {
      return NextResponse.json(
        { error: 'This conversation is not bound to a specific project. Open a project and start a new conversation.' },
        { status: 400 }
      );
    }

    const contextFields = contextFieldsFromScope(boundScope, conversation.project_id);
    const userRole = await resolveUserRole(supabase, contextFields.projectId, user.id);
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
    const currentDocumentContext = await resolveCurrentDocumentContext(
      supabase,
      contextFields.projectId,
      typeof body.currentDocumentId === 'string' ? body.currentDocumentId.trim() : undefined
    );

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
    const generator = runAgentTurn({
      conversationId: conversation.id,
      userMessage: message,
      signal: abortController.signal,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      selectionContext,
      toolContext,
      conversationMeta: boundMeta,
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
