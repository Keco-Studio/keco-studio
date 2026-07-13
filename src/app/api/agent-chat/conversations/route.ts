import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { resolveUserRole, AgentAccessError } from '@/lib/agent/permissions';
import { listAllConversations, listConversations } from '@/lib/agent/conversation-store';

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

export const GET = withAuth(async function GET(
  request: NextRequest,
  _context,
  { supabase, user }
) {
  const scope = String(request.nextUrl.searchParams.get('scope') ?? '').trim();
  if (scope === 'all') {
    try {
      const conversations = await listAllConversations(supabase, user.id);
      return NextResponse.json({ conversations });
    } catch (e) {
      console.error('[GET /api/agent-chat/conversations] Failed to list conversations:', e);
      return NextResponse.json(
        { error: 'Failed to list conversations' },
        { status: 400 }
      );
    }
  }

  const projectId = String(request.nextUrl.searchParams.get('projectId') ?? '').trim();
  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  try {
    await resolveUserRole(supabase, projectId, user.id);
    const conversations = await listConversations(supabase, projectId, user.id);
    return NextResponse.json({ conversations });
  } catch (e) {
    console.error('[GET /api/agent-chat/conversations] Failed to list conversations:', e);
    if (e instanceof AgentAccessError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to list conversations' }, { status: 400 });
  }
});
