import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { DocumentStateConflictError } from '@/lib/documents/documentStateTypes';
import { reconcileScriptLibrariesFromDocument } from '@/lib/server/scriptDocumentReconciliationService';
import { isUuid } from '@/lib/utils/uuid';

function isToken(value: unknown): value is { epoch: number; revision: number } {
  return Boolean(value) && typeof value === 'object'
    && Number.isInteger((value as { epoch?: unknown }).epoch)
    && Number.isInteger((value as { revision?: unknown }).revision);
}

export const POST = withAuth(async function POST(request, _context, { supabase, user }) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const documentId = typeof body.documentId === 'string' ? body.documentId : '';
  if (
    !isUuid(projectId)
    || !isUuid(documentId)
    || !isToken(body.expected)
    || typeof body.previousMarkdown !== 'string'
    || typeof body.markdown !== 'string'
  ) {
    return NextResponse.json({ error: 'Invalid reconciliation request' }, { status: 400 });
  }
  try {
    const result = await reconcileScriptLibrariesFromDocument({
      supabase,
      actorUserId: user.id,
      projectId,
      documentId,
      expected: body.expected,
      previousMarkdown: body.previousMarkdown,
      markdown: body.markdown,
    });
    if (result.ambiguous) {
      return NextResponse.json({ code: 'MAPPING_AMBIGUOUS' }, { status: 409 });
    }
    return result.updatedLibraries === 0
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof DocumentStateConflictError) {
      return NextResponse.json({ code: 'DOCUMENT_CONFLICT' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 });
    }
    if (error instanceof Error && /DERIVED_TABLE_MAPPING_AMBIGUOUS/.test(error.message)) {
      return NextResponse.json({ code: 'MAPPING_AMBIGUOUS' }, { status: 409 });
    }
    console.error('script.document_reconciliation_failed', {
      documentId,
      error: error instanceof Error
        ? { name: error.name, message: error.message }
        : String(error),
    });
    return NextResponse.json({ code: 'SYNC_FAILED' }, { status: 500 });
  }
});
