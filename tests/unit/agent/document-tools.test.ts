import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

const read = jest.fn();
const initialize = jest.fn();
const replace = jest.fn();
const createDocument = jest.fn();
const deleteDocument = jest.fn();
const replaceDocumentAsAgent = jest.fn();
const broadcastDocumentStateReset = jest.fn();
const resolveDocumentForTool = jest.fn();

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
jest.mock('@/lib/agent/document-resolver', () => ({
  resolveDocumentForTool,
}));

import { createDocumentTool } from '@/lib/agent/tools/create-document';
import { readDocument } from '@/lib/agent/tools/read-document';
import { proposeDocumentEdit } from '@/lib/agent/tools/propose-document-edit';
import { MAX_TOOL_CONTENT_CHARS } from '@/lib/agent/tool-result-for-llm';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';

const ctx = {
  projectId: PROJECT_ID,
  userId: '33333333-3333-4333-8333-333333333333',
  conversationId: '44444444-4444-4444-8444-444444444444',
  userRole: 'editor',
  supabase: {} as SupabaseClient,
  currentDocumentId: DOCUMENT_ID,
  currentDocumentName: 'Guide',
} satisfies ToolContext;

function resolvedDocument(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    source: 'current',
    document: {
      id: DOCUMENT_ID,
      project_id: PROJECT_ID,
      folder_id: null,
      folderName: null,
      name: 'Guide',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-15T00:00:00.000Z',
      ...overrides,
    },
  };
}

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
    resolveDocumentForTool.mockResolvedValue(resolvedDocument());
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
    expect(createDocumentTool.confirmationRequired).toBe(true);
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

  it('resolves an explicit selector and reads the latest gateway state', async () => {
    resolveDocumentForTool.mockResolvedValue(
      resolvedDocument({ name: 'Notes', folderName: 'Lore' })
    );
    read.mockResolvedValue(state('# Latest from Yjs tail'));

    await expect(
      readDocument.execute({ documentName: 'Notes', folderName: 'Lore' }, ctx)
    ).resolves.toMatchObject({
      success: true,
      data: {
        documentId: DOCUMENT_ID,
        name: 'Notes',
        folderName: 'Lore',
        projectId: PROJECT_ID,
        markdown: '# Latest from Yjs tail',
        mode: 'full',
        startLine: 1,
        endLine: 1,
        totalLines: 1,
        complete: true,
      },
    });
    expect(resolveDocumentForTool).toHaveBeenCalledWith(
      ctx.supabase,
      PROJECT_ID,
      { documentName: 'Notes', folderName: 'Lore' },
      ctx
    );
    expect(read).toHaveBeenCalledWith(ctx.supabase, DOCUMENT_ID);
  });

  it('defaults to the current document when no selector is supplied', async () => {
    read.mockResolvedValue(state());
    await readDocument.execute({ mode: 'outline' }, ctx);
    expect(resolveDocumentForTool).toHaveBeenCalledWith(ctx.supabase, PROJECT_ID, {}, ctx);
  });

  it('rejects a folder qualifier without a document selector', async () => {
    await expect(readDocument.execute({ folderName: 'Other' }, ctx)).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/invalid parameters/i),
    });
    expect(resolveDocumentForTool).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('returns safe ambiguity candidates without reading state', async () => {
    const candidates = [
      {
        id: DOCUMENT_ID,
        name: 'Guide',
        folderId: null,
        folderName: null,
        updatedAt: '2026-07-15T00:00:00.000Z',
      },
    ];
    resolveDocumentForTool.mockResolvedValue({
      ok: false,
      code: 'AMBIGUOUS',
      error: 'Multiple documents named "Guide" were found in this project.',
      candidates,
    });

    await expect(readDocument.execute({ documentName: 'Guide' }, ctx)).resolves.toEqual({
      success: false,
      error: 'Multiple documents named "Guide" were found in this project.',
      data: { candidates },
    });
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['outline', { mode: 'outline' }, '# One\n## Child\n# Two', { startLine: 1, endLine: 4, complete: false }],
    ['heading', { mode: 'heading', heading: 'One' }, '# One\nbody\n## Child', { startLine: 1, endLine: 3, complete: false }],
    ['lines', { mode: 'lines', startLine: 2, endLine: 3 }, 'body\n## Child', { startLine: 2, endLine: 3, complete: false }],
  ])('returns bounded %s reads with range metadata', async (_mode, params, markdown, metadata) => {
    read.mockResolvedValue(state('# One\nbody\n## Child\n# Two'));
    await expect(readDocument.execute(params, ctx)).resolves.toMatchObject({
      success: true,
      data: { mode: params.mode, markdown, totalLines: 4, ...metadata },
    });
  });

  it('falls back to an outline instead of returning an oversized full body', async () => {
    const markdown = `# Start\n${'x'.repeat(16_100)}\n## Details\nbody`;
    read.mockResolvedValue(state(markdown));

    const result = await readDocument.execute({}, ctx);
    expect(result).toMatchObject({
      success: true,
      data: {
        requestedMode: 'full',
        mode: 'outline',
        markdown: '# Start\n## Details',
        complete: false,
        fallbackReason: expect.stringMatching(/too large/i),
        _llmNote: expect.stringMatching(/heading|lines/i),
      },
    });
    expect((result.data as { markdown: string }).markdown).not.toContain('x'.repeat(100));
  });

  it('falls back when escaping makes the complete full-read result exceed the LLM budget', async () => {
    const denseBody = '\\\"\n'.repeat(3_900);
    const markdown = `# Start\n${denseBody}## Details\nbody`;
    expect(markdown.length).toBeLessThan(12_000);
    expect(
      JSON.stringify({
        success: true,
        displayHint: 'text',
        data: {
          documentId: DOCUMENT_ID,
          name: 'Guide',
          folderName: null,
          projectId: PROJECT_ID,
          token: { epoch: 2, revision: 4 },
          mode: 'full',
          markdown,
          startLine: 1,
          endLine: 3_903,
          totalLines: 3_903,
          complete: true,
        },
      }).length
    ).toBeGreaterThan(MAX_TOOL_CONTENT_CHARS);
    read.mockResolvedValue(state(markdown));

    const result = await readDocument.execute({}, ctx);

    expect(result).toMatchObject({
      success: true,
      data: {
        requestedMode: 'full',
        mode: 'outline',
        markdown: '# Start\n## Details',
        complete: false,
        fallbackReason: expect.stringMatching(/too large/i),
        _llmNote: expect.stringMatching(/heading|lines/i),
      },
    });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(MAX_TOOL_CONTENT_CHARS);
    expect((result.data as { markdown: string }).markdown).not.toContain(denseBody.slice(0, 100));
  });

  it.each([
    { heading: 'One' },
    { mode: 'heading' },
    { mode: 'heading', heading: 'One', startLine: 1 },
    { mode: 'lines', startLine: 1 },
    { mode: 'lines', startLine: 1, endLine: 2, heading: 'One' },
    { mode: 'outline', endLine: 2 },
    { mode: 'full', heading: 'One' },
  ])('rejects incompatible mode parameters: %p', async (params) => {
    await expect(readDocument.execute(params, ctx)).resolves.toMatchObject({ success: false });
    expect(resolveDocumentForTool).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'lines', startLine: 0, endLine: 1 },
    { mode: 'lines', startLine: 1, endLine: 0 },
    { mode: 'lines', startLine: -1, endLine: 1 },
    { mode: 'lines', startLine: 1, endLine: -1 },
  ])('rejects non-positive line bounds before resolving a document: %p', async (params) => {
    await expect(readDocument.execute(params, ctx)).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/invalid parameters/i),
    });
    expect(resolveDocumentForTool).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
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
        baseMarkdown: '# Current',
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

  it('rejects a confirmed proposal whose displayed base Markdown was changed', async () => {
    read.mockResolvedValue(state());
    const preview = await proposeDocumentEdit.execute(
      { documentId: DOCUMENT_ID, markdown: '# Proposed' },
      ctx
    );
    const tamperedPreview = {
      ...preview,
      data: {
        ...(preview.data as Record<string, unknown>),
        baseMarkdown: '# Tampered original',
      },
    };

    await expect(proposeDocumentEdit.executeImport!(tamperedPreview, {}, ctx)).resolves.toEqual({
      success: false,
      error: 'The approved document edit payload changed.',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(replaceDocumentAsAgent).not.toHaveBeenCalled();
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
