import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { sortAssetsForUiRow } from '@/lib/utils/assetEmptiness';
import type { ScriptDialogueFieldKeys } from './scriptDialogueMutations';

type DialogueRpcRow = {
  id: string;
  library_id: string;
  name: string;
  row_index?: number | null;
  property_values?: Record<string, unknown> | null;
};

type InsertResponse = {
  action_row: DialogueRpcRow;
  speech_row: DialogueRpcRow;
  action_row_index: number;
};

export function isMissingScriptDialogueRpcError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  if (candidate?.code === 'PGRST202') return true;
  const text = [candidate?.message, candidate?.details, candidate?.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return text.includes('could not find the function')
    && text.includes('script_dialogue_block')
    && text.includes('schema cache');
}

export type InsertedScriptDialogueRows = {
  actionRow: AssetRow;
  speechRow: AssetRow;
  actionRowId: string;
  speechRowId: string;
  actionRowIndex: number;
};

function mapRpcRow(row: DialogueRpcRow): AssetRow {
  return {
    id: row.id,
    libraryId: row.library_id,
    name: row.name,
    slug: null,
    figmaNodeId: null,
    propertyValues: row.property_values ?? {},
    rowIndex: row.row_index ?? undefined,
  };
}

function sortRows(rows: AssetRow[]): AssetRow[] {
  return [...rows].sort((left, right) => {
    const leftIndex = left.rowIndex ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = right.rowIndex ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex || left.id.localeCompare(right.id);
  });
}

export async function insertScriptDialogueBlock(params: {
  supabase: SupabaseClient;
  libraryId: string;
  afterRowId: string | null;
  speaker: string;
  speechType: '1' | '2';
  fields: ScriptDialogueFieldKeys;
}): Promise<InsertedScriptDialogueRows> {
  const { data, error } = await params.supabase.rpc('insert_script_dialogue_block', {
    p_library_id: params.libraryId,
    p_after_row_id: params.afterRowId,
    p_speaker: params.speaker,
    p_speech_type: params.speechType,
    p_type_field_id: params.fields.typeKey,
    p_name_field_id: params.fields.nameKey,
    p_content_field_id: params.fields.contentKey,
  });
  if (error) throw error;
  if (!data) throw new Error('Insert dialogue RPC returned no data');

  const response = data as InsertResponse;
  return {
    actionRow: mapRpcRow(response.action_row),
    speechRow: mapRpcRow(response.speech_row),
    actionRowId: response.action_row.id,
    speechRowId: response.speech_row.id,
    actionRowIndex: response.action_row_index,
  };
}

export async function deleteScriptDialogueBlock(params: {
  supabase: SupabaseClient;
  libraryId: string;
  actionRowId?: string;
  speechRowId?: string;
}): Promise<string[]> {
  const { data, error } = await params.supabase.rpc('delete_script_dialogue_block', {
    p_library_id: params.libraryId,
    p_action_row_id: params.actionRowId ?? null,
    p_speech_row_id: params.speechRowId ?? null,
  });
  if (error) throw error;
  return ((data as { deleted_ids?: string[] } | null)?.deleted_ids ?? []).filter(Boolean);
}

export function applyInsertedDialogueRows(
  rows: AssetRow[],
  inserted: InsertedScriptDialogueRows,
): AssetRow[] {
  const insertedIds = new Set([inserted.actionRow.id, inserted.speechRow.id]);
  const existingRows = rows.filter((row) => !insertedIds.has(row.id));
  const orderedRows = sortAssetsForUiRow(existingRows);
  const hasSequentialIndexes = orderedRows.every(
    (row, index) => row.rowIndex === index + 1,
  );
  const normalizedRows = hasSequentialIndexes
    ? orderedRows
    : orderedRows.map((row, index) => ({ ...row, rowIndex: index + 1 }));
  const shiftedRows = normalizedRows
    .map((row) => (
      typeof row.rowIndex === 'number' && row.rowIndex >= inserted.actionRowIndex
        ? { ...row, rowIndex: row.rowIndex + 2 }
        : row
    ));
  return sortRows([...shiftedRows, inserted.actionRow, inserted.speechRow]);
}

export function removeDeletedDialogueRows(rows: AssetRow[], deletedIds: string[]): AssetRow[] {
  const deleted = new Set(deletedIds);
  return rows.filter((row) => !deleted.has(row.id));
}
