import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import {
  AuthorizationError,
  getUserProjectRole,
} from '@/lib/services/authorizationService';
import { deleteScriptWorkspaceDocument } from '@/lib/script-system/scriptWorkspaceService';

type Params = { params: Promise<{ projectId: string; documentId: string }> };

const unauthorized = () =>
  NextResponse.json({ error: 'unauthorized' }, { status: 401 });

function mapServiceError(error: unknown): NextResponse | null {
  const code = (error as { code?: string }).code;
  if (code === '42501') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

export const DELETE = withAuth(async function DELETE(
  _req,
  { params }: Params,
  { supabase, user }
) {
  const { projectId, documentId } = await params;
  const denied = await verifyProjectAccess(supabase, projectId, user.id);
  if (denied) return denied;

  try {
    await deleteScriptWorkspaceDocument(supabase, { projectId, documentId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) return mapped;
    console.error(
      '[DELETE /api/script-workspace/:projectId/:documentId]',
      error
    );
    return NextResponse.json(
      { error: 'Failed to remove document from workspace' },
      { status: 500 }
    );
  }
}, { unauthorizedResponse: unauthorized });
