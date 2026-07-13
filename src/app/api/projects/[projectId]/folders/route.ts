import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyProjectOwnership, verifyFolderCreationPermission } from '@/lib/services/authorizationService';
import { withAuth } from '@/lib/auth/route-auth';

type Params = { params: Promise<{ projectId: string }> };

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const errorName = (error: unknown) =>
  error instanceof Error ? error.name : undefined;

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

async function resolveProjectId(supabase: SupabaseClient, projectIdOrName: string): Promise<string> {
  if (isUuid(projectIdOrName)) return projectIdOrName;
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('name', projectIdOrName)
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error('Project not found');
  }
  return data.id;
}

export const GET = withAuth(async function GET(
  _req,
  { params }: Params,
  { supabase, user }
) {
  const { projectId: projectIdParam } = await params;
  let projectId: string;
  try {
    projectId = await resolveProjectId(supabase, projectIdParam);
    // verify project ownership
    await verifyProjectOwnership(supabase, projectId, user.id);
  } catch (e: unknown) {
    if (errorName(e) === 'AuthorizationError') {
      return NextResponse.json({ error: errorMessage(e, 'Unauthorized') }, { status: 403 });
    }
    return NextResponse.json({ error: errorMessage(e, 'Project not found') }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[GET /api/projects/:projectId/folders] Failed to load folders:', error);
    return NextResponse.json({ error: 'Failed to load folders' }, { status: 400 });
  }

  return NextResponse.json(data ?? []);
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});

export const POST = withAuth(async function POST(
  request,
  { params }: Params,
  { supabase, user }
) {
  const body = await request.json().catch(() => null);
  const name: string = body?.name ?? '';
  const description: string | null = body?.description ?? null;
  const trimmed = name.trim();

  if (!trimmed) {
    return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
  }

  const { projectId: projectIdParam } = await params;
  let projectId: string;
  try {
    projectId = await resolveProjectId(supabase, projectIdParam);
    // Verify user has admin permission to create folder
    await verifyFolderCreationPermission(supabase, projectId, user.id);
  } catch (e: unknown) {
    if (errorName(e) === 'AuthorizationError') {
      return NextResponse.json({ error: errorMessage(e, 'Unauthorized') }, { status: 403 });
    }
    return NextResponse.json({ error: errorMessage(e, 'Project not found') }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('folders')
    .insert({
      project_id: projectId,
      name: trimmed,
      description,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A folder with this name already exists in the project' }, { status: 400 });
    }
    console.error('[POST /api/projects/:projectId/folders] Failed to create folder:', error);
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 400 });
  }

  return NextResponse.json(
    {
      id: data.id,
      project_id: projectId,
      name: trimmed,
      description: description ?? null,
    },
    { status: 201 }
  );
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});
