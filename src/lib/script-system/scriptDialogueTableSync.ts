import type { AssetRow } from '@/lib/types/libraryAssets';
import {
  buildScriptDialogueBlocks,
  sourceTextForDialogueBlock,
  type ScriptDialogueBlock,
} from './scriptDialogueBlocks';
import type { DerivedDialogueFieldKeys } from './scriptDialogueDerivedTableSync';
import type { ScriptDialogueDocumentCommand } from './scriptDialogueDocumentSync';

export class ScriptDialogueTableTypeConflictError extends Error {
  constructor() {
    super('Changing Type would break the dialogue row pairing.');
    this.name = 'ScriptDialogueTableTypeConflictError';
  }
}

export type ScriptDialogueTableCommandPlan = {
  command: ScriptDialogueDocumentCommand;
  replaceAssetIds?: string[];
};

function ordered(rows: AssetRow[]): AssetRow[] {
  return [...rows].sort((left, right) => (
    (left.rowIndex ?? 0) - (right.rowIndex ?? 0)
    || (left.created_at ?? '').localeCompare(right.created_at ?? '')
    || left.id.localeCompare(right.id)
  ));
}

function blockForAsset(
  blocks: ScriptDialogueBlock[],
  assetId: string,
): ScriptDialogueBlock | null {
  return blocks.find((block) => (
    block.actionRowId === assetId || block.speechRowId === assetId
  )) ?? null;
}

function stringValue(value: unknown): string {
  return value == null ? '' : String(value);
}

function sourceLine(block: ScriptDialogueBlock): string {
  if (block.speechType === '3') return block.dialogue || block.action;
  return block.action
    ? `${block.speaker}（${block.action}）：${block.dialogue}`
    : `${block.speaker}：${block.dialogue}`;
}

function planBlockEdit(
  block: ScriptDialogueBlock,
  next: { speaker: string; action: string; dialogue: string },
): ScriptDialogueTableCommandPlan | null {
  if (block.speechType === '3') {
    if (next.dialogue === block.dialogue) return null;
    return {
      command: {
        type: 'edit',
        role: 'narration',
        blockId: block.id,
        previousText: block.dialogue,
        nextText: next.dialogue,
      },
    };
  }
  if (
    next.speaker === block.speaker
    && next.action === block.action
    && next.dialogue === block.dialogue
  ) {
    return null;
  }
  if (!next.speaker) throw new ScriptDialogueTableTypeConflictError();
  return {
    command: {
      type: 'edit',
      role: 'action',
      blockId: block.id,
      previousText: block.action,
      previousDialogue: block.dialogue,
      previousSpeaker: block.speaker,
      nextText: next.action,
      speaker: next.speaker,
      dialogue: next.dialogue,
    },
  };
}

export function planScriptDialogueTableEdit(input: {
  rows: AssetRow[];
  fields: DerivedDialogueFieldKeys;
  assetId: string;
  assetName: string;
  propertyValues: Record<string, unknown>;
}): ScriptDialogueTableCommandPlan | null {
  const currentRow = input.rows.find((row) => row.id === input.assetId);
  if (!currentRow) return null;

  const previousType = stringValue(currentRow.propertyValues[input.fields.typeKey]).trim();
  const nextType = stringValue(input.propertyValues[input.fields.typeKey]).trim();
  if (previousType !== nextType) throw new ScriptDialogueTableTypeConflictError();

  const block = blockForAsset(
    buildScriptDialogueBlocks(ordered(input.rows), input.fields),
    input.assetId,
  );
  if (!block) {
    const insertion = planScriptDialogueTableInsert({
      rows: input.rows.filter((row) => row.id !== input.assetId),
      fields: input.fields,
      draftId: input.assetId,
      assetName: input.assetName,
      propertyValues: input.propertyValues,
      rowIndex: currentRow.rowIndex,
    });
    return insertion
      ? { ...insertion, replaceAssetIds: [input.assetId] }
      : null;
  }

  const nextSpeaker = stringValue(
    input.propertyValues[input.fields.nameKey] ?? input.assetName,
  ).trim();
  const nextContent = stringValue(input.propertyValues[input.fields.contentKey]);

  const nextAction = block.actionRowId === input.assetId ? nextContent : block.action;
  const nextDialogue = block.speechRowId === input.assetId ? nextContent : block.dialogue;
  return planBlockEdit(block, {
    speaker: nextSpeaker,
    action: nextAction,
    dialogue: nextDialogue,
  });
}

export function planScriptDialogueTableBatchEdits(input: {
  rows: AssetRow[];
  fields: DerivedDialogueFieldKeys;
  updates: Array<{
    assetId: string;
    assetName: string;
    propertyValues: Record<string, unknown>;
  }>;
}): ScriptDialogueTableCommandPlan[] {
  const updateById = new Map(input.updates.map((update) => [update.assetId, update]));
  for (const row of input.rows) {
    const update = updateById.get(row.id);
    if (!update) continue;
    const previousType = stringValue(row.propertyValues[input.fields.typeKey]).trim();
    const nextType = stringValue(update.propertyValues[input.fields.typeKey]).trim();
    if (previousType !== nextType) throw new ScriptDialogueTableTypeConflictError();
  }

  const blocks = buildScriptDialogueBlocks(ordered(input.rows), input.fields);
  const plans: ScriptDialogueTableCommandPlan[] = [];
  const mappedAssetIds = new Set<string>();
  for (const block of blocks) {
    const blockAssetIds = [block.actionRowId, block.speechRowId].filter(
      (id): id is string => Boolean(id),
    );
    const updates = blockAssetIds.flatMap((assetId) => {
      const update = updateById.get(assetId);
      return update ? [{ assetId, update }] : [];
    });
    if (updates.length === 0) continue;
    blockAssetIds.forEach((assetId) => mappedAssetIds.add(assetId));

    const changedSpeakers = updates.flatMap(({ assetId, update }) => {
      const row = input.rows.find((candidate) => candidate.id === assetId);
      if (!row) return [];
      const previous = stringValue(row.propertyValues[input.fields.nameKey]).trim();
      const next = stringValue(
        update.propertyValues[input.fields.nameKey] ?? update.assetName,
      ).trim();
      return previous === next ? [] : [next];
    });
    const uniqueSpeakers = [...new Set(changedSpeakers)];
    if (uniqueSpeakers.length > 1) throw new ScriptDialogueTableTypeConflictError();

    const actionUpdate = block.actionRowId
      ? updateById.get(block.actionRowId)
      : undefined;
    const speechUpdate = block.speechRowId
      ? updateById.get(block.speechRowId)
      : undefined;
    const plan = planBlockEdit(block, {
      speaker: uniqueSpeakers[0] ?? block.speaker,
      action: actionUpdate
        ? stringValue(actionUpdate.propertyValues[input.fields.contentKey])
        : block.action,
      dialogue: speechUpdate
        ? stringValue(speechUpdate.propertyValues[input.fields.contentKey])
        : block.dialogue,
    });
    if (plan) plans.push(plan);
  }

  for (const update of input.updates) {
    if (mappedAssetIds.has(update.assetId)) continue;
    const currentRow = input.rows.find((row) => row.id === update.assetId);
    if (!currentRow) continue;
    const plan = planScriptDialogueTableInsert({
      rows: input.rows.filter((row) => row.id !== update.assetId),
      fields: input.fields,
      draftId: update.assetId,
      assetName: update.assetName,
      propertyValues: update.propertyValues,
      rowIndex: currentRow.rowIndex,
    });
    if (plan) plans.push({ ...plan, replaceAssetIds: [update.assetId] });
  }
  return plans;
}

export function planScriptDialogueTableDelete(input: {
  rows: AssetRow[];
  fields: DerivedDialogueFieldKeys;
  assetId: string;
}): (ScriptDialogueTableCommandPlan & { assetIds: string[] }) | null {
  const block = blockForAsset(
    buildScriptDialogueBlocks(ordered(input.rows), input.fields),
    input.assetId,
  );
  if (!block) return null;
  const previousTexts = block.speechType === '3'
    ? [sourceTextForDialogueBlock(block, 'last')].filter(Boolean)
    : [
        block.action,
        block.dialogue ? `${block.speaker}：${block.dialogue}` : '',
      ].filter(Boolean);
  return {
    command: { type: 'delete', blockId: block.id, previousTexts },
    assetIds: [block.actionRowId, block.speechRowId].filter(
      (id): id is string => Boolean(id),
    ),
  };
}

export function planScriptDialogueTableInsert(input: {
  rows: AssetRow[];
  fields: DerivedDialogueFieldKeys;
  draftId: string;
  assetName: string;
  propertyValues: Record<string, unknown>;
  rowIndex?: number;
}): ScriptDialogueTableCommandPlan | null {
  const draft: AssetRow = {
    id: input.draftId,
    libraryId: input.rows[0]?.libraryId ?? '',
    name: input.assetName,
    propertyValues: { ...input.propertyValues },
    rowIndex: input.rowIndex,
  };
  const draftBlock = blockForAsset(
    buildScriptDialogueBlocks([draft], input.fields),
    draft.id,
  );
  if (!draftBlock || (!draftBlock.dialogue.trim() && !draftBlock.action.trim())) {
    return null;
  }

  const orderedRows = ordered(input.rows);
  const blocks = buildScriptDialogueBlocks(orderedRows, input.fields);
  const insertionIndex = input.rowIndex == null
    ? blocks.length
    : blocks.findIndex((block) => block.rowIndexes.some(
        (index) => (orderedRows[index]?.rowIndex ?? 0) >= input.rowIndex!,
      ));
  const normalizedIndex = insertionIndex < 0 ? blocks.length : insertionIndex;
  const previous = normalizedIndex > 0 ? blocks[normalizedIndex - 1] : null;
  const next = normalizedIndex < blocks.length ? blocks[normalizedIndex] : null;
  return {
    command: {
      type: 'insert',
      blockId: input.draftId,
      text: sourceLine(draftBlock),
      ...(previous ? { afterText: sourceTextForDialogueBlock(previous, 'last') } : {}),
      ...(next ? { beforeText: sourceTextForDialogueBlock(next, 'first') } : {}),
    },
  };
}
