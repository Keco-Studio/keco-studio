import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  indexLibraryCell,
  indexLibraryRow,
  indexLibrarySchema,
} from '@/lib/agent/embedding-index';
import { resolveUserRole } from '@/lib/agent/permissions';
import { reindexProjectDocumentAsActor } from '@/lib/server/documentEmbeddingIndexService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

export const runtime = 'nodejs';
export const maxDuration = 60;

const uuid = z.string().uuid();
const BodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('table'), projectId: uuid, actorUserId: uuid, tableId: uuid }).strict(),
  z.object({ kind: z.literal('row'), projectId: uuid, actorUserId: uuid, rowId: uuid }).strict(),
  z.object({ kind: z.literal('document'), projectId: uuid, actorUserId: uuid, documentId: uuid }).strict(),
]);

function authorized(request: NextRequest): boolean {
  const expected = process.env.MCP_CODEC_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid reindex request' }, { status: 400 });
  }

  try {
    const admin = getSupabaseServiceRoleClient();
    const role = await resolveUserRole(admin, parsed.projectId, parsed.actorUserId);
    if (role !== 'admin' && role !== 'editor') {
      return NextResponse.json({ error: 'Project is not writable' }, { status: 403 });
    }
    if (parsed.kind === 'table') {
      await indexLibrarySchema(admin, { projectId: parsed.projectId, libraryId: parsed.tableId });
    } else if (parsed.kind === 'row') {
      const { data, error } = await admin.from('library_asset_values')
        .select('field_id').eq('asset_id', parsed.rowId).limit(200);
      if (error) throw error;
      await Promise.all([
        indexLibraryRow(admin, { projectId: parsed.projectId, assetId: parsed.rowId }),
        ...(data ?? []).map((cell) => indexLibraryCell(admin, {
          projectId: parsed.projectId,
          assetId: parsed.rowId,
          fieldId: cell.field_id as string,
        })),
      ]);
    } else {
      await reindexProjectDocumentAsActor({
        actorUserId: parsed.actorUserId,
        projectId: parsed.projectId,
        documentId: parsed.documentId,
      });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Reindex failed' }, { status: 503 });
  }
}
