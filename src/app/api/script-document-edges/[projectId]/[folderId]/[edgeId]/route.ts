import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { deleteScriptDocumentEdge } from '@/lib/script-system/scriptDocumentEdgeService';

type Params = { params: Promise<{ projectId: string; folderId: string; edgeId: string }> };

export const DELETE = withAuth(async function DELETE(_request, { params }: Params, { supabase, user }) {
  const { projectId, edgeId } = await params;
  try {
    await getUserProjectRole(supabase, projectId, user.id);
    await deleteScriptDocumentEdge(supabase, projectId, edgeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[DELETE /api/script-document-edges]', error);
    return NextResponse.json({ error: 'Failed to delete document relationship' }, { status: 400 });
  }
}, { unauthorizedResponse: () => NextResponse.json({ error: 'unauthorized' }, { status: 401 }) });
