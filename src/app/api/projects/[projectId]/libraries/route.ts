import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type Params = { params: { projectId: string } };

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function resolveProjectId(supabase: any, projectIdOrName: string): Promise<string> {
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

export async function POST(request: Request, { params }: Params) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const name: string = body?.name ?? '';
  const description: string | null = body?.description ?? null;
  const folderId: string | null = body?.folderId ?? null;
  const trimmed = name.trim();

  if (!trimmed) {
    return NextResponse.json({ error: 'Library name is required' }, { status: 400 });
  }

  let projectId: string;
  try {
    projectId = await resolveProjectId(supabase, params.projectId);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Project not found' }, { status: 404 });
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
    return NextResponse.json({ error: error.message }, { status: 400 });
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
}

export async function GET(_req: Request, { params }: Params) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let projectId: string;
  try {
    projectId = await resolveProjectId(supabase, params.projectId);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Project not found' }, { status: 404 });
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
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data ?? []);
}

