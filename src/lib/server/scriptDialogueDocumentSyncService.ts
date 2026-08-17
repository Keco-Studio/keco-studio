import 'server-only';

import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import {
  DocumentReadOnlyError,
  DocumentStateConflictError,
  type DocumentStateToken,
} from '@/lib/documents/documentStateTypes';
import { replaceDocumentAsAgent } from './documentAgentEditService';
import { applyScriptDialogueCommand, type ScriptDialogueDocumentCommand } from '@/lib/script-system/scriptDialogueDocumentSync';
import {
  reconcileScriptPlotPlanRowOrder,
  type SynchronizedStoryPlotPlan,
} from '@/lib/script-system/scriptPlotPlanSync';
import { parseStoryPlotPlan, type StoryPlotPlan } from '@/lib/story-plot/schema';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  prepareScriptDialogueDerivedTableOperations,
  prepareScriptDialogueLibraryReconciliation,
} from './scriptDialogueDerivedTableSyncService';

export async function syncScriptDialogueDocument(input: {
  supabase: SupabaseClient;
  actorUserId: string;
  projectId: string;
  libraryId: string;
  documentId: string;
  expected: DocumentStateToken;
  command: ScriptDialogueDocumentCommand;
}): Promise<{
  state: Awaited<ReturnType<typeof replaceDocumentAsAgent>>;
  plotPlan?: SynchronizedStoryPlotPlan;
  updatedLibraryIds: string[];
}> {
  const current = await documentStateGateway.read(input.supabase, input.documentId);
  if (current.projectId !== input.projectId) throw new Error('FORBIDDEN');
  if (current.token.epoch !== input.expected.epoch || current.token.revision !== input.expected.revision) {
    throw new DocumentStateConflictError('Document state changed', current.token);
  }
  const transformed = applyScriptDialogueCommand(current.markdown, input.command);
  let plotPlan: SynchronizedStoryPlotPlan | undefined;
  let scriptReorder: Parameters<typeof replaceDocumentAsAgent>[0]['scriptReorder'];
  let includeScriptLibraries = false;
  if (input.command.type !== 'reorder') {
    const { data: originLibrary, error: originError } = await input.supabase
      .from('libraries')
      .select('id, document_export_type')
      .eq('id', input.libraryId)
      .eq('project_id', input.projectId)
      .eq('source_document_id', input.documentId)
      .single();
    if (
      originError
      || !originLibrary
      || !['script', 'table'].includes(originLibrary.document_export_type ?? '')
    ) {
      throw new Error('FORBIDDEN');
    }
    includeScriptLibraries = originLibrary.document_export_type === 'table';
  }
  const derivedTableOperations = input.command.type === 'reorder'
    ? []
    : await prepareScriptDialogueDerivedTableOperations({
        supabase: input.supabase,
        projectId: input.projectId,
        documentId: input.documentId,
        command: input.command,
        includeScriptLibraries,
      });
  if (input.command.type === 'reorder') {
    const { data: library, error: libraryError } = await input.supabase
      .from('libraries')
      .select('id, plot_plan')
      .eq('id', input.libraryId)
      .eq('project_id', input.projectId)
      .eq('source_document_id', input.documentId)
      .eq('document_export_type', 'script')
      .single();
    if (libraryError || !library) throw new Error('FORBIDDEN');
    const prepared = await prepareScriptDialogueLibraryReconciliation({
      supabase: input.supabase,
      libraryId: input.libraryId,
      command: input.command,
    });
    const operation = prepared.operation;
    if (operation.type !== 'reorder') throw new Error('DERIVED_TABLE_MAPPING_AMBIGUOUS');
    plotPlan = reconcileScriptPlotPlanRowOrder(parseStoryPlotPlan(library.plot_plan), {
      currentRowIds: operation.expectedOrderIds,
      nextRowIds: operation.nextOrderIds,
      flowRows: prepared.flowRows,
    });
    scriptReorder = {
      libraryId: input.libraryId,
      expectedOrderIds: operation.expectedOrderIds,
      nextOrderIds: operation.nextOrderIds,
      plotPlan,
    };
  }
  const state = await replaceDocumentAsAgent({
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    documentId: input.documentId,
    expected: current.token,
    expectedUpdateIds: current.updateTail.map((update) => update.id),
    markdown: transformed.markdown,
    ...(scriptReorder ? { scriptReorder } : {}),
    ...(derivedTableOperations.length > 0 ? { derivedTableOperations } : {}),
  }, { current });
  return {
    state,
    ...(plotPlan ? { plotPlan } : {}),
    updatedLibraryIds: scriptReorder
      ? [input.libraryId]
      : derivedTableOperations.map((operation) => operation.libraryId),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

export function mapScriptDialogueSyncError(error: unknown): { code: string; status: number; message: string } {
  const message = errorMessage(error);
  if (error instanceof DocumentStateConflictError) {
    return { code: 'DOCUMENT_CONFLICT', status: 409, message: 'The source document changed. Refresh and try again.' };
  }
  if (error instanceof DocumentReadOnlyError || message === 'FORBIDDEN') {
    return { code: 'FORBIDDEN', status: 403, message: 'You do not have permission to edit this source document.' };
  }
  if (/SOURCE_MAPPING_AMBIGUOUS/.test(message)) {
    return { code: 'MAPPING_AMBIGUOUS', status: 409, message: 'Unable to determine the original document position. Regenerate the conversation and try again.' };
  }
  if (/DERIVED_TABLE_MAPPING_AMBIGUOUS/.test(message)) {
    return { code: 'TABLE_MAPPING_AMBIGUOUS', status: 409, message: 'Unable to determine the matching table row. Regenerate the table and try again.' };
  }
  if (/PLOT_PLAN/.test(message)) {
    return { code: 'PLOT_PLAN_CONFLICT', status: 409, message: 'The conversion changed. Refresh and try again.' };
  }
  return { code: 'SYNC_FAILED', status: 500, message: 'Failed to synchronize the source document.' };
}
