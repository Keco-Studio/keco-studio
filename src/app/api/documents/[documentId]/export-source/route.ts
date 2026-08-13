import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { getDocumentExportSource } from '@/lib/server/documentExportSourceService';
import { isUuid } from '@/lib/utils/uuid';

type Params = { params: Promise<{ documentId: string }> };

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

export const GET = withAuth(async function GET(
  request,
  { params }: Params,
  { supabase, user }
) {
  const { documentId } = await params;
  if (!isUuid(documentId)) {
    return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
  }

  try {
    const exportType = new URL(request.url).searchParams.get('exportType') === 'script' ? 'script' : 'table';
    const source = await getDocumentExportSource(supabase, user.id, documentId, exportType);
    return NextResponse.json(
      { source },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    const message = errorMessage(error);
    if (
      (message === 'Only admin users can export project content' || message === 'Only admin and editor users can generate conversations') ||
      (error instanceof Error && error.name === 'AuthorizationError')
    ) {
      return NextResponse.json(
        { error: message ?? 'Only admin users can export project content' },
        { status: 403 }
      );
    }
    if (message === 'Document is empty') {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message === 'Document not found or not accessible') {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    console.error('[GET /api/documents/[documentId]/export-source] Export source failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'Failed to load document export source' },
      { status: 500 }
    );
  }
});
