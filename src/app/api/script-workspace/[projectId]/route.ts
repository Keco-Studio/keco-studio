import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import {
  AuthorizationError,
  getUserProjectRole,
} from '@/lib/services/authorizationService';
import {
  listScriptWorkspaceDocuments,
  upsertScriptWorkspaceDocument,
} from '@/lib/script-system/scriptWorkspaceService';

type Params = { params: Promise<{ projectId: string }> };

const unauthorized = () =>
  NextResponse.json({ error: 'unauthorized' }, { status: 401 });

function mapServiceError(error: unknown): NextResponse | null {
  const code = (error as { code?: string }).code;
  if (code === '42501') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (
    error instanceof Error &&
    error.message === 'Document not found in project'
  ) {
    return NextResponse.json(
      { error: 'Document not found in project' },
      { status: 404 }
    );
  }
  return null;
}

async function verifyProjectAccess(
  supabase: Parameters<typeof getUserProjectRole>[0],
  projectId: string,
  userId: string
): Promise<NextResponse | null> {
  try {
    await getUserProjectRole(supabase, projectId, userId);
    return null;
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    throw error;
  }
}

export const GET = withAuth(async function GET(
  _req,
  { params }: Params,
  { supabase, user }
) {
  const { projectId } = await params;
  const denied = await verifyProjectAccess(supabase, projectId, user.id);
  if (denied) return denied;

  try {
    const rows = await listScriptWorkspaceDocuments(supabase, projectId);
    if (rows.length === 0) {
      return NextResponse.json({ documents: [] });
    }

    const documentIds = rows.map((row) => row.document_id);
    const { data: docs, error } = await supabase
      .from('documents')
      .select('id, name, folder_id')
      .in('id', documentIds);

    if (error) {
      const mapped = mapServiceError(error);
      if (mapped) return mapped;
      console.error('[GET /api/script-workspace/:projectId]', error);
      return NextResponse.json(
        { error: 'Failed to load workspace documents' },
        { status: 500 }
      );
    }

    const docMap = new Map(
      (docs ?? []).map((doc) => [doc.id as string, doc as { id: string; name: string; folder_id: string | null }])
    );

    const documents = rows.map((row) => {
      const doc = docMap.get(row.document_id);
      const entry: {
        documentId: string;
        importedAt: string;
        title?: string;
        folderId?: string | null;
      } = {
        documentId: row.document_id,
        importedAt: row.imported_at,
      };
      if (doc) {
        entry.title = doc.name;
        entry.folderId = doc.folder_id;
      }
      return entry;
    });

    return NextResponse.json({ documents });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) return mapped;
    console.error('[GET /api/script-workspace/:projectId]', error);
    return NextResponse.json(
      { error: 'Failed to load workspace documents' },
      { status: 500 }
    );
  }
}, { unauthorizedResponse: unauthorized });

export const POST = withAuth(async function POST(
  request: NextRequest,
  { params }: Params,
  { supabase, user }
) {
  const { projectId } = await params;
  const denied = await verifyProjectAccess(supabase, projectId, user.id);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const documentId =
    typeof body?.documentId === 'string' ? body.documentId.trim() : '';
  if (!documentId) {
    return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
  }

  try {
    await upsertScriptWorkspaceDocument(supabase, {
      projectId,
      documentId,
      userId: user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) return mapped;
    console.error('[POST /api/script-workspace/:projectId]', error);
    return NextResponse.json(
      { error: 'Failed to add document to workspace' },
      { status: 500 }
    );
  }
}, { unauthorizedResponse: unauthorized });
