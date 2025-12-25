import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
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

  const trimmed = name.trim();
  if (!trimmed) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('create_project_with_default_resource', {
    p_name: trimmed,
    p_description: description,
  });

  console.log('RPC full response:', { data, error });
  console.log('Data type:', Array.isArray(data) ? 'array' : typeof data);

  if (error) {
    console.error('RPC error:', error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data) {
    console.error('No data returned from RPC');
    return NextResponse.json({ error: 'Project creation failed: no data returned' }, { status: 500 });
  }

  // Handle different return formats:
  // 1. If function returns JSON type, Supabase RPC returns the JSON object directly (not array)
  // 2. If function returns TABLE type, Supabase RPC returns an array
  let result: any;
  
  if (Array.isArray(data)) {
    // TABLE return type - get first element
    if (data.length === 0) {
      return NextResponse.json({ error: 'Project creation failed: empty response' }, { status: 500 });
    }
    result = data[0];
  } else if (typeof data === 'object' && data !== null) {
    // JSON return type - data is already the result object
    result = data;
  } else if (typeof data === 'string') {
    // JSON string - parse it
    try {
      result = JSON.parse(data);
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

  if (!projectId) {
    console.error('Missing project_id in result:', result);
    return NextResponse.json({ error: 'Project creation failed: missing project_id' }, { status: 500 });
  }

  if (!folderId) {
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
}

