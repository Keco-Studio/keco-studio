import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/agent/route-auth';
import { getConversation, updateConversationMeta } from '@/lib/agent/conversation-store';
import { resolveConversationMeta } from '@/lib/agent/conversation-meta';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authed = await authenticate(request);
  if (authed instanceof NextResponse) return authed;
  const { supabase, user } = authed;

  const { id } = await params;
  const conversation = await getConversation(supabase, id);
  if (!conversation || conversation.user_id !== user.id) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  return NextResponse.json({ meta: conversation.meta });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authed = await authenticate(request);
  if (authed instanceof NextResponse) return authed;
  const { supabase, user } = authed;

  const { id } = await params;

  let body: { autoExecute?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.autoExecute !== 'boolean') {
    return NextResponse.json({ error: 'autoExecute must be a boolean' }, { status: 400 });
  }

  const conversation = await getConversation(supabase, id);
  if (!conversation || conversation.user_id !== user.id) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  try {
    const meta = await updateConversationMeta(supabase, id, resolveConversationMeta({ autoExecute: body.autoExecute }));
    return NextResponse.json({ meta });
  } catch (e) {
    console.error('[PATCH /api/agent-chat/conversations/:id/meta] Failed:', e);
    return NextResponse.json({ error: 'Failed to update conversation settings' }, { status: 400 });
  }
}
