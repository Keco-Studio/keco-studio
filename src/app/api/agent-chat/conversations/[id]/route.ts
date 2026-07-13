import { NextRequest, NextResponse } from 'next/server';
import { withAuth, type AuthedRequest } from '@/lib/auth/route-auth';
import { getConversation, deleteConversation } from '@/lib/agent/conversation-store';

const deleteHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  { supabase, user }: AuthedRequest
) => {
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
};

export const DELETE = withAuth(deleteHandler);
