import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { getLibraryAssetsWithProperties } from '@/lib/services/libraryAssetsService';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { DocumentStateConflictError } from '@/lib/documents/documentStateTypes';
import { buildScriptDialogueBlocks, listScriptDialogueCharacters, sourceTextForDialogueBlock } from '@/lib/script-system/scriptDialogueBlocks';
import { applyScriptDialogueCommand, type ScriptDialogueDocumentCommand } from '@/lib/script-system/scriptDialogueDocumentSync';
import { planSynchronizedDialogueReorder } from '@/lib/script-system/scriptDialogueReorderSync';
import { reconcileScriptPlotPlanRowOrder } from '@/lib/script-system/scriptPlotPlanSync';
import { prepareScriptDialogueLibraryReconciliation } from '@/lib/server/scriptDialogueDerivedTableSyncService';
import { readScriptDialogueOriginFingerprint } from '@/lib/server/scriptDialogueOriginSnapshot';
import { parseStoryPlotPlan, type StoryPlotPlan } from '@/lib/story-plot/schema';
import { sortAssetsForUiRow } from '@/lib/utils/assetEmptiness';
import { readScriptMutationReceipt, runAtomicScriptDialogueMutation, type ScriptMutationReceipt } from './script-dialogue-mutation-service';
import { requireProjectContext } from './workspace';
import type { ConfirmationPreparation, ToolContext, ToolResult } from './types';

const uuid = z.string().uuid();
const cas = {
  expectedEpoch: z.number().int().nonnegative().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  expectedPlotPlanHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
};
const insertSchema = z.object({ libraryId: uuid, afterBlockId: uuid.optional(),
  speaker: z.string().trim().min(1).max(64), actionText: z.string().max(10000),
  dialogue: z.string().trim().min(1).max(20000), idempotencyKey: uuid, ...cas }).strict();
const deleteSchema = z.object({ libraryId: uuid, blockId: uuid, idempotencyKey: uuid, ...cas }).strict();
const editSchema = z.object({ libraryId: uuid, blockId: uuid, actionText: z.string().max(10000),
  dialogue: z.string().max(20000), idempotencyKey: uuid, ...cas }).strict();
const speakerSchema = z.object({ libraryId: uuid, blockId: uuid,
  speaker: z.string().trim().min(1).max(64), idempotencyKey: uuid, ...cas }).strict();
const reorderSchema = z.object({ libraryId: uuid, movingBlockId: uuid,
  targetBlockId: uuid, idempotencyKey: uuid, ...cas }).strict();
const undoSchema = z.object({ libraryId: uuid, operationId: uuid, idempotencyKey: uuid, ...cas }).strict();
type Kind = 'insert' | 'delete' | 'edit' | 'speaker' | 'reorder' | 'undo';
type Params = z.infer<typeof insertSchema> | z.infer<typeof deleteSchema> | z.infer<typeof editSchema>
  | z.infer<typeof speakerSchema> | z.infer<typeof reorderSchema> | z.infer<typeof undoSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function stableUuid(key: string, purpose: string): string {
  const bytes = Buffer.from(createHash('sha256').update(`${key}:${purpose}`).digest());
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function publicRequest(kind: Kind, params: Params) {
  if (kind === 'insert') {
    const input = params as z.infer<typeof insertSchema>;
    return { kind, libraryId: input.libraryId, afterBlockId: input.afterBlockId ?? null,
      speaker: input.speaker, actionText: input.actionText, dialogue: input.dialogue };
  }
  if (kind === 'delete') {
    return { kind, libraryId: params.libraryId, blockId: (params as z.infer<typeof deleteSchema>).blockId };
  }
  if (kind === 'edit') {
    const input = params as z.infer<typeof editSchema>;
    return { kind, libraryId: input.libraryId, blockId: input.blockId,
      actionText: input.actionText, dialogue: input.dialogue };
  }
  if (kind === 'speaker') {
    const input = params as z.infer<typeof speakerSchema>;
    return { kind, libraryId: input.libraryId, blockId: input.blockId, speaker: input.speaker };
  }
  if (kind === 'reorder') {
    const input = params as z.infer<typeof reorderSchema>;
    return { kind, libraryId: input.libraryId, movingBlockId: input.movingBlockId,
      targetBlockId: input.targetBlockId };
  }
  return { kind, libraryId: params.libraryId, operationId: (params as z.infer<typeof undoSchema>).operationId };
}

async function snapshot(ctx: ToolContext, libraryId: string) {
  const projectId = requireProjectContext(ctx);
  const { role } = await getUserProjectRole(ctx.supabase, projectId, ctx.userId);
  if (role !== 'admin' && role !== 'editor') throw new Error('Only project editors can change Script dialogue.');
  const { data: library, error } = await ctx.supabase.from('libraries')
    .select('id,project_id,name,source_document_id,document_export_type,plot_plan')
    .eq('id', libraryId).maybeSingle();
  if (error) throw error;
  if (!library || library.project_id !== projectId || library.document_export_type !== 'script'
    || !library.source_document_id) throw new Error('Derived Script not found in this project.');
  const state = await documentStateGateway.read(ctx.supabase, library.source_document_id);
  if (state.projectId !== projectId) throw new Error('Source document not found in this project.');
  const { data: definitions, error: fieldError } = await ctx.supabase.from('library_field_definitions')
    .select('id,label').eq('library_id', libraryId);
  if (fieldError) throw fieldError;
  const labels = new Map((definitions ?? []).map((field) => [String(field.label).trim().toLowerCase(), String(field.id)]));
  const fields = { typeKey: labels.get('type'), nameKey: labels.get('name'), contentKey: labels.get('content') };
  if (!fields.typeKey || !fields.nameKey || !fields.contentKey) throw new Error('Script dialogue fields are unavailable.');
  const rows = sortAssetsForUiRow(await getLibraryAssetsWithProperties(ctx.supabase, libraryId, {
    userId: ctx.userId, cache: ctx.accessCache ?? new Map(),
  }));
  const plotPlan = parseStoryPlotPlan(library.plot_plan);
  return { projectId, library, state, rows, fields: {
    typeKey: fields.typeKey, nameKey: fields.nameKey, contentKey: fields.contentKey,
  }, blocks: buildScriptDialogueBlocks(rows, fields), plotPlan,
  fingerprint: await readScriptDialogueOriginFingerprint(libraryId) };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;

function sourceText(speaker: string, action: string, dialogue: string): string {
  return action.trim() ? `${speaker}（${action.trim()}）：${dialogue.trim()}` : `${speaker}：${dialogue.trim()}`;
}

type Plan = { command: ScriptDialogueDocumentCommand; markdown: string;
  operation: Record<string, unknown>; plotPlan: StoryPlotPlan; undoPayload: Record<string, unknown> };

async function planInsert(ctx: ToolContext, input: z.infer<typeof insertSchema>, current: Snapshot): Promise<Plan> {
  if (/\r|\n/.test(input.speaker + input.actionText + input.dialogue)) {
    throw new Error('A Script dialogue line must not contain a newline.');
  }
  if (!listScriptDialogueCharacters(current.rows, current.fields).some((character) => character.name === input.speaker)) {
    throw new Error('Speaker must be an existing Script character.');
  }
  const anchorIndex = input.afterBlockId
    ? current.blocks.findIndex((block) => block.id === input.afterBlockId)
    : current.blocks.length - 1;
  if (input.afterBlockId && anchorIndex < 0) throw new Error('Anchor dialogue block not found.');
  const afterText = anchorIndex >= 0 ? sourceTextForDialogueBlock(current.blocks[anchorIndex], 'last') : '';
  const beforeText = anchorIndex + 1 < current.blocks.length
    ? sourceTextForDialogueBlock(current.blocks[anchorIndex + 1], 'first') : '';
  if (current.blocks.length > 0 && !afterText && !beforeText) {
    throw new Error('Anchor dialogue has no source text.');
  }
  const text = sourceText(input.speaker, input.actionText, input.dialogue);
  const command: ScriptDialogueDocumentCommand = { type: 'insert',
    blockId: stableUuid(input.idempotencyKey, 'source-block'), text,
    ...(afterText ? { afterText } : {}), ...(beforeText ? { beforeText } : {}) };
  const transformed = applyScriptDialogueCommand(current.state.markdown, command);
  const prepared = await prepareScriptDialogueLibraryReconciliation({
    supabase: ctx.supabase, libraryId: input.libraryId, command,
    access: { userId: ctx.userId, cache: ctx.accessCache ?? new Map() },
  });
  if (prepared.operation.type !== 'insert') throw new Error('Script insert mapping is ambiguous.');
  const actionRowId = stableUuid(input.idempotencyKey, 'action-row');
  const speechRowId = stableUuid(input.idempotencyKey, 'speech-row');
  const currentOrderIds = prepared.currentOrderIds;
  const insertIndex = prepared.operation.afterRowId
    ? currentOrderIds.indexOf(prepared.operation.afterRowId) + 1
    : prepared.operation.insertAtStart ? 0 : currentOrderIds.length;
  if (insertIndex < 0) throw new Error('Script insert position is ambiguous.');
  const nextOrderIds = [...currentOrderIds];
  nextOrderIds.splice(insertIndex, 0, actionRowId, speechRowId);
  const operation = { ...prepared.operation, actionRowId, speechRowId,
    expectedOrderIds: currentOrderIds, nextOrderIds };
  const plotPlan = reconcileScriptPlotPlanRowOrder(current.plotPlan, {
    currentRowIds: currentOrderIds, nextRowIds: nextOrderIds, flowRows: prepared.flowRows,
  });
  return { command, markdown: transformed.markdown, operation, plotPlan,
    undoPayload: { sourceBlockId: command.blockId, sourceText: text,
      speaker: input.speaker, action: input.actionText, dialogue: input.dialogue,
      speechType: prepared.operation.speechType,
      afterText: afterText || null, beforeText: beforeText || null } };
}

async function planDelete(ctx: ToolContext, input: z.infer<typeof deleteSchema>, current: Snapshot): Promise<Plan> {
  const blockIndex = current.blocks.findIndex((block) => block.id === input.blockId);
  const block = current.blocks[blockIndex];
  if (!block || !block.actionRowId || !block.speechRowId || !block.dialogue.trim()) {
    throw new Error('Only a complete action and speech block can be deleted safely.');
  }
  if (current.rows.length <= 2) throw new Error('The final Script block cannot be deleted while plot plans require a node.');
  const previousTexts = [block.action, `${block.speaker}：${block.dialogue}`].filter(Boolean);
  const command: ScriptDialogueDocumentCommand = { type: 'delete', previousTexts };
  const transformed = applyScriptDialogueCommand(current.state.markdown, command);
  const prepared = await prepareScriptDialogueLibraryReconciliation({
    supabase: ctx.supabase, libraryId: input.libraryId, command,
    access: { userId: ctx.userId, cache: ctx.accessCache ?? new Map() },
  });
  if (prepared.operation.type !== 'delete'
    || prepared.operation.actionRowId !== block.actionRowId
    || prepared.operation.speechRowId !== block.speechRowId) {
    throw new Error('Script deletion mapping is ambiguous.');
  }
  const currentOrderIds = prepared.currentOrderIds;
  const deletedIds = new Set([block.actionRowId, block.speechRowId]);
  const nextOrderIds = currentOrderIds.filter((id) => !deletedIds.has(id));
  if (nextOrderIds.length === 0) throw new Error('The final Script block cannot be deleted.');
  const operation = { ...prepared.operation, expectedOrderIds: currentOrderIds, nextOrderIds };
  const plotPlan = reconcileScriptPlotPlanRowOrder(current.plotPlan, {
    currentRowIds: currentOrderIds, nextRowIds: nextOrderIds, flowRows: prepared.flowRows,
  });
  const previousBlock = current.blocks[blockIndex - 1];
  const nextBlock = current.blocks[blockIndex + 1];
  return { command, markdown: transformed.markdown, operation, plotPlan,
    undoPayload: { speaker: block.speaker, action: block.action, dialogue: block.dialogue,
      speechType: block.speechType, sourceText: sourceText(block.speaker, block.action, block.dialogue),
      afterText: previousBlock ? sourceTextForDialogueBlock(previousBlock, 'last') : null,
      beforeText: nextBlock ? sourceTextForDialogueBlock(nextBlock, 'first') : null } };
}

async function planEdit(ctx: ToolContext, kind: 'edit' | 'speaker',
  input: z.infer<typeof editSchema> | z.infer<typeof speakerSchema>, current: Snapshot): Promise<Plan> {
  const block = current.blocks.find((candidate) => candidate.id === input.blockId);
  if (!block) throw new Error('Dialogue block not found in this Script.');
  let command: ScriptDialogueDocumentCommand;
  if (kind === 'speaker') {
    const speaker = (input as z.infer<typeof speakerSchema>).speaker;
    if (speaker === block.speaker) throw new Error('No Script dialogue changes to apply.');
    if (block.speechType === '3' || !block.dialogue.trim()) throw new Error('This dialogue block cannot change speaker safely.');
    if (!listScriptDialogueCharacters(current.rows, current.fields).some((character) => character.name === speaker)) {
      throw new Error('Speaker must be an existing Script character.');
    }
    command = { type: 'edit', role: 'action', blockId: block.id,
      previousText: block.action, nextText: block.action,
      previousSpeaker: block.speaker, speaker,
      previousDialogue: block.dialogue, dialogue: block.dialogue };
  } else {
    const edit = input as z.infer<typeof editSchema>;
    if (edit.actionText === block.action && edit.dialogue === block.dialogue) {
      throw new Error('No Script dialogue changes to apply.');
    }
    if (block.speechType === '3') {
      if (edit.actionText.trim()) throw new Error('Narration blocks cannot have an action cue.');
      if (!block.dialogue.trim()) throw new Error('Blank narration cannot be matched to the source document.');
      command = { type: 'edit', role: 'narration', previousText: block.dialogue, nextText: edit.dialogue };
    } else {
      if (!block.dialogue.trim() && (!block.actionRowId || !edit.dialogue.trim())) {
        throw new Error('Blank dialogue cannot be matched to the source document.');
      }
      command = { type: 'edit', role: 'action', blockId: block.id,
        previousText: block.action, nextText: edit.actionText,
        speaker: block.speaker, previousDialogue: block.dialogue, dialogue: edit.dialogue };
    }
  }
  const transformed = applyScriptDialogueCommand(current.state.markdown, command);
  const prepared = await prepareScriptDialogueLibraryReconciliation({
    supabase: ctx.supabase, libraryId: input.libraryId, command,
    access: { userId: ctx.userId, cache: ctx.accessCache ?? new Map() },
  });
  if (prepared.operation.type !== 'edit'
    || prepared.operation.actionRowId !== (block.actionRowId ?? null)
    || prepared.operation.speechRowId !== (block.speechRowId ?? null)) {
    throw new Error('Script edit mapping is ambiguous.');
  }
  const order = prepared.currentOrderIds;
  const createsActionRow = kind === 'edit' && !block.actionRowId
    && Boolean((input as z.infer<typeof editSchema>).actionText.trim());
  const createsSpeechRow = kind === 'edit' && !block.speechRowId
    && Boolean((input as z.infer<typeof editSchema>).dialogue.trim());
  const createdActionRowId = createsActionRow ? stableUuid(input.idempotencyKey, 'action-row') : null;
  const createdSpeechRowId = createsSpeechRow ? stableUuid(input.idempotencyKey, 'speech-row') : null;
  const nextOrder = [...order];
  if (createdActionRowId) {
    const speechIndex = nextOrder.indexOf(block.speechRowId ?? '');
    if (speechIndex < 0) throw new Error('Script edit mapping is ambiguous.');
    nextOrder.splice(speechIndex, 0, createdActionRowId);
  }
  if (createdSpeechRowId) {
    const actionIndex = nextOrder.indexOf(block.actionRowId ?? '');
    if (actionIndex < 0) throw new Error('Script edit mapping is ambiguous.');
    nextOrder.splice(actionIndex + 1, 0, createdSpeechRowId);
  }
  const operation = { ...prepared.operation,
    ...(createdActionRowId ? { actionRowId: createdActionRowId, createActionRowId: createdActionRowId } : {}),
    ...(createdSpeechRowId ? { speechRowId: createdSpeechRowId, createSpeechRowId: createdSpeechRowId } : {}),
    expectedOrderIds: order, nextOrderIds: nextOrder };
  return { command, markdown: transformed.markdown,
    operation,
    plotPlan: createdActionRowId || createdSpeechRowId
      ? reconcileScriptPlotPlanRowOrder(current.plotPlan, {
        currentRowIds: order, nextRowIds: nextOrder, flowRows: prepared.flowRows,
      }) : current.plotPlan,
    undoPayload: { speaker: block.speaker, action: block.action,
      dialogue: block.dialogue, speechType: block.speechType,
      newSpeaker: prepared.operation.speaker,
      newAction: prepared.operation.action, newDialogue: prepared.operation.dialogue,
      ...(createdActionRowId ? { createdActionRowId } : {}),
      ...(createdSpeechRowId ? { createdSpeechRowId } : {}) } };
}

async function planReorder(ctx: ToolContext, input: z.infer<typeof reorderSchema>, current: Snapshot): Promise<Plan> {
  const fromIndex = current.blocks.findIndex((block) => block.id === input.movingBlockId);
  const toIndex = current.blocks.findIndex((block) => block.id === input.targetBlockId);
  const planned = planSynchronizedDialogueReorder({
    blocks: current.blocks, rows: current.rows, fromIndex, toIndex,
  });
  if (!planned) throw new Error('These dialogue blocks cannot be safely reordered.');
  const transformed = applyScriptDialogueCommand(current.state.markdown, planned.command);
  const prepared = await prepareScriptDialogueLibraryReconciliation({
    supabase: ctx.supabase, libraryId: input.libraryId, command: planned.command,
    access: { userId: ctx.userId, cache: ctx.accessCache ?? new Map() },
  });
  if (prepared.operation.type !== 'reorder'
    || hash(prepared.operation.expectedOrderIds) !== hash(planned.previousOrderIds)
    || hash(prepared.operation.nextOrderIds) !== hash(planned.nextOrderIds)) {
    throw new Error('Script reorder mapping is ambiguous.');
  }
  return { command: planned.command, markdown: transformed.markdown,
    operation: prepared.operation,
    plotPlan: reconcileScriptPlotPlanRowOrder(current.plotPlan, {
      currentRowIds: planned.previousOrderIds, nextRowIds: planned.nextOrderIds,
      flowRows: prepared.flowRows,
    }),
    undoPayload: { movingBlockId: input.movingBlockId,
      previousBlockIds: current.blocks.map((block) => block.id) } };
}

function planUndo(receipt: ScriptMutationReceipt, current: Snapshot): Plan {
  const previous = receipt.operation;
  const payload = receipt.undo_payload;
  const originalType = previous.type;
  if (!['insert', 'delete', 'edit', 'reorder'].includes(String(originalType))) {
    throw new Error('This Script action cannot be undone.');
  }
  const originalBefore = previous.expectedOrderIds;
  const originalAfter = previous.nextOrderIds;
  if (!Array.isArray(originalBefore) || !Array.isArray(originalAfter)) throw new Error('Script undo receipt is incomplete.');
  if (originalType === 'edit') {
    const prior = [payload.speaker, payload.action, payload.dialogue, payload.speechType];
    const next = [payload.newSpeaker, payload.newAction, payload.newDialogue];
    if (prior.some((value) => typeof value !== 'string') || next.some((value) => typeof value !== 'string')) {
      throw new Error('Script undo receipt is incomplete.');
    }
    const command: ScriptDialogueDocumentCommand = payload.speechType === '3'
      ? { type: 'edit', role: 'narration', previousText: String(payload.newDialogue),
        nextText: String(payload.dialogue) }
      : { type: 'edit', role: 'action',
        previousText: String(payload.newAction), nextText: String(payload.action),
        previousSpeaker: String(payload.newSpeaker), speaker: String(payload.speaker),
        previousDialogue: String(payload.newDialogue), dialogue: String(payload.dialogue) };
    const createdActionRowId = payload.createdActionRowId;
    const createdSpeechRowId = payload.createdSpeechRowId;
    if (createdActionRowId !== undefined && (!uuid.safeParse(createdActionRowId).success
      || previous.createActionRowId !== createdActionRowId)
      || createdSpeechRowId !== undefined && (!uuid.safeParse(createdSpeechRowId).success
        || previous.createSpeechRowId !== createdSpeechRowId)) {
      throw new Error('Script undo receipt is incomplete.');
    }
    return { command, markdown: receipt.before_markdown,
      operation: { ...previous, speaker: payload.speaker, action: payload.action,
        dialogue: payload.dialogue, speechType: payload.speechType,
        ...(createdActionRowId ? { createActionRowId: null, actionRowId: null,
          deleteActionRowId: createdActionRowId } : {}),
        ...(createdSpeechRowId ? { createSpeechRowId: null, speechRowId: null,
          deleteSpeechRowId: createdSpeechRowId } : {}),
        expectedOrderIds: originalAfter, nextOrderIds: originalBefore },
      plotPlan: receipt.before_plot_plan, undoPayload: { undoOf: receipt.idempotency_key } };
  }
  if (originalType === 'reorder') {
    const movingBlockId = String(payload.movingBlockId ?? '');
    const previousBlockIds = payload.previousBlockIds;
    if (!uuid.safeParse(movingBlockId).success || !Array.isArray(previousBlockIds)
      || previousBlockIds.some((id) => !uuid.safeParse(id).success)) {
      throw new Error('Script undo receipt is incomplete.');
    }
    const planned = planSynchronizedDialogueReorder({ blocks: current.blocks, rows: current.rows,
      fromIndex: current.blocks.findIndex((block) => block.id === movingBlockId),
      toIndex: previousBlockIds.indexOf(movingBlockId) });
    if (!planned || hash(planned.previousOrderIds) !== hash(originalAfter)
      || hash(planned.nextOrderIds) !== hash(originalBefore)) {
      throw new Error('The Script action is no longer current and cannot be undone.');
    }
    return { command: planned.command, markdown: receipt.before_markdown,
      operation: { ...previous, expectedOrderIds: originalAfter, nextOrderIds: originalBefore },
      plotPlan: receipt.before_plot_plan, undoPayload: { undoOf: receipt.idempotency_key } };
  }
  const actionRowId = String(previous.actionRowId ?? '');
  const speechRowId = String(previous.speechRowId ?? '');
  if (!uuid.safeParse(actionRowId).success || !uuid.safeParse(speechRowId).success) {
    throw new Error('Script undo receipt has invalid row IDs.');
  }
  const operation = originalType === 'insert'
    ? { ...previous, type: 'delete', expectedOrderIds: originalAfter, nextOrderIds: originalBefore }
    : { ...previous, type: 'insert', expectedOrderIds: originalAfter, nextOrderIds: originalBefore,
      afterRowId: (() => { const index = originalBefore.indexOf(actionRowId);
        return index > 0 ? originalBefore[index - 1] : null; })(),
      insertAtStart: originalBefore[0] === actionRowId,
      speaker: payload.speaker, action: payload.action, dialogue: payload.dialogue,
      speechType: payload.speechType };
  const previousTexts = [String(payload.action ?? ''),
    `${String(payload.speaker ?? '')}：${String(payload.dialogue ?? '')}`].filter(Boolean);
  const command: ScriptDialogueDocumentCommand = originalType === 'insert'
    ? { type: 'delete', blockId: String(payload.sourceBlockId), previousTexts: [String(payload.sourceText)] }
    : { type: 'insert', blockId: stableUuid(receipt.idempotency_key, 'undo-source'),
      text: String(payload.sourceText),
      ...(payload.afterText ? { afterText: String(payload.afterText) } : {}),
      ...(payload.beforeText ? { beforeText: String(payload.beforeText) } : {}) };
  // Sibling tables identify a deleted block by its action and speech, not by
  // the combined source line. The source itself is restored from the receipt.
  if (originalType === 'insert') {
    (command as Extract<ScriptDialogueDocumentCommand, { type: 'delete' }>).previousTexts = previousTexts;
  }
  return { command, markdown: receipt.before_markdown, operation,
    plotPlan: receipt.before_plot_plan, undoPayload: { undoOf: receipt.idempotency_key } };
}

function ensureCas(params: Params, current: Snapshot): void {
  if (params.expectedEpoch === undefined || params.expectedRevision === undefined
    || !params.expectedFingerprint || !params.expectedPlotPlanHash) {
    throw new Error('Script confirmation data is unavailable; preview again.');
  }
  if (current.state.token.epoch !== params.expectedEpoch
    || current.state.token.revision !== params.expectedRevision
    || current.fingerprint !== params.expectedFingerprint
    || hash(current.plotPlan) !== params.expectedPlotPlanHash) {
    throw new Error('Script changed after approval; preview the action again.');
  }
}

async function requireUndoReceipt(ctx: ToolContext, input: z.infer<typeof undoSchema>, current: Snapshot) {
  const receipt = await readScriptMutationReceipt(input.operationId);
  if (!receipt || receipt.actor_user_id !== ctx.userId || receipt.project_id !== current.projectId
    || receipt.library_id !== input.libraryId || receipt.document_id !== current.library.source_document_id
    || receipt.undone_by || receipt.undo_of
    || receipt.result_epoch !== current.state.token.epoch
    || receipt.result_revision !== current.state.token.revision
    || receipt.result_fingerprint !== current.fingerprint
    || hash(receipt.after_plot_plan) !== hash(current.plotPlan)
    || receipt.after_markdown !== current.state.markdown) {
    throw new Error('The Script action is no longer current and cannot be undone.');
  }
  return receipt;
}

function schemaFor(kind: Kind) {
  switch (kind) {
    case 'insert': return insertSchema;
    case 'delete': return deleteSchema;
    case 'edit': return editSchema;
    case 'speaker': return speakerSchema;
    case 'reorder': return reorderSchema;
    case 'undo': return undoSchema;
  }
}
async function planFor(kind: Kind, input: Params, ctx: ToolContext, current: Snapshot): Promise<Plan> {
  switch (kind) {
    case 'insert': return planInsert(ctx, input as z.infer<typeof insertSchema>, current);
    case 'delete': return planDelete(ctx, input as z.infer<typeof deleteSchema>, current);
    case 'edit': return planEdit(ctx, kind, input as z.infer<typeof editSchema>, current);
    case 'speaker': return planEdit(ctx, kind, input as z.infer<typeof speakerSchema>, current);
    case 'reorder': return planReorder(ctx, input as z.infer<typeof reorderSchema>, current);
    case 'undo': return planUndo(await requireUndoReceipt(ctx, input as z.infer<typeof undoSchema>, current), current);
  }
}
function failed(error: unknown): ToolResult {
  if (error instanceof DocumentStateConflictError) {
    return { success: false, error: 'Script changed after approval; preview the action again.' };
  }
  const message = error instanceof Error ? error.message : '';
  const known = [
    'Only project editors can change Script dialogue.',
    'Derived Script not found in this project.',
    'Source document not found in this project.',
    'Script dialogue fields are unavailable.',
    'A Script dialogue line must not contain a newline.',
    'Speaker must be an existing Script character.',
    'Anchor dialogue block not found.',
    'Anchor dialogue has no source text.',
    'Script insert position is ambiguous.',
    'Only a complete action and speech block can be deleted safely.',
    'The final Script block cannot be deleted while plot plans require a node.',
    'The final Script block cannot be deleted.',
    'Script deletion mapping is ambiguous.',
    'Dialogue block not found in this Script.',
    'This dialogue block cannot change speaker safely.',
    'Narration blocks cannot have an action cue.',
    'Blank narration cannot be matched to the source document.',
    'Blank dialogue cannot be matched to the source document.',
    'Script edit mapping is ambiguous.',
    'No Script dialogue changes to apply.',
    'These dialogue blocks cannot be safely reordered.',
    'Script reorder mapping is ambiguous.',
    'This Script action cannot be undone.',
    'Script undo receipt is incomplete.',
    'Script undo receipt has invalid row IDs.',
    'Script confirmation data is unavailable; preview again.',
    'Script changed after approval; preview the action again.',
    'The Script action is no longer current and cannot be undone.',
    'IDEMPOTENCY_CONFLICT: key belongs to another Script action.',
  ];
  if (known.includes(message)) return { success: false, error: message };
  if (/^SOURCE_MAPPING_AMBIGUOUS/.test(message)) {
    return { success: false, error: 'The source dialogue could not be matched uniquely. Refresh the Script and try again.' };
  }
  if (/^(DERIVED_TABLE_MAPPING_AMBIGUOUS|PLOT_PLAN_)/.test(message)) {
    return { success: false, error: 'Script rows or plot plan changed. Refresh the Script and try again.' };
  }
  if (message === 'FORBIDDEN') {
    return { success: false, error: 'You do not have permission to change this Script.' };
  }
  return { success: false, error: 'Script dialogue action failed.' };
}

function mutationInvalidations(projectId: string, libraryId: string, documentId: string): NonNullable<ToolResult['invalidations']> {
  return [
    { type: 'documents', projectId, documentId },
    { type: 'library', id: libraryId, projectId, sourceDocumentId: documentId },
    { type: 'script-workspace', projectId },
  ];
}

async function prepare(kind: Kind, params: unknown, ctx: ToolContext): Promise<ConfirmationPreparation> {
  const parsed = schemaFor(kind).safeParse(params);
  if (!parsed.success) return { success: false, error: `Invalid ${kind} Script dialogue parameters.` };
  try {
    const input = parsed.data as Params;
    const current = await snapshot(ctx, input.libraryId);
    const plan = await planFor(kind, input, ctx, current);
    return { success: true, args: { ...input,
      expectedEpoch: current.state.token.epoch, expectedRevision: current.state.token.revision,
      expectedFingerprint: current.fingerprint, expectedPlotPlanHash: hash(current.plotPlan) },
      preview: { projectId: current.projectId, libraryId: input.libraryId,
        libraryName: current.library.name, action: kind,
        ...(kind === 'insert' ? { speaker: (input as z.infer<typeof insertSchema>).speaker,
          dialogue: (input as z.infer<typeof insertSchema>).dialogue,
          actionText: (input as z.infer<typeof insertSchema>).actionText,
          afterBlockId: (input as z.infer<typeof insertSchema>).afterBlockId ?? null }
          : kind === 'delete' ? { blockId: (input as z.infer<typeof deleteSchema>).blockId }
            : kind === 'edit' || kind === 'speaker' ? (() => {
              const blockId = (input as z.infer<typeof editSchema>).blockId;
              const block = current.blocks.find((candidate) => candidate.id === blockId)!;
              return { blockId, currentSpeaker: block.speaker, currentAction: block.action,
                currentDialogue: block.dialogue,
                ...(kind === 'edit' ? { actionText: (input as z.infer<typeof editSchema>).actionText,
                  dialogue: (input as z.infer<typeof editSchema>).dialogue }
                  : { speaker: (input as z.infer<typeof speakerSchema>).speaker }) };
            })()
              : kind === 'reorder' ? { movingBlockId: (input as z.infer<typeof reorderSchema>).movingBlockId,
                targetBlockId: (input as z.infer<typeof reorderSchema>).targetBlockId,
                placement: current.blocks.findIndex((block) => block.id === (input as z.infer<typeof reorderSchema>).movingBlockId)
                  > current.blocks.findIndex((block) => block.id === (input as z.infer<typeof reorderSchema>).targetBlockId)
                  ? 'before target' : 'after target' }
              : { operationId: (input as z.infer<typeof undoSchema>).operationId }),
        affectedRowIds: plan.operation.nextOrderIds,
        consequence: kind === 'delete' ? 'Delete the dialogue from the source Document, Script rows, and plot plan.'
          : kind === 'undo' ? 'Restore the immediately preceding AI Script action in all three records.'
            : kind === 'insert' ? 'Insert dialogue into the source Document, Script rows, and plot plan.'
              : 'Update the source Document, Script rows, and plot plan.' } };
  } catch (error) { return { success: false, error: failed(error).error! }; }
}

async function execute(kind: Kind, params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = schemaFor(kind).safeParse(params);
  if (!parsed.success) return { success: false, error: `Invalid ${kind} Script dialogue parameters.` };
  try {
    const input = parsed.data as Params;
    const current = await snapshot(ctx, input.libraryId);
    const requestHash = hash(publicRequest(kind, input));
    const replay = await readScriptMutationReceipt(input.idempotencyKey);
    if (replay) {
      if (replay.actor_user_id !== ctx.userId || replay.project_id !== current.projectId
        || replay.library_id !== input.libraryId || replay.request_hash !== requestHash) {
        throw new Error('IDEMPOTENCY_CONFLICT: key belongs to another Script action.');
      }
      return { success: true, data: { operationId: input.idempotencyKey,
        documentId: replay.document_id, libraryId: input.libraryId,
        revision: replay.result_revision, replayed: true },
      invalidations: mutationInvalidations(current.projectId, input.libraryId, replay.document_id) };
    }
    ensureCas(input, current);
    const plan = await planFor(kind, input, ctx, current);
    let result: { epoch: number; revision: number };
    try {
      result = await runAtomicScriptDialogueMutation({
      supabase: ctx.supabase, actorUserId: ctx.userId, projectId: current.projectId,
      documentId: current.library.source_document_id, libraryId: input.libraryId,
      expected: current.state.token, expectedMarkdown: current.state.markdown,
      expectedUpdateIds: current.state.updateTail.map((update) => update.id),
      expectedFingerprint: current.fingerprint, expectedPlotPlan: current.plotPlan,
      command: plan.command, markdown: plan.markdown, operation: plan.operation,
      plotPlan: plan.plotPlan, idempotencyKey: input.idempotencyKey, requestHash,
      undoPayload: plan.undoPayload,
      ...(kind === 'undo' ? { undoOf: (input as z.infer<typeof undoSchema>).operationId } : {}),
      });
    } catch (error) {
      const completed = await readScriptMutationReceipt(input.idempotencyKey);
      if (completed?.actor_user_id === ctx.userId && completed.project_id === current.projectId
        && completed.library_id === input.libraryId && completed.request_hash === requestHash) {
        return { success: true, data: { operationId: input.idempotencyKey,
          documentId: completed.document_id, libraryId: input.libraryId,
          revision: completed.result_revision, replayed: true },
        invalidations: mutationInvalidations(current.projectId, input.libraryId, completed.document_id) };
      }
      throw error;
    }
    return { success: true, data: { operationId: input.idempotencyKey,
      projectId: current.projectId, libraryId: input.libraryId,
      documentId: current.library.source_document_id, revision: result.revision,
      ...(kind === 'insert' ? { blockId: plan.operation.speechRowId } : {}) },
      invalidations: mutationInvalidations(current.projectId, input.libraryId, current.library.source_document_id) };
  } catch (error) { return failed(error); }
}

export function prepareScriptDialogueAction(kind: Kind, params: unknown, ctx: ToolContext): Promise<ConfirmationPreparation> {
  return prepare(kind, params, ctx);
}

export function executeScriptDialogueAction(kind: Kind, params: unknown, ctx: ToolContext): Promise<ToolResult> {
  return execute(kind, params, ctx);
}
