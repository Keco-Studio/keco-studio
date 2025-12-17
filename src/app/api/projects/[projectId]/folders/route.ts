import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

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

export async function GET(_req: Request, { params }: Params) {
  const supabase = createRouteHandlerClient({ cookies });
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

  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request, { params }: Params) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const name: string = body?.name ?? '';
  const description: string | null = body?.description ?? null;
  const trimmed = name.trim();

  if (!trimmed) {
    return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
  }

  let projectId: string;
  try {
    projectId = await resolveProjectId(supabase, params.projectId);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Project not found' }, { status: 404 });
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
    return NextResponse.json({ error: error.message }, { status: 400 });
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
}