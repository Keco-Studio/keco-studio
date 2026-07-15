import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

const read = jest.fn();
const initialize = jest.fn();
const replace = jest.fn();
const createDocument = jest.fn();
const deleteDocument = jest.fn();
const replaceDocumentAsAgent = jest.fn();
const broadcastDocumentStateReset = jest.fn();

jest.mock('@/lib/documents/documentStateGateway', () => ({
  documentStateGateway: { read, initialize, replace },
}));
jest.mock('@/lib/services/documentService', () => ({ createDocument, deleteDocument }));
jest.mock('@/lib/server/documentAgentEditService', () => ({
  replaceDocumentAsAgent,
}));
jest.mock('@/lib/documents/documentStateResetBroadcaster', () => ({
  broadcastDocumentStateReset,
}));

import { createDocumentTool } from '@/lib/agent/tools/create-document';
import { readDocument } from '@/lib/agent/tools/read-document';
import { proposeDocumentEdit } from '@/lib/agent/tools/propose-document-edit';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';

const ctx = {
  projectId: PROJECT_ID,
  userId: '33333333-3333-4333-8333-333333333333',
  conversationId: '44444444-4444-4444-8444-444444444444',
  userRole: 'editor',
  supabase: {} as SupabaseClient,
} satisfies ToolContext;

function state(markdown = '# Current', revision = 4) {
  return {
    documentId: DOCUMENT_ID,
    projectId: PROJECT_ID,
    mode: 'collaborative' as const,
    markdown,
    yjsStateBase64: 'state',
    updateTail: [],
    token: { epoch: 2, revision },
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

describe('Agent document tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    broadcastDocumentStateReset.mockResolvedValue(undefined);
    initialize.mockResolvedValue(state('# Guide', 0));
    deleteDocument.mockResolvedValue(undefined);
  });

  it.each([
    ['create_document', createDocumentTool],
    ['read_document', readDocument],
    ['propose_document_edit', proposeDocumentEdit],
  ])('declares a closed JSON schema for %s', (_name, tool) => {
    expect(tool.parameters).toMatchObject({ additionalProperties: false });
  });

  it('rejects unknown runtime parameters for every document tool', async () => {
    const results = await Promise.all([
      createDocumentTool.execute(
        { name: 'Guide', content: '# Guide', unexpected: true },
        ctx
      ),
      readDocument.execute({ documentId: DOCUMENT_ID, unexpected: true }, ctx),
      proposeDocumentEdit.execute(
        { documentId: DOCUMENT_ID, markdown: '# Proposed', unexpected: true },
        ctx
      ),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ success: false }),
      expect.objectContaining({ success: false }),
      expect.objectContaining({ success: false }),
    ]);
    expect(createDocument).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('creates a validated document inside the caller project', async () => {
    createDocument.mockResolvedValue({ id: DOCUMENT_ID, name: 'Guide' });
    await expect(
      createDocumentTool.execute({ name: 'Guide', content: '# Guide' }, ctx)
    ).resolves.toMatchObject({ success: true, data: { documentId: DOCUMENT_ID } });
    expect(createDocument).toHaveBeenCalledWith(ctx.supabase, {
      projectId: PROJECT_ID,
      name: 'Guide',
      content: '# Guide',
      folderId: undefined,
    });
    expect(initialize).toHaveBeenCalledWith(ctx.supabase, DOCUMENT_ID, '# Guide');
  });

  it('surfaces initialization failure and cleans up the newly created row', async () => {
    createDocument.mockResolvedValue({ id: DOCUMENT_ID, name: 'Guide' });
    initialize.mockRejectedValue(new Error('Unable to initialize collaboration state.'));
    read.mockResolvedValue({
      ...state('# Guide', 0),
      mode: 'legacy',
      yjsStateBase64: null,
    });

    await expect(
      createDocumentTool.execute({ name: 'Guide', content: '# Guide' }, ctx)
    ).resolves.toEqual({
      success: false,
      error: 'Unable to initialize collaboration state.',
    });
    expect(deleteDocument).toHaveBeenCalledWith(ctx.supabase, DOCUMENT_ID);
  });

  it('keeps a document that another client initialized after the Agent insert', async () => {
    createDocument.mockResolvedValue({ id: DOCUMENT_ID, name: 'Guide' });
    initialize.mockRejectedValue(new Error('Document state changed'));
    read.mockResolvedValue(state('# Guide', 1));

    await expect(
      createDocumentTool.execute({ name: 'Guide', content: '# Guide' }, ctx)
    ).resolves.toMatchObject({
      success: true,
      data: { documentId: DOCUMENT_ID, name: 'Guide' },
    });
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('does not return a document from another project', async () => {
    read.mockResolvedValue({ ...state(), projectId: '55555555-5555-4555-8555-555555555555' });
    await expect(
      readDocument.execute({ documentId: DOCUMENT_ID }, ctx)
    ).resolves.toMatchObject({ success: false });
  });

  it('previews an exact token/hash and always uses post-preview confirmation', async () => {
    read.mockResolvedValue(state());
    const result = await proposeDocumentEdit.execute(
      { documentId: DOCUMENT_ID, markdown: '# Proposed' },
      ctx
    );

    expect(proposeDocumentEdit.category).toBe('write');
    expect(proposeDocumentEdit.confirmationMode).toBe('post_preview');
    expect(result).toMatchObject({
      success: true,
      data: {
        type: 'document_edit',
        documentId: DOCUMENT_ID,
        expectedToken: { epoch: 2, revision: 4 },
        baseUpdateIds: [],
        proposedMarkdown: '# Proposed',
      },
    });
  });

  it('re-reads and rejects a stale confirmed proposal without replacing state', async () => {
    read.mockResolvedValueOnce(state()).mockResolvedValueOnce(state('# Changed', 5));
    const preview = await proposeDocumentEdit.execute(
      { documentId: DOCUMENT_ID, markdown: '# Proposed' },
      ctx
    );
    const result = await proposeDocumentEdit.executeImport!(preview, {}, ctx);

    expect(result).toMatchObject({ success: false });
    expect(replace).not.toHaveBeenCalled();
  });

  it('applies the exact approved proposal through the guarded gateway', async () => {
    read.mockResolvedValue(state());
    replaceDocumentAsAgent.mockResolvedValue(state('# Proposed', 5));
    const preview = await proposeDocumentEdit.execute(
      { documentId: DOCUMENT_ID, markdown: '# Proposed' },
      ctx
    );
    const result = await proposeDocumentEdit.executeImport!(preview, {}, ctx);

    expect(replaceDocumentAsAgent).toHaveBeenCalledWith({
      actorUserId: ctx.userId,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 4 },
      expectedUpdateIds: [],
      markdown: '# Proposed',
    });
    expect(broadcastDocumentStateReset).toHaveBeenCalledWith(
      ctx.supabase,
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        token: { epoch: 2, revision: 5 },
      })
    );
    expect(result).toEqual({
      success: true,
      displayHint: 'text',
      data: { documentId: DOCUMENT_ID, token: { epoch: 2, revision: 5 } },
    });
  });

  it('keeps a committed Agent edit successful when reset acceleration fails', async () => {
    read.mockResolvedValue(state());
    replaceDocumentAsAgent.mockResolvedValue(state('# Proposed', 5));
    broadcastDocumentStateReset.mockRejectedValueOnce(new Error('realtime offline'));
    const preview = await proposeDocumentEdit.execute(
      { documentId: DOCUMENT_ID, markdown: '# Proposed' },
      ctx
    );

    await expect(
      proposeDocumentEdit.executeImport!(preview, {}, ctx)
    ).resolves.toMatchObject({ success: true });
  });
});
