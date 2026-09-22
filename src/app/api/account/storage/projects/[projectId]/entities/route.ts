import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { readProjectStorageEntities } from '@/lib/server/accountStorage';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const projectIdSchema = z.string().uuid();
const entityQuerySchema = z.object({
  query: z.string().max(200).optional(),
  sort: z.enum([
    'name_asc',
    'name_desc',
    'size_asc',
    'size_desc',
    'created_asc',
    'created_desc',
  ]).default('size_desc'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  parentFolderId: z.string().uuid().optional(),
}).strict();

type RouteContext = { params: Promise<{ projectId: string }> };

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

function isProjectForbidden(error: unknown): boolean {
  return error !== null
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'STORAGE_PROJECT_FORBIDDEN';
}

function isFolderNotFound(error: unknown): boolean {
  return error !== null
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'STORAGE_FOLDER_NOT_FOUND';
}

export const GET = withAuth<RouteContext>(async function GET(request, context, { supabase }) {
  const { projectId } = await context.params;
  if (!projectIdSchema.safeParse(projectId).success) return json({ error: 'Invalid project id' }, 400);

  const query = entityQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return json({ error: 'Invalid project entity query' }, 400);

  try {
    return json(await readProjectStorageEntities(supabase, {
      projectId,
      ...query.data,
      parentFolderId: query.data.parentFolderId ?? null,
    }));
  } catch (error) {
    if (isProjectForbidden(error)) return json({ error: 'Forbidden' }, 403);
    if (isFolderNotFound(error)) return json({ error: 'Storage folder not found' }, 404);
    console.error('[GET /api/account/storage/projects/:projectId/entities] Unable to load project entities');
    return json({ error: 'Unable to load project entities' }, 503);
  }
}, {
  unauthorizedResponse: () => json({ error: 'Please sign in to continue' }, 401),
});
