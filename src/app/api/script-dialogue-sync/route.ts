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
  const documentId = typeof body.documentId === 'string' ? body.documentId : '';
  const expected = body.expected;
  const command = body.command;
  if (!isUuid(projectId) || !isUuid(documentId) || !isToken(expected) || !command || typeof command !== 'object') {
    return NextResponse.json({ code: 'INVALID_COMMAND', error: 'Invalid dialogue synchronization command' }, { status: 400 });
  }
  try {
    const state = await syncScriptDialogueDocument({
      supabase,
      actorUserId: user.id,
      projectId,
      documentId,
      expected,
      command: command as never,
    });
    return NextResponse.json({ state }, { status: 200 });
  } catch (error) {
    const mapped = mapScriptDialogueSyncError(error);
    const { code, status, message: publicError } = mapped;
    return NextResponse.json({ code, error: publicError }, { status });
  }
});
