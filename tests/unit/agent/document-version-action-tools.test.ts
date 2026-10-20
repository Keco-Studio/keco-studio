import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('@/lib/services/authorizationService', () => ({ getUserProjectRole: jest.fn() }));
jest.mock('@/lib/documents/documentVersionService', () => ({
  listDocumentVersions: jest.fn(), createDocumentVersion: jest.fn(), getDocumentVersionPreview: jest.fn(),
}));
jest.mock('@/lib/documents/documentStateGateway', () => ({ documentStateGateway: {
  readTransport: jest.fn(), replace: jest.fn(),
} }));
jest.mock('@/lib/documents/documentStateResetBroadcaster', () => ({ broadcastDocumentStateReset: jest.fn() }));
jest.mock('@/lib/server/documentEmbeddingIndexService', () => ({ reindexProjectDocumentAsActor: jest.fn() }));

import { getUserProjectRole } from '@/lib/services/authorizationService';
import { createDocumentVersion, getDocumentVersionPreview, listDocumentVersions } from '@/lib/documents/documentVersionService';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { broadcastDocumentStateReset } from '@/lib/documents/documentStateResetBroadcaster';
import { needsConfirmation } from '@/lib/agent/conversation-meta';
import {
  createDocumentVersionTool, listDocumentVersionsTool, restoreDocumentVersionTool,
} from '@/lib/agent/tools/document-version-actions';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const documentId = id(4);
const versionId = id(5);
const row = { id: documentId, project_id: id(1), name: 'Script Draft' };
const ctx: ToolContext = { userId: id(2), projectId: id(1), conversationId: id(3),
  workspace: 'studio', supabase: {} as SupabaseClient };
const state = { documentId, projectId: id(1), mode: 'collaborative' as const,
  yjsStateBase64: 'state', updateTail: [{ id: id(9), updateBase64: 'tail' }],
  token: { epoch: 2, revision: 7 }, epochReason: 'agent' as const, updatedAt: '2026-09-28T00:00:00.000Z' };
const version = { id: versionId, documentId, projectId: id(1), name: 'Earlier',
  type: 'manual' as const, sourceVersionId: null, snapshotToken: { epoch: 1, revision: 4 },
  createdBy: id(2), createdByName: 'Editor', createdAt: '2026-09-27T00:00:00.000Z', markdown: 'Old text' };

function setup() {
  const single = jest.fn().mockResolvedValue({ data: row, error: null });
  const builder = { select: jest.fn(), eq: jest.fn(), single };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  const scoped = { ...ctx, supabase: { from: jest.fn().mockReturnValue(builder) } as unknown as SupabaseClient };
  jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'editor', isOwner: false });
  jest.mocked(documentStateGateway.readTransport).mockResolvedValue(state);
  jest.mocked(getDocumentVersionPreview).mockResolvedValue(version);
  jest.mocked(listDocumentVersions).mockResolvedValue([version]);
  jest.mocked(createDocumentVersion).mockResolvedValue(version);
  jest.mocked(documentStateGateway.replace).mockResolvedValue({ ...state,
    token: { epoch: 3, revision: 0 }, epochReason: 'restore', markdown: 'Old text' });
  jest.mocked(broadcastDocumentStateReset).mockResolvedValue(undefined);
  return { scoped, single };
}

beforeEach(() => jest.resetAllMocks());

it('lists at most 50 versions only after checking the document project', async () => {
  const { scoped, single } = setup();
  const result = await listDocumentVersionsTool.execute({ documentId }, scoped);
  expect(result).toMatchObject({ success: true, data: { versions: [{ id: versionId }] } });
  expect(single).toHaveBeenCalledTimes(1);
  expect(listDocumentVersions).toHaveBeenCalledWith(scoped.supabase, documentId, { offset: 0, limit: 21 });
  single.mockResolvedValueOnce({ data: { ...row, project_id: id(99) }, error: null });
  expect((await listDocumentVersionsTool.execute({ documentId }, scoped)).success).toBe(false);
});

it('creates a version only for an editor in the selected document', async () => {
  const { scoped } = setup();
  expect(await createDocumentVersionTool.execute({ documentId, name: 'Earlier', idempotencyKey: id(8) }, scoped)).toMatchObject({
    success: true, data: { versionId, documentId },
    invalidations: [{ type: 'documents', projectId: id(1), documentId }],
  });
  jest.mocked(getUserProjectRole).mockResolvedValueOnce({ role: 'viewer', isOwner: false });
  expect((await createDocumentVersionTool.execute({ documentId, name: 'No', idempotencyKey: id(9) }, scoped)).success).toBe(false);
  expect(createDocumentVersion).toHaveBeenCalledTimes(1);
  expect(createDocumentVersion).toHaveBeenCalledWith(scoped.supabase,
    { documentId, name: 'Earlier', idempotencyKey: id(8) });
});

it('always confirms restore and revalidates document and target version after approval', async () => {
  const { scoped } = setup();
  expect(needsConfirmation(restoreDocumentVersionTool, { autoExecute: true })).toBe(true);
  const prepared = await restoreDocumentVersionTool.prepareConfirmation!({ documentId, versionId }, scoped);
  expect(prepared).toMatchObject({ success: true, preview: {
    type: 'document_version_restore', documentId, versionId,
    currentToken: { epoch: 2, revision: 7 },
  } });
  if (!prepared.success) throw new Error(prepared.error);
  expect(await restoreDocumentVersionTool.execute(prepared.args, scoped)).toMatchObject({
    success: true, data: { epoch: 3, revision: 0, backupCreated: true },
    invalidations: [{ type: 'documents', projectId: id(1), documentId }],
  });
  expect(documentStateGateway.replace).toHaveBeenCalledWith(scoped.supabase, {
    documentId, expected: { epoch: 2, revision: 7 },
    replacement: { kind: 'version', versionId }, reason: 'restore',
  });
  expect(broadcastDocumentStateReset).toHaveBeenCalledWith(scoped.supabase,
    expect.objectContaining({ token: { epoch: 3, revision: 0 } }), 'restore');
});

it('rejects a stale approval before invoking the restore RPC', async () => {
  const { scoped } = setup();
  const prepared = await restoreDocumentVersionTool.prepareConfirmation!({ documentId, versionId }, scoped);
  if (!prepared.success) throw new Error(prepared.error);
  jest.mocked(documentStateGateway.readTransport).mockResolvedValueOnce({ ...state,
    updateTail: [{ id: id(9), updateBase64: 'different' }] });
  expect((await restoreDocumentVersionTool.execute(prepared.args, scoped)).success).toBe(false);
  expect(documentStateGateway.replace).not.toHaveBeenCalled();
});

it('rejects changed target content and revoked editor access', async () => {
  const { scoped } = setup();
  const prepared = await restoreDocumentVersionTool.prepareConfirmation!({ documentId, versionId }, scoped);
  if (!prepared.success) throw new Error(prepared.error);
  jest.mocked(getDocumentVersionPreview).mockResolvedValueOnce({ ...version, markdown: 'Changed' });
  expect((await restoreDocumentVersionTool.execute(prepared.args, scoped)).success).toBe(false);
  jest.mocked(getUserProjectRole).mockResolvedValueOnce({ role: 'viewer', isOwner: false });
  expect((await restoreDocumentVersionTool.execute(prepared.args, scoped)).success).toBe(false);
  expect(documentStateGateway.replace).not.toHaveBeenCalled();
});
