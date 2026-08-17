import type { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentStateToken } from '@/lib/documents/documentStateTypes';
import { requestLibraryReconciliation } from '@/lib/realtime/cell-replacement-broadcast';
import { queryKeys } from '@/lib/utils/queryKeys';
import {
  syncScriptDialogueDocumentWithConflictRetry,
  type ScriptDialogueDocumentSyncResult,
} from './scriptDialogueDocumentSyncClient';
import type { ScriptDialogueDocumentCommand } from './scriptDialogueDocumentSync';

async function readDocumentToken(
  supabase: SupabaseClient,
  documentId: string,
): Promise<DocumentStateToken> {
  const { data, error } = await supabase
    .from('documents')
    .select('collab_epoch, collab_revision')
    .eq('id', documentId)
    .single();
  if (error || !data) throw error ?? new Error('Failed to load source document state');
  return {
    epoch: Number(data.collab_epoch),
    revision: Number(data.collab_revision),
  };
}

export async function synchronizeScriptDialogueTablePlan(input: {
  supabase: SupabaseClient;
  queryClient: Pick<QueryClient, 'invalidateQueries'>;
  projectId: string;
  libraryId: string;
  documentId: string;
  command: ScriptDialogueDocumentCommand;
}): Promise<ScriptDialogueDocumentSyncResult> {
  const expected = await readDocumentToken(input.supabase, input.documentId);
  const result = await syncScriptDialogueDocumentWithConflictRetry(
    {
      projectId: input.projectId,
      libraryId: input.libraryId,
      documentId: input.documentId,
      expected,
      command: input.command,
    },
    () => readDocumentToken(input.supabase, input.documentId),
  );
  const updatedLibraryIds = [...new Set([
    input.libraryId,
    ...(result.updatedLibraryIds ?? []),
  ])];
  await Promise.all(updatedLibraryIds.flatMap((libraryId) => [
    input.queryClient.invalidateQueries({
      queryKey: queryKeys.library(libraryId),
      refetchType: 'all',
    }),
    input.queryClient.invalidateQueries({
      queryKey: queryKeys.libraryAssets(libraryId),
      refetchType: 'all',
    }),
  ]));
  await input.queryClient.invalidateQueries({
    queryKey: queryKeys.documentState(input.documentId),
    refetchType: 'all',
  });
  requestLibraryReconciliation(updatedLibraryIds);
  return result;
}
