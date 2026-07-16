import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { resolveUserRole } from '@/lib/agent/permissions';
import {
  ProjectDocumentIndexAccessError,
  reindexProjectDocumentAsActor,
} from '@/lib/server/documentEmbeddingIndexService';

export const maxDuration = 60;

const BodySchema = z
  .object({
    projectId: z.string().uuid(),
    documentId: z.string().uuid(),
  })
  .strict();

export const POST = withAuth(async function POST(
  request: NextRequest,
  _context,
  { supabase, user }
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid document reindex scope' }, { status: 400 });
  }

  try {
    const role = await resolveUserRole(supabase, parsed.data.projectId, user.id);
    if (role !== 'editor' && role !== 'admin') {
      return NextResponse.json({ error: 'Editor role required for reindex.' }, { status: 403 });
    }
    const result = await reindexProjectDocumentAsActor({
      actorUserId: user.id,
      projectId: parsed.data.projectId,
      documentId: parsed.data.documentId,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Document reindex failed';
    const forbidden =
      error instanceof ProjectDocumentIndexAccessError ||
      /access|project mismatch|not readable/i.test(message);
    return NextResponse.json({ error: message }, { status: forbidden ? 403 : 500 });
  }
});
