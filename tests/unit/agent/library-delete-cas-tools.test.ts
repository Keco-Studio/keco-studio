import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('@/lib/agent/tools/_shared', () => ({
  resolveLibraryForTool: jest.fn(async () => ({ ok: true, library: { id: libraryId, name: 'Items' } })),
  errorFromLookupResult: jest.fn(() => undefined),
  libraryFromLookupResult: jest.fn((result) => result.library),
}));

import { deleteAsset } from '@/lib/agent/tools/delete-asset';
import { deleteLibrary } from '@/lib/agent/tools/delete-library';

const projectId = '10000000-0000-4000-8000-000000000001';
const libraryId = '10000000-0000-4000-8000-000000000002';
const assetId = '10000000-0000-4000-8000-000000000003';
const fingerprint = 'a'.repeat(64);
const updatedAt = '2026-09-28T00:00:00Z';
let rpc: jest.Mock;
let ctx: ToolContext;

beforeEach(() => {
  rpc = jest.fn(async (name: string) => ({ data: name === 'agent_prepare_asset_delete'
    ? { projectId, libraryId, libraryName: 'Items', assetId, name: 'Sword', updatedAt, fingerprint }
    : name === 'agent_prepare_library_delete'
      ? { projectId, libraryId, name: 'Items', updatedAt, fingerprint }
      : name === 'agent_delete_asset_if_current' ? assetId : libraryId, error: null }));
  ctx = { userId: assetId, projectId, conversationId: assetId, workspace: 'studio',
    supabase: { rpc } as unknown as SupabaseClient };
});

it('seals the exact asset target in its approval and executes one conditional delete', async () => {
  const prepared = await deleteAsset.prepareConfirmation!({ libraryName: 'Items', assetId }, ctx);
  expect(prepared).toMatchObject({ success: true, preview: {
    libraryId, libraryName: 'Items', assetId, name: 'Sword', updatedAt, fingerprint,
  } });
  expect(await deleteAsset.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: true, data: { assetId, name: 'Sword' } });
  expect(rpc).toHaveBeenCalledWith('agent_delete_asset_if_current', {
    p_project_id: projectId, p_library_id: libraryId, p_asset_id: assetId,
    p_expected_library_name: 'Items', p_expected_name: 'Sword',
    p_expected_updated_at: updatedAt, p_expected_fingerprint: fingerprint,
  });
  expect(await deleteAsset.execute({ libraryName: 'Items', assetId }, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('confirmation data') });
});

it('seals library identity and reports a stale database rejection', async () => {
  const prepared = await deleteLibrary.prepareConfirmation!({ libraryName: 'Items' }, ctx);
  expect(prepared).toMatchObject({ success: true, preview: {
    libraryId, libraryName: 'Items', updatedAt, fingerprint,
  } });
  rpc.mockImplementationOnce(async () => ({ data: null, error: { message: 'Library changed after approval' } }));
  expect(await deleteLibrary.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: false, error: 'Library changed after approval' });
  expect(rpc).toHaveBeenCalledWith('agent_delete_library_if_current', {
    p_project_id: projectId, p_library_id: libraryId, p_expected_name: 'Items',
    p_expected_updated_at: updatedAt, p_expected_fingerprint: fingerprint,
  });
});

it('rejects sealed targets outside the conversation project', async () => {
  const prepared = await deleteLibrary.prepareConfirmation!({ libraryName: 'Items' }, ctx);
  ctx.projectId = '10000000-0000-4000-8000-000000000099';
  expect(await deleteLibrary.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('outside this conversation') });
  expect(rpc).not.toHaveBeenCalledWith('agent_delete_library_if_current', expect.anything());
});
