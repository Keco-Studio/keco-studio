import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/agent/route-auth';
import { resolveUserRole } from '@/lib/agent/permissions';
import {
  reindexProjectConversations,
  reindexProjectLibraryCells,
} from '@/lib/agent/embedding-index';

export const maxDuration = 300;

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

/**
 * Admin-only endpoint to backfill embedding chunks for a project.
 */
export async function POST(request: NextRequest) {
  const authed = await authenticate(request);
  if (authed instanceof NextResponse) return authed;
  const { supabase, user } = authed;

  let body: { projectId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const projectId = String(body.projectId ?? '').trim();
  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  const role = await resolveUserRole(supabase, projectId, user.id);
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required for reindex.' }, { status: 403 });
  }

  try {
    const library = await reindexProjectLibraryCells(supabase, projectId);
    const chats = await reindexProjectConversations(supabase, projectId);
    return NextResponse.json({
      success: true,
      library,
      conversations: chats.conversations,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Reindex failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
