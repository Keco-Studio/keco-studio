import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('@/lib/agent/embedding-index', () => ({ scheduleLibrarySchemaReindex: jest.fn() }));

import { reorderLibraryFieldsTool } from '@/lib/agent/tools/reorder-library-fields';
import { scheduleLibrarySchemaReindex } from '@/lib/agent/embedding-index';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), libraryId = id(2), first = id(3), second = id(4);
const fingerprint = 'a'.repeat(64);
const updatedAt = '2026-09-28T00:00:00Z';
let ctx: ToolContext;
let rpc: jest.Mock;
let fields: Array<{ fieldId: string; section: string; sectionId: string }>;
let currentFingerprint: string;

beforeEach(() => {
  jest.clearAllMocks();
  fields = [{ fieldId: first, section: 'Main', sectionId: 'main' },
    { fieldId: second, section: 'Details', sectionId: 'details' }];
  currentFingerprint = fingerprint;
  rpc = jest.fn(async (name: string) => name === 'agent_prepare_library_reorder'
    ? { data: { name: 'Items', updatedAt, fingerprint: currentFingerprint, fields }, error: null }
    : { data: { updatedAt: 'later', reorderedCount: 2 }, error: null });
  ctx = { userId: id(9), projectId, workspace: 'studio', conversationId: id(8),
    supabase: { rpc } as unknown as SupabaseClient };
});

it('seals the preview and passes timestamp and schema fingerprint to the atomic reorder RPC', async () => {
  expect(reorderLibraryFieldsTool.confirmationPolicy).toBe('always');
  const prepared = await reorderLibraryFieldsTool.prepareConfirmation!({ libraryId, fieldIds: [second, first] }, ctx);
  expect(prepared).toMatchObject({ success: true, args: { expectedUpdatedAt: updatedAt, expectedFingerprint: fingerprint } });
  if (!prepared.success) throw new Error('Expected reorder preview');
  const result = await reorderLibraryFieldsTool.execute(prepared.args, ctx);
  expect(result).toMatchObject({ success: true, schemaChanged: true,
    data: { libraryId, fieldIds: [second, first], reorderedCount: 2 },
    invalidations: [{ type: 'library', id: libraryId, projectId }] });
  expect(rpc).toHaveBeenCalledWith('agent_reorder_library_fields_if_current', {
    p_project_id: projectId, p_library_id: libraryId,
    p_fields: [{ fieldId: second, section: 'Details', sectionId: 'details' },
      { fieldId: first, section: 'Main', sectionId: 'main' }],
    p_expected_updated_at: updatedAt, p_expected_fingerprint: fingerprint,
  });
  expect(scheduleLibrarySchemaReindex).toHaveBeenCalledWith(ctx.supabase, { projectId, libraryId });
});

it('rejects missing or duplicate IDs before approval', async () => {
  expect(await reorderLibraryFieldsTool.prepareConfirmation!({ libraryId, fieldIds: [first] }, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('every current field') });
  expect(await reorderLibraryFieldsTool.prepareConfirmation!({ libraryId, fieldIds: [first, first] }, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('every current field') });
  expect(rpc).not.toHaveBeenCalledWith('agent_reorder_library_fields_if_current', expect.anything());
});

it('rejects a schema change after approval and never starts a write', async () => {
  const prepared = await reorderLibraryFieldsTool.prepareConfirmation!({ libraryId, fieldIds: [second, first] }, ctx);
  if (!prepared.success) throw new Error('Expected reorder preview');
  currentFingerprint = 'b'.repeat(64);
  expect(await reorderLibraryFieldsTool.execute(prepared.args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('changed after approval') });
  expect(rpc).not.toHaveBeenCalledWith('agent_reorder_library_fields_if_current', expect.anything());
});

it('does not report success when the database rejects a concurrent schema change', async () => {
  const prepared = await reorderLibraryFieldsTool.prepareConfirmation!({ libraryId, fieldIds: [first, second] }, ctx);
  if (!prepared.success) throw new Error('Expected reorder preview');
  rpc.mockResolvedValueOnce({ data: { name: 'Items', updatedAt, fingerprint, fields }, error: null });
  rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409' } });
  expect(await reorderLibraryFieldsTool.execute(prepared.args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('changed after approval') });
  expect(scheduleLibrarySchemaReindex).not.toHaveBeenCalled();
});
