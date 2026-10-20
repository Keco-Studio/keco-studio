import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { deleteLibrary, updateLibrary } from '@/lib/services/libraryService';
import { deleteScriptWorkspaceDocument, upsertScriptWorkspaceDocument } from '@/lib/script-system/scriptWorkspaceService';
import {
  addScriptDocumentTool, removeScriptDocumentTool, renameScriptTool, deleteScriptTool,
} from '@/lib/agent/tools/script-workspace-action-tools';

jest.mock('@/lib/services/authorizationService', () => ({ getUserProjectRole: jest.fn() }));
jest.mock('@/lib/services/libraryService', () => ({ deleteLibrary: jest.fn(), updateLibrary: jest.fn() }));
jest.mock('@/lib/script-system/scriptWorkspaceService', () => ({
  deleteScriptWorkspaceDocument: jest.fn(), upsertScriptWorkspaceDocument: jest.fn(),
}));

const projectId = '11111111-1111-4111-8111-111111111111';
const otherProjectId = '22222222-2222-4222-8222-222222222222';
const documentId = '33333333-3333-4333-8333-333333333333';
const libraryId = '44444444-4444-4444-8444-444444444444';
const updatedAt = '2026-09-28T00:00:00.000Z';
const importedAt = '2026-09-28T00:01:00.000Z';
const rows: Record<string, Record<string, unknown> | null> = {};
const query = { select: jest.fn(), eq: jest.fn(), maybeSingle: jest.fn() };
const client = { from: jest.fn() } as unknown as SupabaseClient;
const ctx: ToolContext = {
  userId: 'user-1', projectId, conversationId: 'conversation-1', workspace: 'script', supabase: client,
};

beforeEach(() => {
  jest.clearAllMocks();
  rows.documents = { id: documentId, project_id: projectId, name: 'Source', updated_at: updatedAt };
  rows.script_workspace_documents = { document_id: documentId, imported_at: importedAt };
  rows.libraries = { id: libraryId, project_id: projectId, name: 'Scene', description: 'Keep this', updated_at: updatedAt,
    document_export_type: 'script', source_document_id: documentId };
  let table = '';
  jest.mocked(client.from).mockImplementation((name) => { table = name; return query as never; });
  query.select.mockImplementation(() => query);
  query.eq.mockImplementation(() => query);
  query.maybeSingle.mockImplementation(async () => ({ data: rows[table], error: null }));
  jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'admin', isOwner: true });
  jest.mocked(deleteLibrary).mockResolvedValue(undefined);
  jest.mocked(updateLibrary).mockResolvedValue(undefined);
  jest.mocked(deleteScriptWorkspaceDocument).mockResolvedValue(undefined);
  jest.mocked(upsertScriptWorkspaceDocument).mockResolvedValue(undefined);
});

it('adds only a document in the frozen project through the Script workspace service', async () => {
  const result = await addScriptDocumentTool.execute({ documentId }, ctx);
  expect(result).toMatchObject({ success: true, data: { projectId, documentId } });
  expect(upsertScriptWorkspaceDocument).toHaveBeenCalledWith(client, { projectId, documentId, userId: 'user-1' });
  rows.documents = { ...rows.documents!, project_id: otherProjectId };
  expect((await addScriptDocumentTool.execute({ documentId }, ctx)).success).toBe(false);
  expect(upsertScriptWorkspaceDocument).toHaveBeenCalledTimes(1);
});

it('always confirms membership removal and rejects changed target after approval', async () => {
  expect(removeScriptDocumentTool.confirmationPolicy).toBe('always');
  const prepared = await removeScriptDocumentTool.prepareConfirmation!({ documentId }, ctx);
  if (!prepared.success) throw new Error('Expected removal preview');
  expect(prepared.preview).toMatchObject({ documentId, name: 'Source' });
  rows.script_workspace_documents = { document_id: documentId, imported_at: 'later' };
  expect((await removeScriptDocumentTool.execute(prepared.args, ctx)).error).toMatch(/changed after approval/);
  expect(deleteScriptWorkspaceDocument).not.toHaveBeenCalled();
  rows.script_workspace_documents = { document_id: documentId, imported_at: importedAt };
  expect((await removeScriptDocumentTool.execute(prepared.args, ctx)).success).toBe(true);
  expect(deleteScriptWorkspaceDocument).toHaveBeenCalledWith(client, { projectId, documentId });
});

it('limits Script rename and delete to admin and exact Script libraries in this project', async () => {
  jest.mocked(getUserProjectRole).mockResolvedValueOnce({ role: 'editor', isOwner: false });
  expect((await renameScriptTool.prepareConfirmation!({ libraryId, name: 'New' }, ctx)).success).toBe(false);
  rows.libraries = { ...rows.libraries!, document_export_type: 'table' };
  expect((await deleteScriptTool.prepareConfirmation!({ libraryId }, ctx)).success).toBe(false);
  rows.libraries = { ...rows.libraries!, document_export_type: 'script', project_id: otherProjectId };
  expect((await deleteScriptTool.prepareConfirmation!({ libraryId }, ctx)).success).toBe(false);
  expect(updateLibrary).not.toHaveBeenCalled();
  expect(deleteLibrary).not.toHaveBeenCalled();
});

it('rechecks the exact Script revision before confirmed rename and delete', async () => {
  expect(renameScriptTool.confirmationPolicy).toBe('always');
  expect(deleteScriptTool.confirmationPolicy).toBe('always');
  const rename = await renameScriptTool.prepareConfirmation!({ libraryId, name: 'New' }, ctx);
  const deletion = await deleteScriptTool.prepareConfirmation!({ libraryId }, ctx);
  if (!rename.success || !deletion.success) throw new Error('Expected Script previews');
  rows.libraries = { ...rows.libraries!, updated_at: 'later' };
  expect((await renameScriptTool.execute(rename.args, ctx)).error).toMatch(/changed after approval/);
  expect((await deleteScriptTool.execute(deletion.args, ctx)).error).toMatch(/changed after approval/);
  expect(updateLibrary).not.toHaveBeenCalled();
  expect(deleteLibrary).not.toHaveBeenCalled();
  rows.libraries = { ...rows.libraries!, updated_at: updatedAt };
  expect((await renameScriptTool.execute(rename.args, ctx)).success).toBe(true);
  expect(updateLibrary).toHaveBeenCalledWith(client, libraryId, { name: 'New', description: 'Keep this' });
  expect((await deleteScriptTool.execute(deletion.args, ctx)).success).toBe(true);
  expect(deleteLibrary).toHaveBeenCalledWith(client, libraryId);
});
