import { NextResponse, NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';

type ProjectCreateRpcResult = {
  project_id?: unknown;
  projectId?: unknown;
  folder_id?: unknown;
  folderId?: unknown;
  0?: unknown;
  1?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const GET = withAuth(async function GET(
  _request,
  _context,
  { supabase, user }
) {
  // only return projects owned by the current user
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[GET /api/projects] Failed to load projects:', error);
    return NextResponse.json({ error: 'Failed to load projects' }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});

export const POST = withAuth(async function POST(
  request: NextRequest,
  _context,
  { supabase }
) {
  const body = await request.json().catch(() => null);
  const name: string = body?.name ?? '';
  const description: string | null = body?.description ?? null;

  const trimmed = name.trim();
  if (!trimmed) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('create_project_with_default_resource', {
    p_name: trimmed,
    p_description: description,
  });

  if (error) {
    console.error('[POST /api/projects] RPC error:', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 400 });
  }

  if (!data) {
    console.error('No data returned from RPC');
    return NextResponse.json({ error: 'Project creation failed: no data returned' }, { status: 500 });
  }

  // Handle different return formats:
  // 1. If function returns JSON type, Supabase RPC returns the JSON object directly (not array)
  // 2. If function returns TABLE type, Supabase RPC returns an array
  let result: ProjectCreateRpcResult;

  if (Array.isArray(data)) {
    // TABLE return type - get first element
    if (data.length === 0) {
      return NextResponse.json({ error: 'Project creation failed: empty response' }, { status: 500 });
    }
    const first = data[0];
    if (!isRecord(first)) {
      return NextResponse.json({ error: 'Project creation failed: invalid response format' }, { status: 500 });
    }
    result = first;
  } else if (isRecord(data)) {
    // JSON return type - data is already the result object
    result = data;
  } else if (typeof data === 'string') {
    // JSON string - parse it
    try {
      const parsed: unknown = JSON.parse(data);
      if (!isRecord(parsed)) {
        return NextResponse.json({ error: 'Project creation failed: invalid JSON response' }, { status: 500 });
      }
      result = parsed;
    } catch (e) {
      console.error('Failed to parse JSON string:', e);
      return NextResponse.json({ error: 'Project creation failed: invalid JSON response' }, { status: 500 });
    }
  } else {
    console.error('Unexpected data format:', data);
    return NextResponse.json({ error: 'Project creation failed: invalid response format' }, { status: 500 });
  }

  // Extract project_id and folder_id from result
  const projectId = result.project_id || result.projectId || result[0];
  const folderId = result.folder_id || result.folderId || result[1];

  if (typeof projectId !== 'string' || !projectId) {
    console.error('Missing project_id in result:', result);
    return NextResponse.json({ error: 'Project creation failed: missing project_id' }, { status: 500 });
  }

  if (typeof folderId !== 'string' || !folderId) {
    console.error('Missing folder_id in result:', result);
    return NextResponse.json({ error: 'Project creation failed: missing folder_id' }, { status: 500 });
  }

  return NextResponse.json(
    {
      id: projectId,
      default_folder_id: folderId,
      name: trimmed,
      description: description ?? null,
    },
    { status: 201 }
  );
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});
