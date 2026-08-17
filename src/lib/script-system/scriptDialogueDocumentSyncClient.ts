import type { DocumentStateToken } from '@/lib/documents/documentStateTypes';
import type { ScriptDialogueDocumentCommand } from './scriptDialogueDocumentSync';
import type { StoryPlotPlan } from '@/lib/story-plot/schema';

export type ScriptDialogueDocumentSyncInput = {
  projectId: string;
  libraryId: string;
  documentId: string;
  expected: DocumentStateToken;
  command: ScriptDialogueDocumentCommand;
};

export type ScriptDialogueDocumentSyncResult = {
  state: { markdown: string; token: DocumentStateToken };
  plotPlan?: StoryPlotPlan;
  updatedLibraryIds?: string[];
};

export type ScriptDialogueDocumentSyncError = Error & {
  code?: string;
  status?: number;
};

export async function syncScriptDialogueDocumentClient(
  input: ScriptDialogueDocumentSyncInput,
): Promise<ScriptDialogueDocumentSyncResult> {
  const response = await fetch('/api/script-dialogue-sync', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      typeof payload.error === 'string' ? payload.error : 'Failed to synchronize dialogue',
    ) as ScriptDialogueDocumentSyncError;
    Object.assign(error, { code: payload.code, status: response.status });
    throw error;
  }
  return payload as ScriptDialogueDocumentSyncResult;
}

export async function syncScriptDialogueDocumentWithConflictRetry(
  input: ScriptDialogueDocumentSyncInput,
  refreshExpected: () => Promise<DocumentStateToken>,
): Promise<ScriptDialogueDocumentSyncResult> {
  try {
    return await syncScriptDialogueDocumentClient(input);
  } catch (error) {
    if ((error as ScriptDialogueDocumentSyncError).code !== 'DOCUMENT_CONFLICT') throw error;
    const expected = await refreshExpected();
    return syncScriptDialogueDocumentClient({ ...input, expected });
  }
}
