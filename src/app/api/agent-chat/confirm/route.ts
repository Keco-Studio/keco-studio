import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { resumeAgentTurn } from '@/lib/agent/core';
import { resolveUserRole, AgentAccessError } from '@/lib/agent/permissions';
import { getConversation } from '@/lib/agent/conversation-store';
import { resolveConversationMeta } from '@/lib/agent/conversation-meta';
import { loadPendingAction } from '@/lib/agent/confirmation';
import { sseResponse } from '@/lib/agent/sse';
import type { ToolContext } from '@/lib/agent/types';

export const maxDuration = 120;

export const POST = withAuth(async function POST(
  request: NextRequest,
  _context,
  { supabase, user }
) {
  let body: {
    actionId?: string;
    decision?: 'approve' | 'reject';
    currentFolderId?: string;
    currentFolderName?: string;
    currentLibraryId?: string;
    currentLibraryName?: string;
    currentSectionName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const actionId = String(body.actionId ?? '').trim();
  const decision = body.decision;
  if (!actionId) {
    return NextResponse.json({ error: 'actionId is required' }, { status: 400 });
  }
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 });
  }

  try {
    const pending = await loadPendingAction(supabase, actionId);
    if (!pending) {
      return NextResponse.json({ error: 'This action has expired or was already handled.' }, { status: 404 });
    }

    const conversation = await getConversation(supabase, pending.conversationId);
    if (!conversation || conversation.user_id !== user.id) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    }

    const userRole = await resolveUserRole(supabase, conversation.project_id, user.id);

    const toolContext: ToolContext = {
      userId: user.id,
      projectId: conversation.project_id,
      conversationId: conversation.id,
      currentFolderId: body.currentFolderId,
      currentFolderName: body.currentFolderName,
      currentLibraryId: body.currentLibraryId,
      currentLibraryName: body.currentLibraryName,
      currentSectionName: body.currentSectionName,
      supabase,
      userRole,
    };

    const abortController = new AbortController();
    const generator = resumeAgentTurn({
      actionId,
      decision,
      signal: abortController.signal,
      toolContext,
      conversationMeta: resolveConversationMeta(conversation.meta),
    });

    const response = sseResponse(generator, { abortController });
    response.headers.set('X-Conversation-Id', conversation.id);
    return response;
  } catch (e) {
    console.error('[POST /api/agent-chat/confirm] Resume failed:', e);
    if (e instanceof AgentAccessError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Resume failed' }, { status: 400 });
  }
});
