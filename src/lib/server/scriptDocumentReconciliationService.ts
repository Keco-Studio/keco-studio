import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { DocumentStateConflictError, type DocumentStateToken } from '@/lib/documents/documentStateTypes';
import { createAccessVerificationCache } from '@/lib/services/authorizationService';
import { deriveScriptDocumentReconciliation } from '@/lib/script-system/scriptDocumentReconciliation';
import { reconcileScriptPlotPlanRowOrder } from '@/lib/script-system/scriptPlotPlanSync';
import { parseStoryPlotPlan } from '@/lib/story-plot/schema';
import { getSupabaseServiceRoleClient } from './supabaseServiceRole';
import { prepareScriptDialogueLibraryReconciliation } from './scriptDialogueDerivedTableSyncService';

type ScriptLibrary = { id: string; plot_plan: unknown };

function prepareOrderedOperation(
  operation: Awaited<ReturnType<typeof prepareScriptDialogueLibraryReconciliation>>['operation'],
  currentOrderIds: string[],
): {
  operation: Record<string, unknown>;
  currentOrderIds: string[];
  nextOrderIds: string[];
} {
  if (operation.type === 'reorder') {
    return {
      operation,
      currentOrderIds: operation.expectedOrderIds,
      nextOrderIds: operation.nextOrderIds,
    };
  }
  if (operation.type === 'insert') {
    const actionRowId = randomUUID();
    const speechRowId = randomUUID();
    const insertIndex = operation.afterRowId
      ? currentOrderIds.indexOf(operation.afterRowId) + 1
      : operation.insertAtStart
        ? 0
        : currentOrderIds.length;
    if (insertIndex < 0) throw new Error('DERIVED_TABLE_MAPPING_AMBIGUOUS');
    const nextOrderIds = [...currentOrderIds];
    nextOrderIds.splice(insertIndex, 0, actionRowId, speechRowId);
    return {
      operation: {
        ...operation,
        actionRowId,
        speechRowId,
        expectedOrderIds: currentOrderIds,
        nextOrderIds,
      },
      currentOrderIds,
      nextOrderIds,
    };
  }
  if (operation.type === 'delete') {
    const deletedIds = new Set([
      operation.actionRowId,
      operation.speechRowId,
    ].filter((id): id is string => Boolean(id)));
    const nextOrderIds = currentOrderIds.filter((id) => !deletedIds.has(id));
    return {
      operation: {
        ...operation,
        expectedOrderIds: currentOrderIds,
        nextOrderIds,
      },
      currentOrderIds,
      nextOrderIds,
    };
  }
  return {
    operation: {
      ...operation,
      expectedOrderIds: currentOrderIds,
      nextOrderIds: currentOrderIds,
    },
    currentOrderIds,
    nextOrderIds: currentOrderIds,
  };
}

export async function reconcileScriptLibrariesFromDocument(input: {
  supabase: SupabaseClient;
  actorUserId: string;
  projectId: string;
  documentId: string;
  expected: DocumentStateToken;
  previousMarkdown: string;
  markdown: string;
}): Promise<{
  updatedLibraries: number;
  updatedLibraryIds: string[];
  ambiguous: boolean;
}> {
  const current = await documentStateGateway.read(input.supabase, input.documentId);
  if (current.projectId !== input.projectId) throw new Error('FORBIDDEN');
  if (
    current.token.epoch !== input.expected.epoch
    || current.token.revision !== input.expected.revision
    || current.markdown !== input.markdown
  ) {
    throw new DocumentStateConflictError('Document state changed', current.token);
  }
  const reconciliation = deriveScriptDocumentReconciliation(
    input.previousMarkdown,
    input.markdown,
  );
  if (reconciliation.type === 'none') {
    return { updatedLibraries: 0, updatedLibraryIds: [], ambiguous: false };
  }
  if (reconciliation.type === 'ambiguous') {
    return { updatedLibraries: 0, updatedLibraryIds: [], ambiguous: true };
  }

  const admin = getSupabaseServiceRoleClient();
  const { data, error } = await admin
    .from('libraries')
    .select('id, plot_plan')
    .eq('project_id', input.projectId)
    .eq('source_document_id', input.documentId)
    .eq('document_export_type', 'script');
  if (error) throw error;

  let updatedLibraries = 0;
  const updatedLibraryIds: string[] = [];
  const access = {
    userId: input.actorUserId,
    cache: createAccessVerificationCache(),
  };
  for (const library of (data ?? []) as ScriptLibrary[]) {
    const prepared = await prepareScriptDialogueLibraryReconciliation({
      supabase: admin,
      libraryId: library.id,
      command: reconciliation.command,
      access,
    });
    const ordered = prepareOrderedOperation(
      prepared.operation,
      prepared.currentOrderIds,
    );
    const currentPlotPlan = parseStoryPlotPlan(library.plot_plan);
    const plotPlan = reconcileScriptPlotPlanRowOrder(currentPlotPlan, {
      currentRowIds: ordered.currentOrderIds,
      nextRowIds: ordered.nextOrderIds,
      flowRows: prepared.flowRows,
    });
    const { error: rpcError } = await admin.rpc(
      'reconcile_script_library_from_document',
      {
        p_document_id: input.documentId,
        p_actor_user_id: input.actorUserId,
        p_expected_epoch: input.expected.epoch,
        p_expected_revision: input.expected.revision,
        p_script_library_id: library.id,
        p_operation: ordered.operation,
        p_plot_plan: plotPlan,
      },
    );
    if (rpcError) {
      if (rpcError.code === 'PT409') {
        throw new DocumentStateConflictError(rpcError.message, current.token);
      }
      if (rpcError.code === '42501') throw new Error('FORBIDDEN');
      throw rpcError;
    }
    updatedLibraries += 1;
    updatedLibraryIds.push(library.id);
  }
  return { updatedLibraries, updatedLibraryIds, ambiguous: false };
}
