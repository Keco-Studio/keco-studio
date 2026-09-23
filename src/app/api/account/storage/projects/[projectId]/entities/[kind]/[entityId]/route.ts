import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { readProjectStorageEntityDetail } from '@/lib/server/accountStorage';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const paramsSchema = z.object({
  projectId: z.string().uuid(),
  kind: z.enum(['table', 'document', 'assets']),
  entityId: z.string().uuid(),
});
type RouteContext = { params: Promise<{ projectId: string; kind: string; entityId: string }> };

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === 'object' && 'code' in error ? error.code : null;
}

export const GET = withAuth<RouteContext>(async function GET(_request, context, { supabase }) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return json({ error: 'Invalid storage entity' }, 400);

  try {
    return json(await readProjectStorageEntityDetail(supabase, {
      projectId: params.data.projectId!,
      kind: params.data.kind!,
      entityId: params.data.entityId!,
    }));
  } catch (error) {
    if (errorCode(error) === 'STORAGE_PROJECT_FORBIDDEN') return json({ error: 'Forbidden' }, 403);
    if (errorCode(error) === 'STORAGE_ENTITY_NOT_FOUND') return json({ error: 'Storage entity not found' }, 404);
    console.error('[GET /api/account/storage/projects/:projectId/entities/:kind/:entityId] Unable to load entity details');
    return json({ error: 'Unable to load storage entity details' }, 503);
  }
}, {
  unauthorizedResponse: () => json({ error: 'Please sign in to continue' }, 401),
});
