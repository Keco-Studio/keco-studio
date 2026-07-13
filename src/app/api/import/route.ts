import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { importLibraryFromFile } from '@/lib/services/importService';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['csv', 'xlsx', 'xls']);

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export const POST = withAuth(async function POST(
  request,
  _context,
  { supabase, user }
) {
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
    return NextResponse.json({ error: 'File must be .csv or .xlsx' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importLibraryFromFile(supabase, {
      userId: user.id,
      projectId,
      folderId,
      libraryName,
      fileBuffer: buffer,
      fileName: file.name,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string; code?: string };
    console.error('[POST /api/import] Import failed:', e);
    if (err.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const msg = err.message || 'Import failed';
    if (msg.toLowerCase().includes('already exists')) {
      return NextResponse.json(
        { error: 'A library with this name already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Import failed' }, { status: 400 });
  }
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});
