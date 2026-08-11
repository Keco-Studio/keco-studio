import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withAuth } from '@/lib/auth/route-auth';
import { AuthorizationError, getUserProjectRole } from '@/lib/services/authorizationService';
import {
  CreateMapReferenceError,
  listCreateMapReferences,
  normalizeReferenceImage,
  uploadCreateMapReference,
} from '@/lib/server/createMapReferenceService';

const ProjectId = z.string().uuid();

function invalidRequest() {
  return NextResponse.json({ error: 'Invalid Create Map reference request' }, { status: 400 });
}

async function projectRoleResponse(
  supabase: Parameters<typeof getUserProjectRole>[0],
  projectId: string,
  userId: string,
  allowViewer: boolean
): Promise<NextResponse | null> {
  try {
    const { role } = await getUserProjectRole(supabase, projectId, userId);
    if (allowViewer || role === 'admin' || role === 'editor') return null;
    return NextResponse.json({ error: 'Map reference upload requires editor access' }, { status: 403 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'Project access required' }, { status: 403 });
    }
    throw error;
  }
}

export const GET = withAuth(async function GET(request, _context, { supabase, user }) {
  const projectId = ProjectId.safeParse(new URL(request.url).searchParams.get('projectId'));
  if (!projectId.success) return invalidRequest();

  const roleError = await projectRoleResponse(supabase, projectId.data, user.id, true);
  if (roleError) return roleError;

  try {
    const references = await listCreateMapReferences(projectId.data);
    return NextResponse.json({ references }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof CreateMapReferenceError ? error.code : 'reference_list_failed';
    console.error(`[GET /api/create-map/references] failed code=${code}`);
    return NextResponse.json({ error: 'Failed to list map references', code }, { status: 502 });
  }
}, {
  unauthorizedResponse: () => NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
});

export const POST = withAuth(async function POST(request, _context, { supabase, user }) {
  const form = await request.formData().catch(() => null);
  if (!form) return invalidRequest();

  const projectId = ProjectId.safeParse(form.get('projectId'));
  const file = form.get('file');
  if (!projectId.success || !(file instanceof File) || !file.type.startsWith('image/')) return invalidRequest();

  const roleError = await projectRoleResponse(supabase, projectId.data, user.id, false);
  if (roleError) return roleError;

  try {
    const normalized = await normalizeReferenceImage(file);
    const reference = await uploadCreateMapReference(projectId.data, file, user.id, normalized);
    return NextResponse.json({ reference }, {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof CreateMapReferenceError) {
      return NextResponse.json({ error: 'Invalid map reference', code: error.code }, { status: error.status });
    }
    console.error(`[POST /api/create-map/references] failed name=${error instanceof Error ? error.name : 'UnknownError'}`);
    return NextResponse.json({ error: 'Failed to upload map reference', code: 'reference_upload_failed' }, { status: 502 });
  }
}, {
  unauthorizedResponse: () => NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
});
