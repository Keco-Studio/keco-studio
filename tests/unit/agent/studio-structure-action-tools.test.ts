import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';
import { getFolder, listFolders } from '@/lib/services/folderService';
import {
  getLibrary,
} from '@/lib/services/libraryService';
import {
  getUserProjectRole, verifyFolderCreationPermission, verifyFolderDeletionPermission,
  verifyFolderUpdatePermission, verifyLibraryUpdatePermission,
} from '@/lib/services/authorizationService';
import {
  deleteFolderTool, duplicateFolderTool, duplicateLibraryTool, moveFolderTool,
  moveLibraryTool, updateFolderTool, updateLibraryTool,
} from '@/lib/agent/tools/studio-structure-actions';

jest.mock('@/lib/services/folderService', () => ({
  deleteFolder: jest.fn(), duplicateFolder: jest.fn(), getFolder: jest.fn(), listFolders: jest.fn(),
  moveFolderToParent: jest.fn(), updateFolder: jest.fn(),
}));
jest.mock('@/lib/services/libraryService', () => ({
  duplicateLibrary: jest.fn(), getLibrary: jest.fn(), moveLibraryToFolder: jest.fn(), updateLibrary: jest.fn(),
}));
jest.mock('@/lib/services/authorizationService', () => ({
  getUserProjectRole: jest.fn(), verifyFolderCreationPermission: jest.fn(),
  verifyFolderDeletionPermission: jest.fn(), verifyFolderUpdatePermission: jest.fn(),
  verifyLibraryUpdatePermission: jest.fn(),
}));

const projectId = '11111111-1111-4111-8111-111111111111';
const otherProjectId = '22222222-2222-4222-8222-222222222222';
const folderId = '33333333-3333-4333-8333-333333333333';
const childId = '44444444-4444-4444-8444-444444444444';
const libraryId = '55555555-5555-4555-8555-555555555555';
const newId = '66666666-6666-4666-8666-666666666666';
const updatedAt = '2026-09-28T00:00:00.000Z';
const folder = { id: folderId, project_id: projectId, parent_folder_id: null, name: 'Story', description: null, updated_at: updatedAt };
const child = { ...folder, id: childId, parent_folder_id: folderId, name: 'Child' };
const library = { id: libraryId, project_id: projectId, folder_id: folderId, name: 'Characters', description: null, source_document_id: null, updated_at: updatedAt };

function clientWithSnapshot() {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    folders: [{ id: folderId, parent_folder_id: null, updated_at: updatedAt }, { id: childId, parent_folder_id: folderId, updated_at: updatedAt }],
    documents: [{ id: newId, folder_id: childId, updated_at: updatedAt }],
    libraries: [{ id: libraryId, folder_id: folderId, updated_at: updatedAt }],
  };
  const from = jest.fn((table: string) => ({
    select: jest.fn(() => ({
      eq: jest.fn(async () => ({ data: rows[table], error: null })),
      in: jest.fn(async () => ({ data: rows[table], error: null })),
    })),
  }));
  const rpc = jest.fn().mockResolvedValue({ data: { id: folderId, name: 'Renamed', updatedAt }, error: null });
  return { client: { from, rpc } as unknown as SupabaseClient, rows, rpc };
}

let supabase: SupabaseClient;
let rpc: ReturnType<typeof clientWithSnapshot>['rpc'];
let ctx: ToolContext;

beforeEach(() => {
  jest.resetAllMocks();
  ({ client: supabase, rpc } = clientWithSnapshot());
  ctx = { userId: 'user-1', projectId, conversationId: 'conversation-1', workspace: 'studio', supabase, userRole: 'admin' };
  jest.mocked(getFolder).mockImplementation(async (_client, id) => id === childId ? child as never : folder as never);
  jest.mocked(listFolders).mockResolvedValue([folder, child] as never);
  jest.mocked(getLibrary).mockResolvedValue(library as never);
  jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'admin', isOwner: true });
  jest.mocked(verifyFolderCreationPermission).mockResolvedValue(undefined);
  jest.mocked(verifyFolderDeletionPermission).mockResolvedValue(undefined);
  jest.mocked(verifyFolderUpdatePermission).mockResolvedValue(undefined);
  jest.mocked(verifyLibraryUpdatePermission).mockResolvedValue(undefined);
});

it('updates folder and library metadata after confirmation with structure invalidations', async () => {
  const folderPrepared = await updateFolderTool.prepareConfirmation!({ folderId, name: 'Renamed' }, ctx);
  if (!folderPrepared.success) throw new Error('Expected folder preview');
  expect(await updateFolderTool.execute(folderPrepared.args, ctx)).toMatchObject({ success: true, invalidations: [{ type: 'project-structure', projectId }] });
  expect(rpc).toHaveBeenCalledWith('agent_change_studio_structure_if_current', expect.objectContaining({
    p_project_id: projectId, p_action: 'update_folder', p_target_id: folderId,
    p_expected_updated_at: updatedAt, p_name: 'Renamed',
  }));
  const libraryPrepared = await updateLibraryTool.prepareConfirmation!({ libraryId, name: 'People' }, ctx);
  if (!libraryPrepared.success) throw new Error('Expected library preview');
  expect(await updateLibraryTool.execute(libraryPrepared.args, ctx)).toMatchObject({ success: true, invalidations: expect.arrayContaining([{ type: 'library', id: libraryId, projectId }]) });
  expect(rpc).toHaveBeenCalledWith('agent_change_studio_structure_if_current', expect.objectContaining({
    p_project_id: projectId, p_action: 'update_library_metadata', p_target_id: libraryId,
    p_expected_updated_at: updatedAt, p_name: 'People',
  }));
  jest.mocked(verifyLibraryUpdatePermission).mockRejectedValueOnce(new Error('Only admin users can update libraries'));
  expect((await updateLibraryTool.execute({ libraryId, name: 'Denied', expectedUpdatedAt: updatedAt }, ctx)).success).toBe(false);
  expect(rpc).toHaveBeenCalledTimes(2);
});

it('requires confirmation and accepts description-only metadata changes', async () => {
  expect(updateFolderTool.confirmationPolicy).toBe('always');
  expect(updateLibraryTool.confirmationPolicy).toBe('always');
  expect(moveFolderTool.confirmationPolicy).toBe('always');
  expect(moveLibraryTool.confirmationPolicy).toBe('always');
  expect(await updateFolderTool.prepareConfirmation!({ folderId, description: 'New' }, ctx))
    .toMatchObject({ success: true, args: { folderId, name: 'Story', description: 'New' } });
  expect(await updateLibraryTool.prepareConfirmation!({ libraryId, description: 'New' }, ctx))
    .toMatchObject({ success: true, args: { libraryId, name: 'Characters', description: 'New' } });
  expect((await updateFolderTool.execute({ folderId, name: 'No' }, ctx)).success).toBe(false);
  expect((await updateLibraryTool.execute({ libraryId, name: 'No' }, ctx)).success).toBe(false);
});

it('rejects foreign resources, descendant moves, and foreign library destinations', async () => {
  jest.mocked(getFolder).mockResolvedValueOnce({ ...folder, project_id: otherProjectId } as never);
  expect((await updateFolderTool.execute({ folderId, name: 'No', expectedUpdatedAt: updatedAt }, ctx)).success).toBe(false);
  expect((await moveFolderTool.execute({ folderId, parentFolderId: childId, expectedUpdatedAt: updatedAt }, ctx)).error).toMatch(/descendant/);
  expect(rpc).not.toHaveBeenCalled();
  jest.mocked(getFolder).mockImplementationOnce(async () => ({ ...folder, project_id: otherProjectId }) as never);
  expect((await moveLibraryTool.execute({ libraryId, folderId, expectedUpdatedAt: updatedAt }, ctx)).success).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
});

it('moves a folder and library to root with the approved timestamp', async () => {
  const folderPrepared = await moveFolderTool.prepareConfirmation!({ folderId: childId, parentFolderId: null }, ctx);
  if (!folderPrepared.success) throw new Error('Expected folder move preview');
  expect((await moveFolderTool.execute(folderPrepared.args, ctx)).success).toBe(true);
  const libraryPrepared = await moveLibraryTool.prepareConfirmation!({ libraryId, folderId: null }, ctx);
  if (!libraryPrepared.success) throw new Error('Expected library move preview');
  expect((await moveLibraryTool.execute(libraryPrepared.args, ctx)).success).toBe(true);
  expect(rpc).toHaveBeenNthCalledWith(1, 'agent_change_studio_structure_if_current', expect.objectContaining({
    p_action: 'move_folder', p_target_id: childId, p_destination_id: null, p_expected_updated_at: updatedAt,
  }));
  expect(rpc).toHaveBeenNthCalledWith(2, 'agent_change_studio_structure_if_current', expect.objectContaining({
    p_action: 'move_library', p_target_id: libraryId, p_destination_id: null, p_expected_updated_at: updatedAt,
  }));
});

it('rejects an approval that goes stale inside the database mutation', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'changed' } });
  const prepared = await updateFolderTool.prepareConfirmation!({ folderId, name: 'New' }, ctx);
  if (!prepared.success) throw new Error('Expected folder preview');
  expect(await updateFolderTool.execute(prepared.args, ctx)).toMatchObject({
    success: false, error: expect.stringContaining('changed after approval'),
  });
});

it('does not expose unexpected Studio SQL error text', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX999', message: 'internal relation and path' } });
  expect(await updateFolderTool.execute({ folderId, name: 'New', expectedUpdatedAt: updatedAt }, ctx))
    .toMatchObject({ success: false, error: 'Studio operation failed.' });
  rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX999', message: 'internal deletion detail' } });
  expect(await deleteFolderTool.prepareConfirmation!({ folderId }, ctx))
    .toMatchObject({ success: false, error: 'Studio operation failed.' });
});

it('copies a library through the atomic RPC with the approved fingerprint and request key', async () => {
  const idempotencyKey = '77777777-7777-4777-8777-777777777777';
  const fingerprint = 'a'.repeat(64);
  jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'editor', isOwner: false });
  expect(duplicateLibraryTool.requiredPermission).toBe('editor');
  rpc.mockResolvedValueOnce({ data: { fingerprint }, error: null });
  const prepared = await duplicateLibraryTool.prepareConfirmation!({ libraryId, newName: 'People Copy', copyHeaderOnly: true, idempotencyKey }, ctx);
  expect(prepared).toMatchObject({ success: true, args: { expectedFingerprint: fingerprint, idempotencyKey } });
  if (!prepared.success) throw new Error('Expected library copy preview');
  rpc.mockResolvedValueOnce({ data: newId, error: null });
  expect((await duplicateLibraryTool.execute(prepared.args, ctx)).success).toBe(true);
  expect(rpc).toHaveBeenLastCalledWith('agent_duplicate_library_if_current', {
    p_project_id: projectId, p_source_id: libraryId, p_name: 'People Copy',
    p_copy_header_only: true, p_target_folder_id: folderId,
    p_expected_fingerprint: fingerprint, p_idempotency_key: idempotencyKey,
  });
});

it('copies a folder through the atomic RPC but still requires admin', async () => {
  const idempotencyKey = '88888888-8888-4888-8888-888888888888';
  const fingerprint = 'b'.repeat(64);
  rpc.mockResolvedValueOnce({ data: { projectId, folderId, name: 'Story', updatedAt,
    fingerprint, rowCount: 1, tableCounts: { 'public.folders': 1 } }, error: null });
  const prepared = await duplicateFolderTool.prepareConfirmation!({ folderId, idempotencyKey }, ctx);
  expect(prepared).toMatchObject({ success: true, args: { expectedFingerprint: fingerprint, idempotencyKey } });
  if (!prepared.success) throw new Error('Expected folder copy preview');
  rpc.mockResolvedValueOnce({ data: newId, error: null });
  expect((await duplicateFolderTool.execute(prepared.args, ctx)).success).toBe(true);
  expect(rpc).toHaveBeenLastCalledWith('agent_duplicate_folder_if_current', {
    p_project_id: projectId, p_source_id: folderId,
    p_expected_fingerprint: fingerprint, p_idempotency_key: idempotencyKey,
  });
  jest.mocked(verifyFolderCreationPermission).mockRejectedValueOnce(new Error('Only admin users can create folders'));
  expect((await duplicateFolderTool.execute(prepared.args, ctx)).success).toBe(false);
  expect(rpc).toHaveBeenCalledTimes(2);
});

it('always confirms cascade deletion and rejects a changed descendant after approval', async () => {
  expect(deleteFolderTool.confirmationPolicy).toBe('always');
  const fingerprint = 'b'.repeat(64);
  rpc.mockResolvedValueOnce({ data: { projectId, folderId, name: 'Story', updatedAt,
    fingerprint, rowCount: 7, tableCounts: { 'public.folders': 2, 'public.documents': 1,
      'public.libraries': 1, 'public.library_asset_values': 3 } }, error: null });
  const prepared = await deleteFolderTool.prepareConfirmation!({ folderId }, ctx);
  expect(prepared).toMatchObject({ success: true, args: { expectedFingerprint: fingerprint },
    preview: { folderId, name: 'Story', affectedRows: 7,
      affectedTables: { 'public.library_asset_values': 3 } } });
  if (!prepared.success) throw new Error('Expected delete preview');
  rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'Folder contents changed after approval' } });
  expect((await deleteFolderTool.execute(prepared.args, ctx)).error).toMatch(/contents changed/);
  rpc.mockResolvedValueOnce({ data: folderId, error: null });
  expect((await deleteFolderTool.execute(prepared.args, ctx)).success).toBe(true);
  expect(rpc).toHaveBeenCalledWith('agent_delete_folder_cascade_if_current', {
    p_project_id: projectId, p_folder_id: folderId, p_expected_fingerprint: fingerprint,
  });
});
