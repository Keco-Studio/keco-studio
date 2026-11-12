import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { getUserProjectRole } from '@/lib/services/authorizationService';

type Params = { params: Promise<{ projectId: string; folderId: string }> };

export const PATCH = withAuth(async function PATCH(request, { params }: Params, { supabase, user }) {
  const { projectId, folderId } = await params;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
  try {
    const role = await getUserProjectRole(supabase, projectId, user.id);
    if (role.role !== 'admin' && role.role !== 'editor') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { data, error } = await supabase.from('folders').update({ name }).eq('id', folderId).eq('project_id', projectId).select('id, name').single();
    if (error || !data) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Failed to rename folder' }, { status: 400 });
  }
}, { unauthorizedResponse: () => NextResponse.json({ error: 'unauthorized' }, { status: 401 }) });

export const DELETE = withAuth(async function DELETE(_request, { params }: Params, { supabase, user }) {
  const { projectId, folderId } = await params;
  try {
    const role = await getUserProjectRole(supabase, projectId, user.id);
    if (role.role !== 'admin' && role.role !== 'editor') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { data: folder, error: folderError } = await supabase.from('folders').select('id, name').eq('id', folderId).eq('project_id', projectId).single();
    if (folderError || !folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    if (folder.name === 'Resources Folder') return NextResponse.json({ error: 'The default Resources Folder cannot be deleted' }, { status: 400 });
    const { error: moveError } = await supabase.from('documents').update({ folder_id: null }).eq('project_id', projectId).eq('folder_id', folderId);
    if (moveError) throw moveError;
    const { error: edgeError } = await supabase.from('script_document_edges').delete().eq('project_id', projectId).eq('folder_id', folderId);
    if (edgeError && edgeError.code !== '42P01') throw edgeError;
    const { error } = await supabase.from('folders').delete().eq('id', folderId).eq('project_id', projectId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[DELETE /api/projects/:projectId/folders/:folderId]', error);
    return NextResponse.json({ error: 'Failed to delete folder' }, { status: 400 });
  }
}, { unauthorizedResponse: () => NextResponse.json({ error: 'unauthorized' }, { status: 401 }) });
