import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { documentContentCodec, mergeYjsState } from '@/lib/documents/documentContentCodec';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { DocumentStateConflictError, type DocumentStateToken } from '@/lib/documents/documentStateTypes';
import type { ScriptDialogueDocumentCommand } from '@/lib/script-system/scriptDialogueDocumentSync';
import { prepareScriptDialogueDerivedTableOperations } from '@/lib/server/scriptDialogueDerivedTableSyncService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import type { StoryPlotPlan } from '@/lib/story-plot/schema';

export type ScriptMutationReceipt = {
  idempotency_key: string;
  actor_user_id: string;
  project_id: string;
  document_id: string;
  library_id: string;
  request_hash: string;
  operation: Record<string, unknown>;
  undo_payload: Record<string, unknown>;
  before_markdown: string;
  after_markdown: string;
  before_plot_plan: StoryPlotPlan;
  after_plot_plan: StoryPlotPlan;
  result_fingerprint: string;
  result_epoch: number;
  result_revision: number;
  undone_by: string | null;
  undo_of: string | null;
};

export async function readScriptMutationReceipt(key: string): Promise<ScriptMutationReceipt | null> {
  const { data, error } = await getSupabaseServiceRoleClient()
    .from('agent_script_dialogue_mutations').select('*')
    .eq('idempotency_key', key).maybeSingle();
  if (error) throw error;
  return data as ScriptMutationReceipt | null;
}

export async function runAtomicScriptDialogueMutation(input: {
  supabase: SupabaseClient;
  actorUserId: string;
  projectId: string;
  documentId: string;
  libraryId: string;
  expected: DocumentStateToken;
  expectedMarkdown: string;
  expectedUpdateIds: string[];
  expectedFingerprint: string;
  expectedPlotPlan: StoryPlotPlan;
  command: ScriptDialogueDocumentCommand;
  markdown: string;
  operation: Record<string, unknown>;
  plotPlan: StoryPlotPlan;
  idempotencyKey: string;
  requestHash: string;
  undoPayload: Record<string, unknown>;
  undoOf?: string;
}): Promise<{ epoch: number; revision: number }> {
  documentContentCodec.validate(input.markdown);
  const admin = getSupabaseServiceRoleClient();
  const current = await documentStateGateway.read(admin, input.documentId);
  if (current.projectId !== input.projectId) throw new Error('FORBIDDEN');
  if (current.token.epoch !== input.expected.epoch
    || current.token.revision !== input.expected.revision
    || current.markdown !== input.expectedMarkdown
    || current.updateTail.length !== input.expectedUpdateIds.length
    || current.updateTail.some((update, index) => update.id !== input.expectedUpdateIds[index])) {
    throw new DocumentStateConflictError('Document state changed', current.token);
  }
  if (!current.yjsStateBase64) {
    throw new DocumentStateConflictError('Document collaboration state is not initialized', current.token);
  }
  const merged = mergeYjsState(current.yjsStateBase64,
    current.updateTail.map((update) => update.updateBase64));
  const siblingOperations = input.command.type === 'reorder' ? []
    : (await prepareScriptDialogueDerivedTableOperations({
      supabase: input.supabase,
      projectId: input.projectId,
      documentId: input.documentId,
      command: input.command,
      includeScriptLibraries: true,
    })).filter((operation) => operation.libraryId !== input.libraryId);
  const { data, error } = await admin.rpc('replace_document_and_reconcile_agent_script', {
    p_document_id: input.documentId,
    p_actor_user_id: input.actorUserId,
    p_backup_version_id: globalThis.crypto.randomUUID(),
    p_expected_epoch: input.expected.epoch,
    p_expected_revision: input.expected.revision,
    p_included_update_ids: current.updateTail.map((update) => update.id),
    p_current_yjs_state: merged,
    p_current_markdown: current.markdown,
    p_replacement_yjs_state: await documentContentCodec.markdownToYjsState(input.markdown),
    p_replacement_markdown: input.markdown,
    p_script_library_id: input.libraryId,
    p_expected_origin_fingerprint: input.expectedFingerprint,
    p_expected_plot_plan: input.expectedPlotPlan,
    p_operation: input.operation,
    p_plot_plan: input.plotPlan,
    p_sibling_table_operations: siblingOperations,
    p_idempotency_key: input.idempotencyKey,
    p_request_hash: input.requestHash,
    p_undo_payload: input.undoPayload,
    p_undo_of: input.undoOf ?? null,
  });
  if (error) {
    if (error.code === 'PT409') throw new DocumentStateConflictError(error.message, current.token);
    if (error.code === '42501') throw new Error('FORBIDDEN');
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Script mutation returned no document state.');
  return { epoch: Number(row.collab_epoch), revision: Number(row.collab_revision) };
}
