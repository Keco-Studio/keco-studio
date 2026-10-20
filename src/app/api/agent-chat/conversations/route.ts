import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { resolveUserRole, AgentAccessError } from '@/lib/agent/permissions';
import { listAllConversations, listConversations } from '@/lib/agent/conversation-store';
import { isAgentWorkspace, workspaceAllowsAccountScope } from '@/lib/agent/workspace';

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

  const workspaceParam = request.nextUrl.searchParams.get('workspace');
  const workspace = workspaceParam ?? 'studio';
  const projectIdParam = request.nextUrl.searchParams.get('projectId');
  const projectId = projectIdParam?.trim() || null;
  if (!isAgentWorkspace(workspace) ||
      (projectIdParam !== null && (!projectId || !isUuid(projectId))) ||
      (!projectId && !workspaceAllowsAccountScope(workspace))) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  try {
    if (projectId) await resolveUserRole(supabase, projectId, user.id);
    const limitParam = request.nextUrl.searchParams.get('limit');
    const limit = limitParam === null ? undefined : Number(limitParam);
    const conversations = await listConversations(supabase, {
      userId: user.id,
      workspace,
      projectId,
      limit,
    });
    return NextResponse.json({ conversations });
  } catch (e) {
    console.error('[GET /api/agent-chat/conversations] Failed to list conversations:', e);
    if (e instanceof AgentAccessError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to list conversations' }, { status: 400 });
  }
});
