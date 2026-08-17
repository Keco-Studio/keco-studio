import type { AssetRow } from '@/lib/types/libraryAssets';
import { sortAssetsForUiRow } from '@/lib/utils/assetEmptiness';
import {
  sourceTextForDialogueBlock,
  type ScriptDialogueBlock,
} from './scriptDialogueBlocks';
import { reorderDialogueRowIds } from './scriptDialogueMutations';
import type { ScriptDialogueDocumentCommand } from './scriptDialogueDocumentSync';

export function planSynchronizedDialogueReorder(input: {
  blocks: ScriptDialogueBlock[];
  rows: AssetRow[];
  fromIndex: number;
  toIndex: number;
}): {
  command: Extract<ScriptDialogueDocumentCommand, { type: 'reorder' }>;
  previousOrderIds: string[];
  nextOrderIds: string[];
} | null {
  const { blocks, rows, fromIndex, toIndex } = input;
  if (
    fromIndex === toIndex
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= blocks.length
    || toIndex >= blocks.length
  ) {
    return null;
  }
  const moving = blocks[fromIndex];
  const target = blocks[toIndex];
  const movingTexts = [...new Set([
    sourceTextForDialogueBlock(moving, 'first'),
    sourceTextForDialogueBlock(moving, 'last'),
  ].filter(Boolean))];
  const edge = fromIndex > toIndex ? 'before' : 'after';
  const targetText = sourceTextForDialogueBlock(
    target,
    edge === 'before' ? 'first' : 'last',
  );
  if (movingTexts.length === 0 || !targetText) return null;

  const blockOrderIds = blocks.map((block) => block.id);
  const blockRowIds = new Map(blocks.map((block) => [
    block.id,
    [block.actionRowId, block.speechRowId].filter((id): id is string => Boolean(id)),
  ]));
  const previousOrderIds = sortAssetsForUiRow(rows).map((row) => row.id);
  const nextOrderIds = reorderDialogueRowIds({
    orderedRowIds: previousOrderIds,
    blockOrderIds,
    fromIndex,
    toIndex,
    blockRowIds,
  });
  return {
    command: { type: 'reorder', movingTexts, targetText, edge },
    previousOrderIds,
    nextOrderIds,
  };
}

export function applySynchronizedDialogueOrder(
  rows: AssetRow[],
  orderIds: readonly string[],
): AssetRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== orderIds.length || orderIds.some((id) => !byId.has(id))) {
    throw new Error('DIALOGUE_CACHE_ORDER_MISMATCH');
  }
  return orderIds.map((id, index) => ({ ...byId.get(id)!, rowIndex: index + 1 }));
}
