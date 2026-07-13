import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/agent/route-auth';
import { getConversation, deleteConversation } from '@/lib/agent/conversation-store';

export async function DELETE(
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

  try {
    await deleteConversation(supabase, id);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[DELETE /api/agent-chat/conversations/:id] Failed:', e);
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 400 });
  }
}
