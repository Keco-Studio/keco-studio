import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';

export const maxDuration = 60;

const Body = z.object({
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  projectId: z.string().uuid(),
  folderId: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(255),
  markdown: z.string().max(500_000),
}).strict();

function safeErrorDetails(error: unknown): { name: string; code?: string } {
  return {
    name: error instanceof Error ? error.name : 'UnknownError',
    code: typeof (error as { code?: unknown })?.code === 'string'
      ? (error as { code: string }).code
      : undefined,
  };
}

export const POST = withAuth(async function POST(
  request: NextRequest,
  _context,
  { user }
) {
  try {
    const body = Body.safeParse(await request.json());
    if (!body.success) return NextResponse.json({ error: 'Invalid import request' }, { status: 400 });
    const { publishImportedDocumentAsActor } = await import(
      '@/lib/server/documentImportPublishService'
    );
    const document = await publishImportedDocumentAsActor({
      documentId: body.data.documentId!,
      versionId: body.data.versionId!,
      actorUserId: user.id,
      projectId: body.data.projectId!,
      folderId: body.data.folderId ?? null,
      name: body.data.name!,
      markdown: body.data.markdown!,
    });
    return NextResponse.json({ document });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42501') return NextResponse.json({ error: 'Document import is forbidden' }, { status: 403 });
    if (code === '22023') return NextResponse.json({ error: 'Document import conflicts with an existing request' }, { status: 409 });
    console.error('[POST /api/documents/import] Import failed', safeErrorDetails(error));
    return NextResponse.json({ error: 'Document import failed' }, { status: 500 });
  }
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
});
