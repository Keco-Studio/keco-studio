import type { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = jest.fn();
const replaceDocumentAsAgent = jest.fn();
const prepareScriptDialogueDerivedTableOperations = jest.fn();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentStateGateway', () => ({ documentStateGateway: { read } }));
jest.mock('@/lib/server/documentAgentEditService', () => ({ replaceDocumentAsAgent }));
jest.mock('@/lib/server/scriptDialogueDerivedTableSyncService', () => ({
  prepareScriptDialogueDerivedTableOperations,
  prepareScriptDialogueLibraryReconciliation: jest.fn(),
}));

import { syncScriptDialogueDocument } from '@/lib/server/scriptDialogueDocumentSyncService';

const projectId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';
const libraryId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const fingerprint = 'a'.repeat(32);
const command = { type: 'edit' as const, role: 'action' as const,
  previousText: '', nextText: 'Smiles', speaker: 'Ada', previousDialogue: 'Hello', dialogue: 'Updated' };

const single = jest.fn();
const eq = jest.fn();
const supabase = { from: jest.fn() } as unknown as SupabaseClient;

beforeEach(() => {
  jest.clearAllMocks();
  read.mockResolvedValue({ projectId, documentId,
    markdown: '<BlockAnchor id="55555555-5555-4555-8555-555555555555" />Ada：Hello',
    token: { epoch: 1, revision: 2 }, updateTail: [] });
  single.mockResolvedValue({ data: { id: libraryId, document_export_type: 'script' }, error: null });
  eq.mockReturnValue({ eq, single });
  jest.mocked(supabase.from).mockReturnValue({ select: jest.fn().mockReturnValue({ eq }) } as never);
  prepareScriptDialogueDerivedTableOperations.mockResolvedValue([{ libraryId, type: 'edit' }]);
  replaceDocumentAsAgent.mockResolvedValue({ token: { epoch: 2, revision: 3 } });
});

it('includes the origin Script in the same replacement transaction only when opted in', async () => {
  await syncScriptDialogueDocument({ supabase, actorUserId: userId, projectId, libraryId,
    documentId, expected: { epoch: 1, revision: 2 }, command,
    originScriptFingerprint: fingerprint });
  expect(prepareScriptDialogueDerivedTableOperations).toHaveBeenCalledWith(expect.objectContaining({
    includeScriptLibraries: true,
  }));
  expect(replaceDocumentAsAgent).toHaveBeenCalledWith(expect.objectContaining({
    originScript: { libraryId, expectedFingerprint: fingerprint },
    derivedTableOperations: [{ libraryId, type: 'edit' }],
  }), expect.anything());
});

it('rejects a missing origin operation before replacing the Document', async () => {
  prepareScriptDialogueDerivedTableOperations.mockResolvedValueOnce([{ libraryId: documentId, type: 'edit' }]);
  await expect(syncScriptDialogueDocument({ supabase, actorUserId: userId, projectId, libraryId,
    documentId, expected: { epoch: 1, revision: 2 }, command,
    originScriptFingerprint: fingerprint })).rejects.toThrow('origin Script operation missing');
  expect(replaceDocumentAsAgent).not.toHaveBeenCalled();
});

it('keeps the legacy UI path scoped to sibling tables', async () => {
  await syncScriptDialogueDocument({ supabase, actorUserId: userId, projectId, libraryId,
    documentId, expected: { epoch: 1, revision: 2 }, command });
  expect(prepareScriptDialogueDerivedTableOperations).toHaveBeenCalledWith(expect.objectContaining({
    includeScriptLibraries: false,
  }));
  expect(replaceDocumentAsAgent).toHaveBeenCalledWith(expect.not.objectContaining({ originScript: expect.anything() }), expect.anything());
});

it('migration locks and checks origin rows inside the replacement transaction', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260928150000_atomic_origin_script_dialogue_sync.sql'), 'utf8');
  expect(sql).toContain('for update of value');
  expect(sql).toContain('public.script_dialogue_origin_fingerprint(p_origin_script_library_id)');
  expect(sql).toContain('public.replace_document_with_markdown_and_sync_tables(');
  expect(sql).toContain("operation.value ->> 'type' <> 'edit'");
});
