import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

const createFolderServer = jest.fn();
const createLibraryServer = jest.fn();
const listProjectFolders = jest.fn();
const listProjectLibraries = jest.fn();
const findFolderByName = jest.fn();

jest.mock('@/lib/agent/data-access', () => ({
  createFolderServer: (...args: unknown[]) => createFolderServer(...args),
  createLibraryServer: (...args: unknown[]) => createLibraryServer(...args),
  listProjectFolders: (...args: unknown[]) => listProjectFolders(...args),
  listProjectLibraries: (...args: unknown[]) => listProjectLibraries(...args),
  findFolderByName: (...args: unknown[]) => findFolderByName(...args),
}));

import { createFolder } from '@/lib/agent/tools/create-folder';
import { createLibrary } from '@/lib/agent/tools/create-library';

const projectId = '11111111-1111-4111-8111-111111111111';
const key = '22222222-2222-4222-8222-222222222222';
const folderId = '33333333-3333-4333-8333-333333333333';
const libraryId = '44444444-4444-4444-8444-444444444444';
const rpc = jest.fn();
const ctx: ToolContext = { userId: '55555555-5555-4555-8555-555555555555',
  projectId, conversationId: '66666666-6666-4666-8666-666666666666',
  workspace: 'studio', supabase: { rpc } as unknown as SupabaseClient };

beforeEach(() => {
  jest.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
  listProjectFolders.mockResolvedValue([]);
  listProjectLibraries.mockResolvedValue([]);
  createFolderServer.mockResolvedValue(folderId);
  createLibraryServer.mockResolvedValue(libraryId);
});

it('reserves a folder key and replays before duplicate-name checks', async () => {
  const params = { name: 'Design', description: 'World rules', idempotencyKey: key };
  expect(await createFolder.execute(params, ctx)).toMatchObject({ success: true,
    data: { folderId } });
  expect(createFolderServer).toHaveBeenCalledWith(ctx.supabase, projectId, 'Design', 'World rules',
    { key, hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  rpc.mockResolvedValue({ data: folderId, error: null });
  listProjectFolders.mockResolvedValue([{ id: folderId, name: 'Design' }]);
  expect(await createFolder.execute(params, ctx)).toMatchObject({ success: true,
    data: { folderId } });
  expect(createFolderServer).toHaveBeenCalledTimes(1);
  expect(listProjectFolders).toHaveBeenCalledTimes(1);
});

it('reserves a library key and replays before duplicate-name checks', async () => {
  const params = { name: 'Characters', idempotencyKey: key };
  expect(await createLibrary.execute(params, ctx)).toMatchObject({ success: true,
    data: { libraryId } });
  expect(createLibraryServer).toHaveBeenCalledWith(ctx.supabase, projectId, 'Characters',
    undefined, undefined, undefined, { key, hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  rpc.mockResolvedValue({ data: libraryId, error: null });
  listProjectLibraries.mockResolvedValue([{ id: libraryId, name: 'Characters' }]);
  expect(await createLibrary.execute(params, ctx)).toMatchObject({ success: true,
    data: { libraryId } });
  expect(createLibraryServer).toHaveBeenCalledTimes(1);
  expect(listProjectLibraries).toHaveBeenCalledTimes(1);
});

it('returns a clear conflict for a request key reused with different inputs', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'IDEMPOTENCY_CONFLICT' } });
  expect(await createFolder.execute({ name: 'Other', idempotencyKey: key }, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('already used') });
  expect(await createLibrary.execute({ name: 'Other', idempotencyKey: key }, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('already used') });
  expect(createFolderServer).not.toHaveBeenCalled();
  expect(createLibraryServer).not.toHaveBeenCalled();
});
