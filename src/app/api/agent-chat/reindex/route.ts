import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { resolveUserRole } from '@/lib/agent/permissions';
import {
  reindexProjectConversations,
  reindexProjectLibraryEmbeddings,
} from '@/lib/agent/embedding-index';
import { reindexProjectDocumentsAsActor } from '@/lib/server/documentEmbeddingIndexService';

export const maxDuration = 300;

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

/**
 * Admin-only endpoint to backfill embedding chunks for a project.
 */
export const POST = withAuth(async function POST(
  request: NextRequest,
  _context,
  { supabase, user }
) {
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
    const library = await reindexProjectLibraryEmbeddings(supabase, projectId);
    const chats = await reindexProjectConversations(supabase, projectId);
    const projectDocuments = await reindexProjectDocumentsAsActor({
      actorUserId: user.id,
      projectId,
    });
    return NextResponse.json({
      success: true,
      library,
      conversations: chats.conversations,
      projectDocuments,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Reindex failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
