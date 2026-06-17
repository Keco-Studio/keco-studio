import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/agent/route-auth';
import { runAgentTurn } from '@/lib/agent/core';
import { resolveUserRole, AgentAccessError } from '@/lib/agent/permissions';
import { getOrCreateConversation } from '@/lib/agent/conversation-store';
import { resolveConversationMeta } from '@/lib/agent/conversation-meta';
import { sseResponse } from '@/lib/agent/sse';
import { sanitizeImageUrls } from '@/lib/agent/image-url-validation';
import type { ToolContext } from '@/lib/agent/types';

// Multi-step ReAct turns (query → create → confirm chains) can exceed 60s.
export const maxDuration = 120;

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

export async function POST(request: NextRequest) {
  const authed = await authenticate(request);
  if (authed instanceof NextResponse) return authed;
  const { supabase, user } = authed;

  let body: {
    conversationId?: string;
    projectId?: string;
    message?: string;
    imageUrls?: unknown;
    currentFolderId?: string;
    currentFolderName?: string;
    currentLibraryId?: string;
    currentLibraryName?: string;
    currentSectionName?: string;
    /** Default for newly created conversations (from user preference). */
    autoExecute?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const projectId = String(body.projectId ?? '').trim();
  const message = String(body.message ?? '').trim();
  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  // Only accept image URLs that originate from our own public storage bucket, so
  // the agent can never be steered into fetching arbitrary external URLs.
  const imageUrls = sanitizeImageUrls(body.imageUrls, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');

  try {
    const userRole = await resolveUserRole(supabase, projectId, user.id);
    const initialAutoExecute =
      typeof body.autoExecute === 'boolean' ? body.autoExecute : true;

    const conversation = await getOrCreateConversation(supabase, {
      conversationId: body.conversationId,
      userId: user.id,
      projectId,
      initialAutoExecute,
    });

    const toolContext: ToolContext = {
      userId: user.id,
      projectId,
      conversationId: conversation.id,
      currentFolderId: body.currentFolderId,
      currentFolderName: body.currentFolderName,
      currentLibraryId: body.currentLibraryId,
      currentLibraryName: body.currentLibraryName,
      currentSectionName: body.currentSectionName,
      supabase,
      userRole,
    };

    const generator = runAgentTurn({
      conversationId: conversation.id,
      userMessage: message,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      toolContext,
      conversationMeta: resolveConversationMeta(conversation.meta),
    });

    const response = sseResponse(generator);
    // Surface the (possibly new) conversation id to the client.
    response.headers.set('X-Conversation-Id', conversation.id);
    return response;
  } catch (e) {
    if (e instanceof AgentAccessError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    const err = e as { name?: string; message?: string };
    if (err.name === 'AuthorizationError') {
      return NextResponse.json({ error: err.message || 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: err.message || 'Agent request failed' }, { status: 400 });
  }
}
