import { NextRequest, NextResponse } from 'next/server';
import { withAuth, type AuthedRequest } from '@/lib/auth/route-auth';
import { getConversation, getMessages } from '@/lib/agent/conversation-store';

const getHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  { supabase, user }: AuthedRequest
) => {
  const { id } = await params;

  const conversation = await getConversation(supabase, id);
  if (!conversation || conversation.user_id !== user.id) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  const cursor = request.nextUrl.searchParams.get('cursor') ?? undefined;
  const limitRaw = request.nextUrl.searchParams.get('limit');
  const limit = limitRaw ? Number(limitRaw) : undefined;

  try {
    const page = await getMessages(supabase, id, { cursor, limit });
    return NextResponse.json(page);
  } catch (e) {
    console.error('[GET /api/agent-chat/conversations/:id/messages] Failed:', e);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 400 });
  }
};

export const GET = withAuth(getHandler);
