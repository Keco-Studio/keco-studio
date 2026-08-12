import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow } from '@/lib/types/libraryAssets';
import {
  createAsset,
  deleteAssets,
  normalizeRowIndices,
  shiftRowIndices,
  updateAsset,
} from '@/lib/services/libraryAssetsService';
import {
  getNextAppendRowIndex,
  rowsNeedRowIndexNormalize,
  sortAssetsForUiRow,
} from '@/lib/utils/assetEmptiness';
import type { ScriptDialogueBlock, ScriptDialogueColumnKeys } from './scriptDialogueBlocks';
import { resolveSpeechTypeForSpeaker } from './scriptDialogueBlocks';

export type ScriptDialogueFieldKeys = ScriptDialogueColumnKeys & {
  typeKey: string;
  nameKey: string;
  contentKey: string;
};

export type InsertedDialogueRows = {
  actionRowId: string;
  speechRowId: string;
  speaker: string;
  speechType: '1' | '2';
  actionContent: string;
  dialogueContent: string;
  /** 1-based row_index assigned to the action row at insert time */
  actionRowIndex: number;
};

export type DeletedDialogueSnapshot = {
  rows: Array<{
    id: string;
    name: string;
    propertyValues: Record<string, unknown>;
    rowIndex?: number;
  }>;
  /** Full library asset id order before deletion (for restore placement) */
  previousOrderIds: string[];
};

function buildPropertyValues(
  fields: ScriptDialogueFieldKeys,
  values: { type: string; speaker: string; content: string },
): Record<string, unknown> {
  return {
    [fields.typeKey]: values.type,
    [fields.nameKey]: values.speaker,
    [fields.contentKey]: values.content,
  };
}

async function ensureNormalizedOrder(
  supabase: SupabaseClient,
  libraryId: string,
  rows: AssetRow[],
): Promise<AssetRow[]> {
  const ordered = sortAssetsForUiRow(rows);
  const hasSequentialOneBasedIndexes = ordered.every(
    (row, index) => row.rowIndex === index + 1,
  );
  if (!rowsNeedRowIndexNormalize(ordered) && hasSequentialOneBasedIndexes) return ordered;
  await normalizeRowIndices(supabase, libraryId, ordered);
  return ordered.map((row, index) => ({ ...row, rowIndex: index + 1 }));
}

export async function insertDialogueThreadAfter(params: {
  supabase: SupabaseClient;
  libraryId: string;
  rows: AssetRow[];
  fields: ScriptDialogueFieldKeys;
  afterRowId: string | null;
  speaker: string;
}): Promise<InsertedDialogueRows> {
  const { supabase, libraryId, fields, afterRowId, speaker } = params;
  const ordered = await ensureNormalizedOrder(supabase, libraryId, params.rows);
  const speechType = resolveSpeechTypeForSpeaker(speaker, ordered, fields);

  let baseRowIndex: number;
  if (!afterRowId) {
    baseRowIndex = getNextAppendRowIndex(ordered);
  } else {
    const afterIndex = ordered.findIndex((row) => row.id === afterRowId);
    if (afterIndex < 0) {
      throw new Error(`Insert anchor row not found: ${afterRowId}`);
    }
    baseRowIndex = afterIndex + 2;
    await shiftRowIndices(supabase, libraryId, baseRowIndex, 2);
  }

  const actionValues = buildPropertyValues(fields, {
    type: '3',
    speaker,
    content: '',
  });
  const speechValues = buildPropertyValues(fields, {
    type: speechType,
    speaker,
    content: '',
  });

  let actionRowId: string | null = null;
  let speechRowId: string | null = null;
  try {
    actionRowId = await createAsset(supabase, libraryId, speaker, actionValues, {
      rowIndex: baseRowIndex,
    });
    speechRowId = await createAsset(supabase, libraryId, speaker, speechValues, {
      rowIndex: baseRowIndex + 1,
    });
  } catch (error) {
    const createdIds = [actionRowId, speechRowId].filter((id): id is string => Boolean(id));
    try {
      if (createdIds.length > 0) await deleteAssets(supabase, createdIds);
      if (ordered.length > 0) await normalizeRowIndices(supabase, libraryId, ordered);
    } catch {
      // Preserve the original insert error; query refresh will recover authoritative state.
    }
    throw error;
  }

  return {
    actionRowId,
    speechRowId,
    speaker,
    speechType,
    actionContent: '',
    dialogueContent: '',
    actionRowIndex: baseRowIndex,
  };
}

export async function updateDialogueRowContent(params: {
  supabase: SupabaseClient;
  row: AssetRow;
  contentKey: string;
  content: string;
}): Promise<{ oldContent: string }> {
  const { supabase, row, contentKey, content } = params;
  const oldContent = String(row.propertyValues[contentKey] ?? '');
  if (oldContent === content) return { oldContent };
  await updateAsset(supabase, row.id, row.name, {
    ...row.propertyValues,
    [contentKey]: content,
  });
  return { oldContent };
}

export async function ensureActionRowForBlock(params: {
  supabase: SupabaseClient;
  libraryId: string;
  rows: AssetRow[];
  fields: ScriptDialogueFieldKeys;
  block: ScriptDialogueBlock;
}): Promise<{ actionRowId: string; created: boolean }> {
  const { supabase, libraryId, fields, block } = params;
  if (block.actionRowId) return { actionRowId: block.actionRowId, created: false };
  if (!block.speechRowId) throw new Error('Block has neither action nor speech row');

  const ordered = await ensureNormalizedOrder(supabase, libraryId, params.rows);
  const speechIndex = ordered.findIndex((row) => row.id === block.speechRowId);
  if (speechIndex < 0) throw new Error('Speech row not found for action create');
  const baseRowIndex = speechIndex + 1;
  await shiftRowIndices(supabase, libraryId, baseRowIndex, 1);
  const actionRowId = await createAsset(
    supabase,
    libraryId,
    block.speaker,
    buildPropertyValues(fields, { type: '3', speaker: block.speaker, content: '' }),
    { rowIndex: baseRowIndex },
  );
  return { actionRowId, created: true };
}

export async function ensureSpeechRowForBlock(params: {
  supabase: SupabaseClient;
  libraryId: string;
  rows: AssetRow[];
  fields: ScriptDialogueFieldKeys;
  block: ScriptDialogueBlock;
}): Promise<{ speechRowId: string; created: boolean }> {
  const { supabase, libraryId, fields, block } = params;
  if (block.speechRowId) return { speechRowId: block.speechRowId, created: false };
  if (!block.actionRowId) throw new Error('Block has neither action nor speech row');

  const ordered = await ensureNormalizedOrder(supabase, libraryId, params.rows);
  const actionIndex = ordered.findIndex((row) => row.id === block.actionRowId);
  if (actionIndex < 0) throw new Error('Action row not found for speech create');
  const baseRowIndex = actionIndex + 2;
  await shiftRowIndices(supabase, libraryId, baseRowIndex, 1);
  const speechRowId = await createAsset(
    supabase,
    libraryId,
    block.speaker,
    buildPropertyValues(fields, {
      type: block.speechType,
      speaker: block.speaker,
      content: '',
    }),
    { rowIndex: baseRowIndex },
  );
  return { speechRowId, created: true };
}

export async function deleteDialogueBlock(params: {
  supabase: SupabaseClient;
  rows: AssetRow[];
  block: ScriptDialogueBlock;
}): Promise<DeletedDialogueSnapshot> {
  const ordered = sortAssetsForUiRow(params.rows);
  const ids = [params.block.actionRowId, params.block.speechRowId].filter(
    (id): id is string => Boolean(id),
  );
  const snapshotRows = ids.flatMap((id) => {
    const row = ordered.find((item) => item.id === id);
    if (!row) return [];
    return [{
      id: row.id,
      name: row.name,
      propertyValues: { ...row.propertyValues },
      rowIndex: row.rowIndex,
    }];
  });
  const previousOrderIds = ordered.map((row) => row.id);
  await deleteAssets(params.supabase, ids);
  return { rows: snapshotRows, previousOrderIds };
}

export async function restoreDeletedDialogueBlock(params: {
  supabase: SupabaseClient;
  libraryId: string;
  currentRows: AssetRow[];
  snapshot: DeletedDialogueSnapshot;
}): Promise<DeletedDialogueSnapshot> {
  const { supabase, libraryId, snapshot } = params;
  const remaining = sortAssetsForUiRow(params.currentRows).filter(
    (row) => !snapshot.rows.some((item) => item.id === row.id),
  );

  // Recreate missing rows then normalize to the previous full order.
  const createdIds: string[] = [];
  for (const item of snapshot.rows) {
    const id = await createAsset(supabase, libraryId, item.name, item.propertyValues, {
      rowIndex: typeof item.rowIndex === 'number' ? undefined : undefined,
    });
    createdIds.push(id);
  }

  // Map old ids → new ids by restore sequence when ids differ.
  const idMap = new Map<string, string>();
  snapshot.rows.forEach((item, index) => {
    idMap.set(item.id, createdIds[index] ?? item.id);
  });

  const desiredOrder = snapshot.previousOrderIds.map((id) => {
    const mapped = idMap.get(id) ?? id;
    return (
      remaining.find((row) => row.id === mapped)
      ?? { id: mapped }
    );
  });

  // Include any unexpected new rows at the end.
  const desiredIds = new Set(desiredOrder.map((row) => row.id));
  for (const row of remaining) {
    if (!desiredIds.has(row.id)) desiredOrder.push(row);
  }
  for (const id of createdIds) {
    if (!desiredIds.has(id)) desiredOrder.push({ id });
  }

  await normalizeRowIndices(supabase, libraryId, desiredOrder);

  return {
    rows: snapshot.rows.map((item, index) => ({
      ...item,
      id: createdIds[index] ?? item.id,
    })),
    previousOrderIds: snapshot.previousOrderIds.map((id) => idMap.get(id) ?? id),
  };
}

export function reorderDialogueRowIds(params: {
  orderedRowIds: string[];
  blockOrderIds: string[];
  fromIndex: number;
  toIndex: number;
  blockRowIds: Map<string, string[]>;
}): string[] {
  const {
    orderedRowIds,
    blockOrderIds,
    fromIndex,
    toIndex,
    blockRowIds,
  } = params;
  if (
    fromIndex === toIndex
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= blockOrderIds.length
    || toIndex >= blockOrderIds.length
  ) {
    return [...orderedRowIds];
  }

  const rowOwner = new Map<string, string>();
  for (const blockId of blockOrderIds) {
    for (const rowId of blockRowIds.get(blockId) ?? []) {
      rowOwner.set(rowId, blockId);
    }
  }

  const slots: Array<{ kind: 'row'; rowId: string } | { kind: 'block' }> = [];
  const seenBlocks = new Set<string>();
  for (const rowId of orderedRowIds) {
    const blockId = rowOwner.get(rowId);
    if (!blockId) {
      slots.push({ kind: 'row', rowId });
      continue;
    }
    if (!seenBlocks.has(blockId)) {
      seenBlocks.add(blockId);
      slots.push({ kind: 'block' });
    }
  }

  const nextBlockOrder = [...blockOrderIds];
  const [moved] = nextBlockOrder.splice(fromIndex, 1);
  nextBlockOrder.splice(toIndex, 0, moved);
  let nextBlockIndex = 0;

  return slots.flatMap((slot) => {
    if (slot.kind === 'row') return [slot.rowId];
    const blockId = nextBlockOrder[nextBlockIndex];
    nextBlockIndex += 1;
    return blockRowIds.get(blockId) ?? [];
  });
}

export async function reorderDialogueBlock(params: {
  supabase: SupabaseClient;
  libraryId: string;
  rows: AssetRow[];
  /** Block ids in the plot-node display order before drag */
  blockOrderIds: string[];
  fromIndex: number;
  toIndex: number;
  /** Map block id → covered asset row ids in display order */
  blockRowIds: Map<string, string[]>;
}): Promise<{ previousOrderIds: string[]; nextOrderIds: string[] }> {
  const { supabase, libraryId, fromIndex, toIndex, blockOrderIds, blockRowIds } = params;
  if (
    fromIndex === toIndex
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= blockOrderIds.length
    || toIndex >= blockOrderIds.length
  ) {
    const ordered = sortAssetsForUiRow(params.rows).map((row) => row.id);
    return { previousOrderIds: ordered, nextOrderIds: ordered };
  }

  const ordered = await ensureNormalizedOrder(supabase, libraryId, params.rows);
  const previousOrderIds = ordered.map((row) => row.id);

  const nextOrderIds = reorderDialogueRowIds({
    orderedRowIds: previousOrderIds,
    blockOrderIds,
    fromIndex,
    toIndex,
    blockRowIds,
  });
  await normalizeRowIndices(
    supabase,
    libraryId,
    nextOrderIds.map((id) => ({ id })),
  );
  return { previousOrderIds, nextOrderIds };
}

export async function applyRowOrder(params: {
  supabase: SupabaseClient;
  libraryId: string;
  orderIds: string[];
}): Promise<void> {
  await normalizeRowIndices(
    params.supabase,
    params.libraryId,
    params.orderIds.map((id) => ({ id })),
  );
}
