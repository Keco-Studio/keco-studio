import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';
import { exportDocument } from '@/lib/documents/documentExportService';
import { isUuid } from '@/lib/utils/uuid';
import {
  DocumentAccessError,
  DocumentContentValidationError,
  DocumentReadOnlyError,
} from '@/lib/documents/documentStateTypes';

function safeErrorDetails(error: unknown): { name: string } {
  return { name: error instanceof Error ? error.name : 'UnknownError' };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;
  const format = request.nextUrl.searchParams.get('format') ?? 'docx';
  if (!isUuid(documentId) || (format !== 'docx' && format !== 'pdf')) {
    return NextResponse.json({ error: 'Invalid export request' }, { status: 400 });
  }

  const client = createSupabaseServerClient(request);
  try {
    const exported = await exportDocument(client, documentId, format);
    const encodedName = encodeURIComponent(exported.fileName);
    return new NextResponse(new Uint8Array(exported.bytes), {
      headers: {
        'Content-Type': exported.mediaType,
        'Content-Disposition': `attachment; filename="document.${format}"; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof DocumentContentValidationError) {
      return NextResponse.json({ error: 'Document content cannot be exported' }, { status: 400 });
    }
    if (error instanceof DocumentReadOnlyError) {
      return NextResponse.json({ error: 'Document export is forbidden' }, { status: 403 });
    }
    if (error instanceof DocumentAccessError) {
      return NextResponse.json({ error: 'Document not found or not accessible' }, { status: 404 });
    }
    console.error(
      '[GET /api/documents/[documentId]/export] Export failed',
      safeErrorDetails(error)
    );
    return NextResponse.json({ error: 'Document export failed' }, { status: 500 });
  }
}
