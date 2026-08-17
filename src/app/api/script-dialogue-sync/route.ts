import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { isUuid } from '@/lib/utils/uuid';
import { syncScriptDialogueDocument, mapScriptDialogueSyncError } from '@/lib/server/scriptDialogueDocumentSyncService';

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
    return NextResponse.json({ code: 'INVALID_COMMAND', error: 'Invalid JSON body' }, { status: 400 });
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const libraryId = typeof body.libraryId === 'string' ? body.libraryId : '';
  const documentId = typeof body.documentId === 'string' ? body.documentId : '';
  const expected = body.expected;
  const command = body.command;
  if (!isUuid(projectId) || !isUuid(libraryId) || !isUuid(documentId) || !isToken(expected) || !command || typeof command !== 'object') {
    return NextResponse.json({ code: 'INVALID_COMMAND', error: 'Invalid dialogue synchronization command' }, { status: 400 });
  }
  try {
    const result = await syncScriptDialogueDocument({
      supabase,
      actorUserId: user.id,
      projectId,
      libraryId,
      documentId,
      expected,
      command: command as never,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const mapped = mapScriptDialogueSyncError(error);
    const { code, status, message: publicError } = mapped;
    if (status >= 500) {
      const record = error && typeof error === 'object'
        ? error as { name?: unknown; message?: unknown; code?: unknown }
        : null;
      const detail = {
        ...(typeof record?.name === 'string' ? { name: record.name } : {}),
        ...(typeof record?.message === 'string' ? { message: record.message } : { message: String(error) }),
        ...(typeof record?.code === 'string' ? { code: record.code } : {}),
      };
      console.error('[script-dialogue-sync] synchronization failed', detail);
    }
    return NextResponse.json({ code, error: publicError }, { status });
  }
});
