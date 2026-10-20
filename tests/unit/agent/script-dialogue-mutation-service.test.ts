import type { SupabaseClient } from '@supabase/supabase-js';
import { runAtomicScriptDialogueMutation } from '@/lib/agent/script-dialogue-mutation-service';
import { prepareScriptDialogueDerivedTableOperations } from '@/lib/server/scriptDialogueDerivedTableSyncService';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentStateGateway', () => ({ documentStateGateway: { read: jest.fn() } }));
jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: { validate: jest.fn(), markdownToYjsState: jest.fn().mockResolvedValue('replacement') },
  mergeYjsState: jest.fn().mockReturnValue('current'),
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient: jest.fn(),
}));
jest.mock('@/lib/server/scriptDialogueDerivedTableSyncService', () => ({
  prepareScriptDialogueDerivedTableOperations: jest.fn(),
}));

const projectId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';
const libraryId = '33333333-3333-4333-8333-333333333333';
const actorUserId = '44444444-4444-4444-8444-444444444444';
const plotPlan = { version: 2, entryPlotNodeId: 'Plot1', storyNodeOrder: [],
  nodes: [{ id: 'Plot1', title: 'Plot 1', storyNodeIds: [] }], edges: [] };
const common = { supabase: {} as SupabaseClient, actorUserId, projectId, documentId, libraryId,
  expected: { epoch: 1, revision: 2 }, expectedMarkdown: 'before', expectedUpdateIds: [],
  expectedFingerprint: 'a'.repeat(32), expectedPlotPlan: plotPlan, markdown: 'after',
  operation: { type: 'edit' }, plotPlan,
  idempotencyKey: '55555555-5555-4555-8555-555555555555', requestHash: 'b'.repeat(64),
  undoPayload: { speaker: 'Ada' } };
const rpc = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(documentStateGateway.read).mockResolvedValue({ projectId, documentId, markdown: 'before',
    token: { epoch: 1, revision: 2 }, updateTail: [], yjsStateBase64: 'current' });
  rpc.mockResolvedValue({ data: [{ collab_epoch: 2, collab_revision: 3 }], error: null });
  jest.mocked(getSupabaseServiceRoleClient).mockReturnValue({ rpc } as unknown as SupabaseClient);
  jest.mocked(prepareScriptDialogueDerivedTableOperations).mockResolvedValue([
    { libraryId, type: 'edit' }, { libraryId: 'sibling-script', type: 'edit' },
  ] as never);
});

it('syncs sibling derived tables but reconciles the origin Script exactly once', async () => {
  await runAtomicScriptDialogueMutation({ ...common,
    command: { type: 'edit', role: 'action', previousText: '', nextText: 'nods',
      speaker: 'Ada', previousDialogue: 'Hello', dialogue: 'Updated' } });
  expect(prepareScriptDialogueDerivedTableOperations).toHaveBeenCalledWith(expect.objectContaining({
    includeScriptLibraries: true,
  }));
  expect(rpc).toHaveBeenCalledWith('replace_document_and_reconcile_agent_script', expect.objectContaining({
    p_sibling_table_operations: [{ libraryId: 'sibling-script', type: 'edit' }],
  }));
});

it('keeps reorder scoped to the origin Script because sibling RPC does not support reorder', async () => {
  await runAtomicScriptDialogueMutation({ ...common,
    command: { type: 'reorder', movingTexts: ['Ada：Hello'], targetText: 'Ben：Wait', edge: 'after' },
    operation: { type: 'reorder' } });
  expect(prepareScriptDialogueDerivedTableOperations).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith('replace_document_and_reconcile_agent_script', expect.objectContaining({
    p_sibling_table_operations: [],
  }));
});
