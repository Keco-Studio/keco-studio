import 'server-only';

import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import {
  DocumentReadOnlyError,
  DocumentStateConflictError,
  type DocumentStateToken,
} from '@/lib/documents/documentStateTypes';
import { replaceDocumentAsAgent } from './documentAgentEditService';
import { applyScriptDialogueCommand, type ScriptDialogueDocumentCommand } from '@/lib/script-system/scriptDialogueDocumentSync';
import type { SupabaseClient } from '@supabase/supabase-js';
import { prepareScriptDialogueDerivedTableOperations } from './scriptDialogueDerivedTableSyncService';

export async function syncScriptDialogueDocument(input: {
  supabase: SupabaseClient;
  actorUserId: string;
  projectId: string;
  documentId: string;
  expected: DocumentStateToken;
  command: ScriptDialogueDocumentCommand;
}) {
  const current = await documentStateGateway.read(input.supabase, input.documentId);
  if (current.projectId !== input.projectId) throw new Error('FORBIDDEN');
  if (current.token.epoch !== input.expected.epoch || current.token.revision !== input.expected.revision) {
    throw new DocumentStateConflictError('Document state changed', current.token);
  }
  const transformed = applyScriptDialogueCommand(current.markdown, input.command);
  const derivedTableOperations = await prepareScriptDialogueDerivedTableOperations({
    supabase: input.supabase,
    projectId: input.projectId,
    documentId: input.documentId,
    command: input.command,
  });
  const state = await replaceDocumentAsAgent({
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    documentId: input.documentId,
    expected: current.token,
    expectedUpdateIds: current.updateTail.map((update) => update.id),
    markdown: transformed.markdown,
    derivedTableOperations,
  }, { current });
  return state;
}

export function mapScriptDialogueSyncError(error: unknown): { code: string; status: number; message: string } {
  if (error instanceof DocumentStateConflictError) {
    return { code: 'DOCUMENT_CONFLICT', status: 409, message: 'The source document changed. Refresh and try again.' };
  }
  if (error instanceof DocumentReadOnlyError || (error instanceof Error && error.message === 'FORBIDDEN')) {
    return { code: 'FORBIDDEN', status: 403, message: 'You do not have permission to edit this source document.' };
  }
  if (error instanceof Error && /SOURCE_MAPPING_AMBIGUOUS/.test(error.message)) {
    return { code: 'MAPPING_AMBIGUOUS', status: 409, message: 'Unable to determine the original document position. Regenerate the conversation and try again.' };
  }
  if (error instanceof Error && /DERIVED_TABLE_MAPPING_AMBIGUOUS/.test(error.message)) {
    return { code: 'TABLE_MAPPING_AMBIGUOUS', status: 409, message: 'Unable to determine the matching table row. Regenerate the table and try again.' };
  }
  return { code: 'SYNC_FAILED', status: 500, message: 'Failed to synchronize the source document.' };
}
