import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';
import { importScriptFromFile } from '@/lib/services/scriptImportService';
import { resolveScriptTextForImport } from '@/lib/services/scriptConversionService';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const maxDuration = 120;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['txt', 'md']);

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const supabase = authHeader
    ? createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : createSupabaseServerClient(request);

  const { data: { user }, error: authError } = authHeader
    ? await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    : await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Please sign in to continue' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const projectId = String(formData.get('projectId') ?? '').trim();
  const folderId = String(formData.get('folderId') ?? '').trim();
  const libraryName = String(formData.get('libraryName') ?? '').trim();
  const file = formData.get('file');

  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  if (!folderId || !isUuid(folderId)) {
    return NextResponse.json({ error: 'Invalid folderId' }, { status: 400 });
  }
  if (!libraryName) {
    return NextResponse.json({ error: 'Library name is required' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'File is required' }, { status: 400 });
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: 'File must be .txt or .md' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 400 });
  }

  try {
    const fileContent = await file.text();
    const resolved = await resolveScriptTextForImport(fileContent);
    const result = await importScriptFromFile(supabase, {
      userId: user.id,
      projectId,
      folderId,
      libraryName,
      fileContent: resolved.fullText,
      fileName: file.name,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string; code?: string };
    if (err.name === 'AuthorizationError') {
      return NextResponse.json({ error: err.message || 'Forbidden' }, { status: 403 });
    }
    const msg = err.message || 'Import failed';
    if (msg.toLowerCase().includes('already exists')) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
