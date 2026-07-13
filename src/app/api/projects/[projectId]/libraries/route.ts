import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyProjectOwnership, verifyLibraryCreationPermission } from '@/lib/services/authorizationService';
import { withAuth } from '@/lib/auth/route-auth';

type Params = { params: Promise<{ projectId: string }> };
type LibraryListRow = {
  id: string;
  project_id: string;
  folder_id: string | null;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
};
type AssetCountRow = { library_id: string };

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

export const POST = withAuth(async function POST(
  request,
  { params }: Params,
  { supabase, user }
) {
  const body = await request.json().catch(() => null);
  const name: string = body?.name ?? '';
  const description: string | null = body?.description ?? null;
  const folderId: string | null = body?.folderId ?? null;
  const trimmed = name.trim();

  if (!trimmed) {
    return NextResponse.json({ error: 'Library name is required' }, { status: 400 });
  }

  const { projectId: projectIdParam } = await params;
  let projectId: string;
  try {
    projectId = await resolveProjectId(supabase, projectIdParam);
    // Verify user has admin permission to create library
    await verifyLibraryCreationPermission(supabase, projectId, user.id);
  } catch (e: unknown) {
    if (errorName(e) === 'AuthorizationError') {
      return NextResponse.json({ error: errorMessage(e, 'Unauthorized') }, { status: 403 });
    }
    return NextResponse.json({ error: errorMessage(e, 'Project not found') }, { status: 404 });
  }

  // Validate folder_id if provided
  let validatedFolderId: string | null = null;
  if (folderId) {
    if (!isUuid(folderId)) {
      return NextResponse.json({ error: 'Invalid folder ID format' }, { status: 400 });
    }
    
    // Check if folder exists and belongs to the same project
    const { data: folderData, error: folderError } = await supabase
      .from('folders')
      .select('project_id')
      .eq('id', folderId)
      .single();
      
    if (folderError || !folderData || folderData.project_id !== projectId) {
      return NextResponse.json({ error: 'Folder not found or does not belong to the project' }, { status: 400 });
    }
    
    validatedFolderId = folderId;
  }

  const { data, error } = await supabase
    .from('libraries')
    .insert({
      project_id: projectId,
      folder_id: validatedFolderId,
      name: trimmed,
      description,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A library with this name already exists in the project or folder' }, { status: 400 });
    }
    console.error('[POST /api/projects/:projectId/libraries] Failed to create library:', error);
    return NextResponse.json({ error: 'Failed to create library' }, { status: 400 });
  }

  return NextResponse.json(
    {
      id: data.id,
      project_id: projectId,
      folder_id: validatedFolderId,
      name: trimmed,
      description: description ?? null,
    },
    { status: 201 }
  );
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});

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

  // Get URL parameters for filtering
  const url = new URL(_req.url);
  const folderId = url.searchParams.get('folderId');

  let query = supabase
    .from('libraries')
    .select('*')
    .eq('project_id', projectId);

  if (folderId) {
    if (!isUuid(folderId)) {
      return NextResponse.json({ error: 'Invalid folder ID format' }, { status: 400 });
    }
    query = query.eq('folder_id', folderId);
  } else {
    // Use filter with null check instead of .is() which might not work correctly
    query = query.filter('folder_id', 'is', null);
  }

  const { data, error } = await query.order('created_at', { ascending: true });

  if (error) {
    console.error('Error listing libraries:', error);
    console.error('Query params:', { projectId, folderId });
    return NextResponse.json({ error: 'Failed to load libraries' }, { status: 400 });
  }

  const libraries = (data ?? []) as LibraryListRow[];

  // If no libraries, return empty array with asset_count
  if (libraries.length === 0) {
    return NextResponse.json(libraries.map((lib) => ({ ...lib, asset_count: 0 })));
  }

  // Get asset counts for all libraries in one query
  const libraryIds = libraries.map((lib) => lib.id);
  const { data: assetCounts, error: countError } = await supabase
    .from('library_assets')
    .select('library_id')
    .in('library_id', libraryIds);

  if (countError) {
    console.error('Error fetching asset counts:', countError);
    // If count query fails, return libraries with 0 counts
    return NextResponse.json(libraries.map((lib) => ({ ...lib, asset_count: 0 })));
  }

  // Count assets per library
  const countMap = new Map<string, number>();
  ((assetCounts ?? []) as AssetCountRow[]).forEach((asset) => {
    const currentCount = countMap.get(asset.library_id) || 0;
    countMap.set(asset.library_id, currentCount + 1);
  });

  // Merge asset counts into libraries
  const librariesWithCounts = libraries.map((lib) => ({
    ...lib,
    asset_count: countMap.get(lib.id) || 0,
  }));

  return NextResponse.json(librariesWithCounts);
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});
