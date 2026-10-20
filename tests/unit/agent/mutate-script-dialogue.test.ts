import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { getLibraryAssetsWithProperties } from '@/lib/services/libraryAssetsService';
import { prepareScriptDialogueLibraryReconciliation } from '@/lib/server/scriptDialogueDerivedTableSyncService';
import { readScriptDialogueOriginFingerprint } from '@/lib/server/scriptDialogueOriginSnapshot';
import { readScriptMutationReceipt, runAtomicScriptDialogueMutation } from '@/lib/agent/script-dialogue-mutation-service';
import { insertScriptDialogueTool, deleteScriptDialogueBlockTool, undoScriptDialogueActionTool } from '@/lib/agent/tools/mutate-script-dialogue';
import { editScriptDialogueTool, changeScriptDialogueSpeakerTool } from '@/lib/agent/tools/edit-script-dialogue';
import { reorderScriptDialogueTool } from '@/lib/agent/tools/reorder-script-dialogue';

jest.mock('@/lib/services/authorizationService', () => ({ getUserProjectRole: jest.fn() }));
jest.mock('@/lib/documents/documentStateGateway', () => ({ documentStateGateway: { read: jest.fn() } }));
jest.mock('@/lib/services/libraryAssetsService', () => ({ getLibraryAssetsWithProperties: jest.fn() }));
jest.mock('@/lib/server/scriptDialogueDerivedTableSyncService', () => ({ prepareScriptDialogueLibraryReconciliation: jest.fn() }));
jest.mock('@/lib/server/scriptDialogueOriginSnapshot', () => ({ readScriptDialogueOriginFingerprint: jest.fn() }));
jest.mock('@/lib/agent/script-dialogue-mutation-service', () => ({
  readScriptMutationReceipt: jest.fn(), runAtomicScriptDialogueMutation: jest.fn(),
}));

const userId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const documentId = '33333333-3333-4333-8333-333333333333';
const libraryId = '44444444-4444-4444-8444-444444444444';
const sourceA = '55555555-5555-4555-8555-555555555555';
const sourceB = '66666666-6666-4666-8666-666666666666';
const actionA = '77777777-7777-4777-8777-777777777777';
const speechA = '88888888-8888-4888-8888-888888888888';
const actionB = '99999999-9999-4999-8999-999999999999';
const speechB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const fingerprint = 'f'.repeat(32);
const fields = { typeFieldId: 'type', nameFieldId: 'name', contentFieldId: 'content' };
const rows = [
  { id: actionA, name: 'Ada', rowIndex: 1, propertyValues: { type: '3', name: 'Ada', content: 'smiles' } },
  { id: speechA, name: 'Ada', rowIndex: 2, propertyValues: { type: '2', name: 'Ada', content: 'Hello' } },
  { id: actionB, name: 'Ben', rowIndex: 3, propertyValues: { type: '3', name: 'Ben', content: 'waves' } },
  { id: speechB, name: 'Ben', rowIndex: 4, propertyValues: { type: '2', name: 'Ben', content: 'Wait' } },
];
const order = rows.map((row) => row.id);
const plotPlan = { version: 2, entryPlotNodeId: 'Plot1', storyNodeOrder: ['N1', 'N2', 'N3', 'N4'],
  nodes: [{ id: 'Plot1', title: 'Plot 1', storyNodeIds: ['N1', 'N2', 'N3', 'N4'] }], edges: [] };
const markdown = `<BlockAnchor id="${sourceA}" />Ada（smiles）：Hello\n\n<BlockAnchor id="${sourceB}" />Ben（waves）：Wait`;
const library = { id: libraryId, project_id: projectId, name: 'Scene',
  source_document_id: documentId, document_export_type: 'script', plot_plan: plotPlan };
const query = { select: jest.fn(), eq: jest.fn(), maybeSingle: jest.fn() };
const client = { from: jest.fn() } as unknown as SupabaseClient;
const ctx: ToolContext = { userId, projectId, conversationId: 'conversation', workspace: 'script', supabase: client };

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(library, { plot_plan: plotPlan });
  jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'editor', isOwner: false });
  jest.mocked(documentStateGateway.read).mockResolvedValue({
    documentId, projectId, markdown, token: { epoch: 1, revision: 5 }, updateTail: [],
  } as never);
  jest.mocked(getLibraryAssetsWithProperties).mockResolvedValue(rows as never);
  jest.mocked(readScriptDialogueOriginFingerprint).mockResolvedValue(fingerprint);
  jest.mocked(readScriptMutationReceipt).mockResolvedValue(null);
  jest.mocked(runAtomicScriptDialogueMutation).mockResolvedValue({ epoch: 2, revision: 6 });
  jest.mocked(prepareScriptDialogueLibraryReconciliation).mockImplementation(async ({ command }) => ({
    operation: command.type === 'insert'
      ? { libraryId, ...fields, type: 'insert', afterRowId: speechA, insertAtStart: false,
        speaker: 'Ada', action: 'nods', dialogue: 'New line', speechType: '2' }
      : command.type === 'edit'
        ? { libraryId, ...fields, type: 'edit', actionRowId: actionA, speechRowId: speechA,
          speaker: command.speaker ?? 'Ada', action: command.nextText,
          dialogue: command.dialogue ?? 'Hello', speechType: '2' }
        : command.type === 'reorder'
          ? { libraryId, ...fields, type: 'reorder', expectedOrderIds: order,
            nextOrderIds: [actionB, speechB, actionA, speechA] }
      : { libraryId, ...fields, type: 'delete', actionRowId: actionA, speechRowId: speechA },
    currentOrderIds: order,
    flowRows: rows.map((row) => ({ Type: row.propertyValues.type,
      Name: row.propertyValues.name, Content: row.propertyValues.content })),
  } as never));
  let table = '';
  jest.mocked(client.from).mockImplementation((name) => { table = name; return query as never; });
  query.select.mockImplementation(() => query);
  query.maybeSingle.mockImplementation(async () => ({ data: table === 'libraries' ? library : null, error: null }));
  query.eq.mockImplementation((column: string) => column === 'library_id'
    ? Promise.resolve({ data: [{ id: 'type', label: 'Type' }, { id: 'name', label: 'Name' }, { id: 'content', label: 'Content' }], error: null })
    : query);
});

it.each([
  ['edit', editScriptDialogueTool, { libraryId, blockId: speechA,
    actionText: 'nods', dialogue: 'Updated', idempotencyKey: key }],
  ['speaker', changeScriptDialogueSpeakerTool, { libraryId, blockId: speechA,
    speaker: 'Ben', idempotencyKey: key }],
] as const)('records %s for exact undo of source and Script rows', async (kind, tool, args) => {
  const preview = await tool.prepareConfirmation!(args, ctx);
  if (!preview.success) throw new Error(preview.error);
  expect(preview.preview).toMatchObject({ blockId: speechA,
    currentSpeaker: 'Ada', currentAction: 'smiles', currentDialogue: 'Hello' });
  expect(await tool.execute(preview.args, ctx)).toMatchObject({
    success: true, data: { operationId: key, revision: 6 },
  });
  const mutation = jest.mocked(runAtomicScriptDialogueMutation).mock.calls[0][0];
  expect(mutation.operation).toMatchObject({ type: 'edit', expectedOrderIds: order, nextOrderIds: order });
  expect(mutation.undoPayload).toMatchObject({ speaker: 'Ada', action: 'smiles', dialogue: 'Hello' });
  expect(mutation.command.type).toBe('edit');
  expect(mutation.markdown).not.toBe(markdown);

  const receipt = { idempotency_key: key, actor_user_id: userId,
    project_id: projectId, document_id: documentId, library_id: libraryId,
    operation: mutation.operation, undo_payload: mutation.undoPayload,
    before_markdown: markdown, after_markdown: mutation.markdown,
    before_plot_plan: plotPlan, after_plot_plan: plotPlan,
    result_fingerprint: fingerprint, result_epoch: 2, result_revision: 6,
    undone_by: null, undo_of: null };
  jest.mocked(readScriptMutationReceipt).mockImplementation(async (requestedKey) =>
    requestedKey === key ? receipt as never : null);
  jest.mocked(documentStateGateway.read).mockResolvedValue({ documentId, projectId,
    markdown: mutation.markdown, token: { epoch: 2, revision: 6 }, updateTail: [],
  } as never);
  const speaker = kind === 'speaker' ? 'Ben' : 'Ada';
  const action = kind === 'edit' ? 'nods' : 'smiles';
  const dialogue = kind === 'edit' ? 'Updated' : 'Hello';
  jest.mocked(getLibraryAssetsWithProperties).mockResolvedValue(rows.map((row) =>
    [actionA, speechA].includes(row.id)
      ? { ...row, name: speaker, propertyValues: { ...row.propertyValues,
        name: speaker, content: row.id === actionA ? action : dialogue } }
      : row) as never);
  const undoArgs = { libraryId, operationId: key,
    idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
  const undoPreview = await undoScriptDialogueActionTool.prepareConfirmation!(undoArgs, ctx);
  if (!undoPreview.success) throw new Error(undoPreview.error);
  expect(await undoScriptDialogueActionTool.execute(undoPreview.args, ctx)).toMatchObject({
    success: true, data: { operationId: undoArgs.idempotencyKey },
  });
  const reversal = jest.mocked(runAtomicScriptDialogueMutation).mock.calls[1][0];
  expect(reversal).toMatchObject({ undoOf: key, markdown,
    operation: { type: 'edit', speaker: 'Ada', action: 'smiles', dialogue: 'Hello' } });
});

it('records a reorder and restores its exact source, row, and plot order', async () => {
  const args = { libraryId, movingBlockId: speechA, targetBlockId: speechB, idempotencyKey: key };
  const preview = await reorderScriptDialogueTool.prepareConfirmation!(args, ctx);
  if (!preview.success) throw new Error(preview.error);
  expect(preview.preview).toMatchObject({ placement: 'after target', movingBlockId: speechA,
    targetBlockId: speechB });
  expect(await reorderScriptDialogueTool.execute(preview.args, ctx)).toMatchObject({
    success: true, data: { operationId: key, revision: 6 },
  });
  const mutation = jest.mocked(runAtomicScriptDialogueMutation).mock.calls[0][0];
  expect(mutation.operation).toMatchObject({ type: 'reorder', expectedOrderIds: order,
    nextOrderIds: [actionB, speechB, actionA, speechA] });
  expect(mutation.undoPayload).toMatchObject({ movingBlockId: speechA,
    previousBlockIds: [speechA, speechB] });
  Object.assign(library, { plot_plan: mutation.plotPlan });
  const receipt = { idempotency_key: key, actor_user_id: userId,
    project_id: projectId, document_id: documentId, library_id: libraryId,
    operation: mutation.operation, undo_payload: mutation.undoPayload,
    before_markdown: markdown, after_markdown: mutation.markdown,
    before_plot_plan: plotPlan, after_plot_plan: mutation.plotPlan,
    result_fingerprint: fingerprint, result_epoch: 2, result_revision: 6,
    undone_by: null, undo_of: null };
  jest.mocked(readScriptMutationReceipt).mockImplementation(async (requestedKey) =>
    requestedKey === key ? receipt as never : null);
  jest.mocked(documentStateGateway.read).mockResolvedValue({ documentId, projectId,
    markdown: mutation.markdown, token: { epoch: 2, revision: 6 }, updateTail: [],
  } as never);
  jest.mocked(getLibraryAssetsWithProperties).mockResolvedValue([
    { ...rows[2], rowIndex: 1 }, { ...rows[3], rowIndex: 2 },
    { ...rows[0], rowIndex: 3 }, { ...rows[1], rowIndex: 4 },
  ] as never);
  jest.mocked(prepareScriptDialogueLibraryReconciliation).mockImplementation(async ({ command }) => ({
    operation: { libraryId, ...fields, type: 'reorder',
      expectedOrderIds: [actionB, speechB, actionA, speechA], nextOrderIds: order },
    currentOrderIds: [actionB, speechB, actionA, speechA],
    flowRows: rows.map((row) => ({ Type: row.propertyValues.type,
      Name: row.propertyValues.name, Content: row.propertyValues.content })),
    command,
  } as never));
  const undoArgs = { libraryId, operationId: key,
    idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
  const undoPreview = await undoScriptDialogueActionTool.prepareConfirmation!(undoArgs, ctx);
  if (!undoPreview.success) throw new Error(undoPreview.error);
  expect(await undoScriptDialogueActionTool.execute(undoPreview.args, ctx)).toMatchObject({
    success: true, data: { operationId: undoArgs.idempotencyKey },
  });
  expect(jest.mocked(runAtomicScriptDialogueMutation).mock.calls[1][0]).toMatchObject({
    undoOf: key, markdown, plotPlan,
    operation: { type: 'reorder', expectedOrderIds: [actionB, speechB, actionA, speechA],
      nextOrderIds: order },
  });
});

it.each([
  [editScriptDialogueTool, { libraryId, blockId: speechA,
    actionText: 'nods', dialogue: 'Updated', idempotencyKey: key }],
  [changeScriptDialogueSpeakerTool, { libraryId, blockId: speechA,
    speaker: 'Ben', idempotencyKey: key }],
  [reorderScriptDialogueTool, { libraryId, movingBlockId: speechA,
    targetBlockId: speechB, idempotencyKey: key }],
] as const)('rejects stale approval and viewer access before receipt-backed writes', async (tool, args) => {
  const preview = await tool.prepareConfirmation!(args, ctx);
  if (!preview.success) throw new Error(preview.error);
  jest.mocked(readScriptDialogueOriginFingerprint).mockResolvedValueOnce('e'.repeat(32));
  expect(await tool.execute(preview.args, ctx)).toMatchObject({ success: false,
    error: 'Script changed after approval; preview the action again.' });
  expect(runAtomicScriptDialogueMutation).not.toHaveBeenCalled();
  jest.mocked(getUserProjectRole).mockResolvedValueOnce({ role: 'viewer', isOwner: false });
  expect((await tool.prepareConfirmation!(args, ctx)).success).toBe(false);
});

it('does not create an undo receipt for an unchanged edit or speaker', async () => {
  expect((await editScriptDialogueTool.prepareConfirmation!({ libraryId, blockId: speechA,
    actionText: 'smiles', dialogue: 'Hello', idempotencyKey: key }, ctx)).error)
    .toBe('No Script dialogue changes to apply.');
  expect((await changeScriptDialogueSpeakerTool.prepareConfirmation!({ libraryId, blockId: speechA,
    speaker: 'Ada', idempotencyKey: key }, ctx)).error)
    .toBe('No Script dialogue changes to apply.');
});

it.each(['action', 'speech'] as const)(
  'atomically adds a missing %s row and plans its exact undo', async (missing) => {
    const beforeRows = missing === 'action'
      ? [rows[1], rows[2], rows[3]].map((row, index) => ({ ...row, rowIndex: index + 1 }))
      : [rows[0], rows[2], rows[3]].map((row, index) => ({ ...row, rowIndex: index + 1 }));
    const beforeOrder = beforeRows.map((row) => row.id);
    const beforePlan = { ...plotPlan, storyNodeOrder: ['N1', 'N3', 'N4'],
      nodes: [{ ...plotPlan.nodes[0], storyNodeIds: ['N1', 'N3', 'N4'] }] };
    const beforeMarkdown = missing === 'action'
      ? `<BlockAnchor id="${sourceA}" />Ada：Hello\n\n<BlockAnchor id="${sourceB}" />Ben（waves）：Wait`
      : `<BlockAnchor id="${sourceA}" />smiles\n\n<BlockAnchor id="${sourceB}" />Ben（waves）：Wait`;
    Object.assign(library, { plot_plan: beforePlan });
    jest.mocked(documentStateGateway.read).mockResolvedValue({ documentId, projectId,
      markdown: beforeMarkdown, token: { epoch: 1, revision: 5 }, updateTail: [],
    } as never);
    jest.mocked(getLibraryAssetsWithProperties).mockResolvedValue(beforeRows as never);
    jest.mocked(prepareScriptDialogueLibraryReconciliation).mockImplementation(async () => ({
      operation: { libraryId, ...fields, type: 'edit',
        actionRowId: missing === 'action' ? null : actionA,
        speechRowId: missing === 'speech' ? null : speechA,
        speaker: 'Ada', action: missing === 'action' ? 'nods' : 'smiles',
        dialogue: 'Updated', speechType: '2' },
      currentOrderIds: beforeOrder,
      flowRows: beforeRows.map((row) => ({ Type: row.propertyValues.type,
        Name: row.propertyValues.name, Content: row.propertyValues.content })),
    } as never));
    const blockId = missing === 'action' ? speechA : actionA;
    const args = { libraryId, blockId,
      actionText: missing === 'action' ? 'nods' : 'smiles',
      dialogue: 'Updated', idempotencyKey: key };
    const preview = await editScriptDialogueTool.prepareConfirmation!(args, ctx);
    if (!preview.success) throw new Error(preview.error);
    expect(await editScriptDialogueTool.execute(preview.args, ctx)).toMatchObject({
      success: true, data: { operationId: key, revision: 6 },
    });
    const created = jest.mocked(runAtomicScriptDialogueMutation).mock.calls[0][0];
    const createdKey = missing === 'action' ? 'createActionRowId' : 'createSpeechRowId';
    const deletedKey = missing === 'action' ? 'deleteActionRowId' : 'deleteSpeechRowId';
    const addedId = String(created.operation[createdKey]);
    expect(addedId).toMatch(/^[a-f0-9-]{36}$/);
    expect(created.operation.expectedOrderIds).toEqual(beforeOrder);
    expect(created.operation.nextOrderIds).toEqual(missing === 'action'
      ? [addedId, speechA, actionB, speechB]
      : [actionA, addedId, actionB, speechB]);
    expect(created.plotPlan.storyNodeOrder).toHaveLength(4);
    expect(created.undoPayload).toMatchObject({ [missing === 'action'
      ? 'createdActionRowId' : 'createdSpeechRowId']: addedId });

    const receipt = { idempotency_key: key, actor_user_id: userId,
      project_id: projectId, document_id: documentId, library_id: libraryId,
      operation: created.operation, undo_payload: created.undoPayload,
      before_markdown: beforeMarkdown, after_markdown: created.markdown,
      before_plot_plan: beforePlan, after_plot_plan: created.plotPlan,
      result_fingerprint: fingerprint, result_epoch: 2, result_revision: 6,
      undone_by: null, undo_of: null };
    jest.mocked(readScriptMutationReceipt).mockImplementation(async (requestedKey) =>
      requestedKey === key ? receipt as never : null);
    jest.mocked(documentStateGateway.read).mockResolvedValue({ documentId, projectId,
      markdown: created.markdown, token: { epoch: 2, revision: 6 }, updateTail: [],
    } as never);
    Object.assign(library, { plot_plan: created.plotPlan });
    const addedRow = { id: addedId, name: 'Ada', rowIndex: missing === 'action' ? 1 : 2,
      propertyValues: { type: missing === 'action' ? '3' : '2', name: 'Ada',
        content: missing === 'action' ? 'nods' : 'Updated' } };
    const afterRows = missing === 'action'
      ? [addedRow, { ...beforeRows[0], rowIndex: 2 },
        { ...beforeRows[1], rowIndex: 3 }, { ...beforeRows[2], rowIndex: 4 }]
      : [{ ...beforeRows[0], rowIndex: 1 }, addedRow,
        { ...beforeRows[1], rowIndex: 3 }, { ...beforeRows[2], rowIndex: 4 }];
    jest.mocked(getLibraryAssetsWithProperties).mockResolvedValue(afterRows as never);
    const undoArgs = { libraryId, operationId: key,
      idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    const undoPreview = await undoScriptDialogueActionTool.prepareConfirmation!(undoArgs, ctx);
    if (!undoPreview.success) throw new Error(undoPreview.error);
    expect(await undoScriptDialogueActionTool.execute(undoPreview.args, ctx)).toMatchObject({
      success: true, data: { operationId: undoArgs.idempotencyKey },
    });
    expect(jest.mocked(runAtomicScriptDialogueMutation).mock.calls[1][0]).toMatchObject({
      undoOf: key, markdown: beforeMarkdown, plotPlan: beforePlan,
      operation: { type: 'edit', [deletedKey]: addedId,
        expectedOrderIds: created.operation.nextOrderIds, nextOrderIds: beforeOrder },
    });
  },
);

it('inserts with stable row IDs and writes source, Script, and plot plan through one service call', async () => {
  const args = { libraryId, afterBlockId: speechA, speaker: 'Ada', actionText: 'nods',
    dialogue: 'New line', idempotencyKey: key };
  const preview = await insertScriptDialogueTool.prepareConfirmation!(args, ctx);
  if (!preview.success) throw new Error(preview.error);
  expect(preview.preview).toMatchObject({ action: 'insert', afterBlockId: speechA });
  expect(await insertScriptDialogueTool.execute(preview.args, ctx)).toMatchObject({
    success: true, data: { revision: 6, operationId: key },
  });
  const mutation = jest.mocked(runAtomicScriptDialogueMutation).mock.calls[0][0];
  expect(mutation.markdown).toContain('Ada（nods）：New line');
  expect(mutation.operation).toMatchObject({ type: 'insert', expectedOrderIds: order });
  expect(mutation.operation.nextOrderIds).toHaveLength(6);
  expect(mutation.plotPlan.version).toBe(2);
  expect((mutation.plotPlan as typeof plotPlan).storyNodeOrder).toHaveLength(6);
  expect(mutation.undoPayload).toMatchObject({ speaker: 'Ada', action: 'nods', dialogue: 'New line' });
});

it('requires confirmation and refuses a stale or final-block deletion', async () => {
  const args = { libraryId, blockId: speechA, idempotencyKey: key };
  const preview = await deleteScriptDialogueBlockTool.prepareConfirmation!(args, ctx);
  if (!preview.success) throw new Error(preview.error);
  expect(preview.preview).toMatchObject({ action: 'delete', blockId: speechA });
  jest.mocked(readScriptDialogueOriginFingerprint).mockResolvedValueOnce('e'.repeat(32));
  expect((await deleteScriptDialogueBlockTool.execute(preview.args, ctx)).error).toMatch(/changed after approval/);
  expect(runAtomicScriptDialogueMutation).not.toHaveBeenCalled();

  jest.mocked(getLibraryAssetsWithProperties).mockResolvedValueOnce(rows.slice(0, 2) as never);
  expect((await deleteScriptDialogueBlockTool.prepareConfirmation!(args, ctx)).error).toMatch(/final Script block/);
});

it('replays a completed request without another write and rejects a reused key', async () => {
  const args = { libraryId, blockId: speechA, idempotencyKey: key };
  const preview = await deleteScriptDialogueBlockTool.prepareConfirmation!(args, ctx);
  if (!preview.success) throw new Error(preview.error);
  const requestHash = require('node:crypto').createHash('sha256')
    .update(JSON.stringify({ blockId: speechA, kind: 'delete', libraryId })).digest('hex');
  jest.mocked(readScriptMutationReceipt).mockResolvedValue({ actor_user_id: userId,
    project_id: projectId, library_id: libraryId, document_id: documentId,
    request_hash: requestHash, result_revision: 6 } as never);
  expect(await deleteScriptDialogueBlockTool.execute(preview.args, ctx)).toMatchObject({
    success: true, data: { replayed: true },
    invalidations: [
      { type: 'documents', projectId, documentId },
      { type: 'library', id: libraryId, projectId, sourceDocumentId: documentId },
      { type: 'script-workspace', projectId },
    ],
  });
  expect(runAtomicScriptDialogueMutation).not.toHaveBeenCalled();
  expect((await insertScriptDialogueTool.execute({ libraryId, speaker: 'Ada', actionText: '',
    dialogue: 'Different', idempotencyKey: key }, ctx)).error).toMatch(/IDEMPOTENCY_CONFLICT/);
});

it('accepts undo only for the actor-owned, unchanged latest action', async () => {
  const receipt = { idempotency_key: key, actor_user_id: userId,
    project_id: projectId, document_id: documentId, library_id: libraryId,
    operation: { type: 'insert', ...fields, actionRowId: actionA, speechRowId: speechA,
      expectedOrderIds: [actionB, speechB], nextOrderIds: order },
    undo_payload: { sourceBlockId: sourceA, sourceText: 'Ada（smiles）：Hello',
      speaker: 'Ada', action: 'smiles', dialogue: 'Hello' },
    before_markdown: `<BlockAnchor id="${sourceB}" />Ben（waves）：Wait`,
    after_markdown: markdown, before_plot_plan: plotPlan, after_plot_plan: plotPlan,
    result_fingerprint: fingerprint, result_epoch: 1, result_revision: 5,
    undone_by: null, undo_of: null };
  jest.mocked(readScriptMutationReceipt).mockResolvedValue(receipt as never);
  const args = { libraryId, operationId: key,
    idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
  const preview = await undoScriptDialogueActionTool.prepareConfirmation!(args, ctx);
  if (!preview.success) throw new Error(preview.error);
  jest.mocked(readScriptMutationReceipt).mockImplementation(async (requestedKey) =>
    requestedKey === key ? receipt as never : null);
  expect(await undoScriptDialogueActionTool.execute(preview.args, ctx)).toMatchObject({
    success: true, data: { operationId: args.idempotencyKey },
  });
  expect(runAtomicScriptDialogueMutation).toHaveBeenCalledWith(expect.objectContaining({
    undoOf: key, markdown: receipt.before_markdown,
    operation: expect.objectContaining({ type: 'delete', actionRowId: actionA,
      speechRowId: speechA, expectedOrderIds: order, nextOrderIds: [actionB, speechB] }),
  }));
  jest.mocked(readScriptMutationReceipt).mockResolvedValue({ ...receipt, undone_by: args.idempotencyKey } as never);
  expect((await undoScriptDialogueActionTool.prepareConfirmation!(args, ctx)).error).toMatch(/no longer current/);
});

it('rejects viewers before any source or Script write', async () => {
  jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'viewer', isOwner: false });
  const preview = await insertScriptDialogueTool.prepareConfirmation!({ libraryId,
    speaker: 'Ada', actionText: '', dialogue: 'New line', idempotencyKey: key }, ctx);
  expect(preview.success).toBe(false);
  expect(runAtomicScriptDialogueMutation).not.toHaveBeenCalled();
});

it('does not expose unexpected database error text', async () => {
  const args = { libraryId, afterBlockId: speechA, speaker: 'Ada', actionText: '',
    dialogue: 'New line', idempotencyKey: key };
  const preview = await insertScriptDialogueTool.prepareConfirmation!(args, ctx);
  if (!preview.success) throw new Error(preview.error);
  jest.mocked(runAtomicScriptDialogueMutation).mockRejectedValueOnce(new Error('internal SQL details'));
  expect(await insertScriptDialogueTool.execute(preview.args, ctx)).toMatchObject({
    success: false, error: 'Script dialogue action failed.',
  });
});
