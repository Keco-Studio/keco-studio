import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import {
  createScriptDocumentEdge,
  listScriptDocumentEdges,
} from '@/lib/script-system/scriptDocumentEdgeService';

type Params = { params: Promise<{ projectId: string; folderId: string }> };

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 });

async function verifyAccess(supabase: Parameters<typeof getUserProjectRole>[0], projectId: string, userId: string) {
  await getUserProjectRole(supabase, projectId, userId);
}

async function folderDocuments(supabase: Parameters<typeof getUserProjectRole>[0], projectId: string, folderId: string) {
  const { data: folder, error: folderError } = await supabase
    .from('folders')
    .select('id, name')
    .eq('id', folderId)
    .eq('project_id', projectId)
    .single();
  if (folderError || !folder) throw new Error('Folder not found in project');
  const { data: memberships, error: membershipError } = await supabase
    .from('script_workspace_documents')
    .select('document_id')
    .eq('project_id', projectId);
  if (membershipError) throw membershipError;
  const documentIds = (memberships ?? []).map((row) => row.document_id as string);
  if (documentIds.length === 0) return { folderName: folder.name as string, documents: [] };
  const { data, error } = await supabase
    .from('documents')
    .select('id, name, folder_id')
    .in('id', documentIds)
    .eq('folder_id', folderId);
  if (error) throw error;
  return {
    folderName: folder.name as string,
    documents: (data ?? []).map((document) => ({
      id: document.id as string,
      name: (document.name as string) || 'Untitled document',
      folderId,
    })),
  };
}

export const GET = withAuth(async function GET(_request, { params }: Params, { supabase, user }) {
  const { projectId, folderId } = await params;
  try {
    await verifyAccess(supabase, projectId, user.id);
    const folderData = await folderDocuments(supabase, projectId, folderId);
    let edges = [];
    try {
      edges = await listScriptDocumentEdges(supabase, projectId, folderId);
    } catch (error) {
      // Keep the document graph usable while an older environment is waiting
      // for the script_document_edges migration.
      console.warn('[GET /api/script-document-edges] Relationship table unavailable', error);
    }
    return NextResponse.json({ ...folderData, edges });
  } catch (error) {
    console.error('[GET /api/script-document-edges]', error);
    return NextResponse.json({ error: 'Failed to load document branch structure' }, { status: 400 });
  }
}, { unauthorizedResponse: unauthorized });

export const POST = withAuth(async function POST(request: NextRequest, { params }: Params, { supabase, user }) {
  const { projectId, folderId } = await params;
  const body = await request.json().catch(() => null);
  const parentDocumentId = typeof body?.parentDocumentId === 'string' ? body.parentDocumentId.trim() : '';
  const childDocumentId = typeof body?.childDocumentId === 'string' ? body.childDocumentId.trim() : '';
  if (!parentDocumentId || !childDocumentId) {
    return NextResponse.json({ error: 'parentDocumentId and childDocumentId are required' }, { status: 400 });
  }
  try {
    await verifyAccess(supabase, projectId, user.id);
    const folderData = await folderDocuments(supabase, projectId, folderId);
    const documentIds = new Set(folderData.documents.map((document) => document.id));
    if (!documentIds.has(parentDocumentId) || !documentIds.has(childDocumentId)) {
      return NextResponse.json({ error: 'Both documents must belong to this folder and Script workspace' }, { status: 400 });
    }
    const edge = await createScriptDocumentEdge(supabase, {
      projectId,
      folderId,
      parentDocumentId,
      childDocumentId,
      branchName: typeof body?.branchName === 'string' ? body.branchName : null,
    });
    return NextResponse.json({ edge }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Document edge would create a cycle') {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const code = (error as { code?: string }).code;
    if (code === '23505') {
      const { data: existing } = await supabase
        .from('script_document_edges')
        .select('id, project_id, folder_id, parent_document_id, child_document_id, branch_name, sort_order, created_at')
        .eq('project_id', projectId)
        .eq('folder_id', folderId)
        .eq('parent_document_id', parentDocumentId)
        .eq('child_document_id', childDocumentId)
        .maybeSingle();
      if (existing) return NextResponse.json({ edge: existing, existing: true });
      return NextResponse.json({ error: 'This document relationship already exists' }, { status: 409 });
    }
    console.error('[POST /api/script-document-edges]', error);
    return NextResponse.json({ error: 'Failed to create document relationship' }, { status: 400 });
  }
}, { unauthorizedResponse: unauthorized });
