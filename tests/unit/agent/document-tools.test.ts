import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('server-only', () => ({}));

const read = jest.fn();
const initialize = jest.fn();
const replace = jest.fn();
const createDocument = jest.fn();
const deleteDocument = jest.fn();
const replaceDocumentAsAgent = jest.fn();
const broadcastDocumentStateReset = jest.fn();
const resolveDocumentForTool = jest.fn();
const listResolvedProjectDocuments = jest.fn();
const reindexProjectDocumentAsActor = jest.fn();
const resolveReferencesForPlainMarkdown = jest.fn();

jest.mock('@/lib/documents/documentStateGateway', () => ({
  documentStateGateway: { read, initialize, replace },
}));
jest.mock('@/lib/services/documentService', () => ({ createDocument, deleteDocument }));
jest.mock('@/lib/server/documentAgentEditService', () => ({
  replaceDocumentAsAgent,
}));
jest.mock('@/lib/server/documentEmbeddingIndexService', () => ({
  reindexProjectDocumentAsActor,
}));
jest.mock('@/lib/documents/documentStateResetBroadcaster', () => ({
  broadcastDocumentStateReset,
}));
jest.mock('@/lib/agent/document-resolver', () => ({
  resolveDocumentForTool,
  listResolvedProjectDocuments,
}));
jest.mock('@/lib/documents/resourceReferenceMarkdown', () => ({
  resolveReferencesForPlainMarkdown: (...args: unknown[]) =>
    resolveReferencesForPlainMarkdown(...args),
}));

import { createDocumentTool } from '@/lib/agent/tools/create-document';
import { readDocument } from '@/lib/agent/tools/read-document';
import { proposeDocumentEdit } from '@/lib/agent/tools/propose-document-edit';
import { renameDocument } from '@/lib/agent/tools/rename-document';
import { moveDocumentTool } from '@/lib/agent/tools/move-document';
import { deleteDocumentTool } from '@/lib/agent/tools/delete-document';
import { MAX_TOOL_CONTENT_CHARS } from '@/lib/agent/tool-result-for-llm';
import { escapeLiteralMdxBraces } from '@/lib/document-parser';

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

function replaceAllParams(markdown = '# Proposed') {
  return {
    documentId: DOCUMENT_ID,
    operation: { type: 'replace_all' as const, markdown },
  };
}

function contentHash(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}

async function withoutConfirmationSecrets<T>(run: () => Promise<T>): Promise<T> {
  const signingSecret = process.env.AGENT_CONFIRMATION_SIGNING_SECRET;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.AGENT_CONFIRMATION_SIGNING_SECRET;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    return await run();
  } finally {
    if (signingSecret === undefined) delete process.env.AGENT_CONFIRMATION_SIGNING_SECRET;
    else process.env.AGENT_CONFIRMATION_SIGNING_SECRET = signingSecret;
    if (serviceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;
  }
}

describe('Agent document tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    broadcastDocumentStateReset.mockResolvedValue(undefined);
    initialize.mockResolvedValue(state('# Guide', 0));
    deleteDocument.mockResolvedValue(undefined);
    resolveDocumentForTool.mockResolvedValue(resolvedDocument());
    listResolvedProjectDocuments.mockResolvedValue([]);
    reindexProjectDocumentAsActor.mockResolvedValue({ documentId: DOCUMENT_ID, chunks: 1 });
    resolveReferencesForPlainMarkdown.mockImplementation(async (_client, _projectId, markdown) => markdown);
  });

  it.each([
    ['create_document', createDocumentTool],
    ['read_document', readDocument],
    ['propose_document_edit', proposeDocumentEdit],
  ])('declares a closed JSON schema for %s', (_name, tool) => {
    expect(tool.parameters).toMatchObject({ additionalProperties: false });
  });

  it.each([
    ['read_document', readDocument],
    ['propose_document_edit', proposeDocumentEdit],
    ['rename_document', renameDocument],
    ['move_document', moveDocumentTool],
    ['delete_document', deleteDocumentTool],
  ])('documents selector order and duplicate-name stop behavior for %s', (_name, tool) => {
    expect(tool.description).toContain('Select by documentId first');
    expect(tool.description).toContain('exact documentName');
    expect(tool.description).toContain('current document');
    expect(tool.description).toContain('Stop when an exact name matches multiple documents');
  });

  it('requires reading content before proposing an edit and explains duplicate creation', () => {
    expect(proposeDocumentEdit.description).toContain(
      'Call read_document before editing document content'
    );
    expect(createDocumentTool.description).toContain(
      'Stop when the target folder already contains the same exact name'
    );
  });

  it('declares the edit selector dependency and non-empty append content in JSON Schema', () => {
    expect(proposeDocumentEdit.parameters).toMatchObject({
      anyOf: [
        { not: { required: ['folderName'] } },
        { required: ['documentId'] },
        { required: ['documentName'] },
      ],
      properties: {
        operation: {
          oneOf: expect.arrayContaining([
            expect.objectContaining({
              properties: {
                type: { type: 'string', enum: ['append'] },
                content: expect.objectContaining({ minLength: 1 }),
              },
            }),
          ]),
        },
      },
    });
  });

  it('rejects unknown runtime parameters for every document tool', async () => {
    const results = await Promise.all([
      createDocumentTool.execute(
        { name: 'Guide', content: '# Guide', unexpected: true },
        ctx
      ),
      readDocument.execute({ documentId: DOCUMENT_ID, unexpected: true }, ctx),
      proposeDocumentEdit.execute(
        {
          documentId: DOCUMENT_ID,
          operation: { type: 'replace_all', markdown: '# Proposed' },
          unexpected: true,
        },
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
    ).resolves.toMatchObject({
      success: true,
      data: { documentId: DOCUMENT_ID },
      invalidations: [{ type: 'documents', projectId: PROJECT_ID, documentId: DOCUMENT_ID }],
    });
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

  it('rejects empty append content before resolving a document', async () => {
    await expect(
      proposeDocumentEdit.execute(
        { documentId: DOCUMENT_ID, operation: { type: 'append', content: '' } },
        ctx
      )
    ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/invalid parameters/i) });
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

  it.each([
    ['full', {}, '# Heading\n\nCurrent value'],
    ['outline', { mode: 'outline' }, '# Heading'],
    ['heading', { mode: 'heading', heading: 'Heading' }, '# Heading\n\nCurrent value'],
    ['lines', { mode: 'lines', startLine: 2, endLine: 3 }, '\nCurrent value'],
  ])('resolves references before %s slicing', async (_mode, params, expected) => {
    const raw = '# <BlockAnchor id="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" />Heading\n\n<ResourceReference kind="table-row" libraryId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" assetId="cccccccc-cccc-4ccc-8ccc-cccccccccccc" displayFieldId="dddddddd-dddd-4ddd-8ddd-dddddddddddd" fallbackLabel="Old" />';
    read.mockResolvedValue(state(raw));
    resolveReferencesForPlainMarkdown.mockResolvedValue('# Heading\n\nCurrent value');

    const result = await readDocument.execute(params, ctx);

    expect(result).toMatchObject({ success: true, data: { markdown: expected } });
    expect(resolveReferencesForPlainMarkdown).toHaveBeenCalledWith(ctx.supabase, PROJECT_ID, raw);
    expect(JSON.stringify(result)).not.toContain('BlockAnchor');
    expect(JSON.stringify(result)).not.toContain('ResourceReference');
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

  it('resolves a document selector and previews an exact token/hash with metadata', async () => {
    resolveDocumentForTool.mockResolvedValue(
      resolvedDocument({ name: 'Notes', folderName: 'Lore' })
    );
    read.mockResolvedValue(state());
    const result = await proposeDocumentEdit.execute(
      {
        documentName: 'Notes',
        folderName: 'Lore',
        operation: { type: 'replace_all', markdown: '# Proposed' },
      },
      ctx
    );

    expect(proposeDocumentEdit.category).toBe('write');
    expect(proposeDocumentEdit.confirmationMode).toBe('post_preview');
    expect(result).toMatchObject({
      success: true,
      data: {
        type: 'document_edit',
        documentId: DOCUMENT_ID,
        documentName: 'Notes',
        folderName: 'Lore',
        operationType: 'replace_all',
        operationSummary: 'Replace entire document (10 characters).',
        expectedToken: { epoch: 2, revision: 4 },
        baseMarkdown: '# Current',
        baseUpdateIds: [],
        proposedMarkdown: '# Proposed',
      },
    });
    expect(resolveDocumentForTool).toHaveBeenCalledWith(
      ctx.supabase,
      PROJECT_ID,
      { documentName: 'Notes', folderName: 'Lore' },
      ctx
    );
  });

  it('defaults an edit proposal to the current document', async () => {
    read.mockResolvedValue(state());
    await proposeDocumentEdit.execute(
      { operation: { type: 'append', content: 'Appendix' } },
      ctx
    );
    expect(resolveDocumentForTool).toHaveBeenCalledWith(ctx.supabase, PROJECT_ID, {}, ctx);
  });

  it('rejects a folder qualifier without a document selector', async () => {
    await expect(
      proposeDocumentEdit.execute(
        { folderName: 'Other', operation: { type: 'append', content: 'Appendix' } },
        ctx
      )
    ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/invalid parameters/i) });
    expect(resolveDocumentForTool).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('returns safe ambiguity candidates without reading document state', async () => {
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

    await expect(
      proposeDocumentEdit.execute(
        { documentName: 'Guide', operation: { type: 'append', content: 'Appendix' } },
        ctx
      )
    ).resolves.toEqual({
      success: false,
      error: 'Multiple documents named "Guide" were found in this project.',
      data: { candidates },
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects resolved gateway state from another project', async () => {
    read.mockResolvedValue({
      ...state(),
      projectId: '55555555-5555-4555-8555-555555555555',
    });

    await expect(
      proposeDocumentEdit.execute(
        { documentId: DOCUMENT_ID, operation: { type: 'append', content: 'Appendix' } },
        ctx
      )
    ).resolves.toEqual({ success: false, error: 'Document not found in this project.' });
  });

  it('rejects replace_all that would wipe a long document down to a tiny fragment', async () => {
    const longMarkdown = `# Test0721\n\n${'body text '.repeat(200)}xx${'more paragraphs '.repeat(200)}`;
    read.mockResolvedValue(state(longMarkdown));

    await expect(
      proposeDocumentEdit.execute(
        {
          documentId: DOCUMENT_ID,
          operation: { type: 'replace_all', markdown: 'YY' },
        },
        ctx
      )
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/replace_text|destructive|wipe|allowDestructive/i),
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it('allows an intentional destructive replace_all when allowDestructive is true', async () => {
    const longMarkdown = `# Test0721\n\n${'body text '.repeat(200)}xx${'more paragraphs '.repeat(200)}`;
    read.mockResolvedValue(state(longMarkdown));

    await expect(
      proposeDocumentEdit.execute(
        {
          documentId: DOCUMENT_ID,
          operation: { type: 'replace_all', markdown: 'YY', allowDestructive: true },
        },
        ctx
      )
    ).resolves.toMatchObject({
      success: true,
      data: { operationType: 'replace_all', proposedMarkdown: 'YY' },
    });
  });

  it('generates a replace_text proposal that replaces every match when replaceAll is true', async () => {
    read.mockResolvedValue(state('start xx, middle xx, end xx'));

    await expect(
      proposeDocumentEdit.execute(
        {
          documentId: DOCUMENT_ID,
          operation: {
            type: 'replace_text',
            target: 'xx',
            replacement: 'YY',
            replaceAll: true,
          },
        },
        ctx
      )
    ).resolves.toMatchObject({
      success: true,
      data: {
        operationType: 'replace_text',
        proposedMarkdown: 'start YY, middle YY, end YY',
      },
    });
  });

  it('previews a long authoritative user source without copying it into tool arguments', async () => {
    const source = `${'\u957f\u6587\u672c\u6bb5\u843d {"value":"\\\\quoted"}\r\n'.repeat(800)}\u7ed3\u5c3e\r\n`;
    const encodedSource = escapeLiteralMdxBraces(source);
    const params = {
      documentId: DOCUMENT_ID,
      operation: { type: 'append_user_source' as const },
    };
    const sourceContext: ToolContext = {
      ...ctx,
      authoritativeUserSource: { messageId: 'message-long', content: source },
    };
    read.mockResolvedValue(state());

    const result = await proposeDocumentEdit.execute(params, sourceContext);

    expect(JSON.stringify(params)).not.toContain(source);
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ success: true });
    expect(result).toMatchObject({
      data: {
        operationType: 'append',
        operationSummary: `Append ${encodedSource.length} characters.`,
        proposedMarkdown: `# Current\n\n${encodedSource}`,
      },
    });
  });

  it('rejects incomplete authoritative source offsets before resolving the document', async () => {
    const sourceContext: ToolContext = {
      ...ctx,
      authoritativeUserSource: { messageId: 'message-long', content: '012345' },
    };

    await expect(
      proposeDocumentEdit.execute(
        {
          documentId: DOCUMENT_ID,
          operation: { type: 'append_user_source', sourceStart: 2 },
        },
        sourceContext
      )
    ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/invalid parameters/i) });
    expect(resolveDocumentForTool).not.toHaveBeenCalled();
  });

  it('applies a signed authoritative source append without rewriting the source', async () => {
    const source = `\u7b2c\u4e00\u884c\r\n{"json":true,"path":"C:\\\\data"}\r\n`;
    const encodedSource = escapeLiteralMdxBraces(source);
    const proposedMarkdown = `# Current\n\n${encodedSource}`;
    const params = {
      documentId: DOCUMENT_ID,
      operation: { type: 'append_user_source' as const },
    };
    const sourceContext: ToolContext = {
      ...ctx,
      authoritativeUserSource: { messageId: 'message-source', content: source },
    };
    read.mockResolvedValue(state());
    replaceDocumentAsAgent.mockResolvedValue(state(proposedMarkdown, 5));

    const result = await withoutConfirmationSecrets(async () => {
      const preview = await proposeDocumentEdit.execute(params, sourceContext);
      expect(preview.error).toBeUndefined();
      return proposeDocumentEdit.executeImport!(preview, params, sourceContext);
    });

    expect(replaceDocumentAsAgent).toHaveBeenCalledWith(
      expect.objectContaining({ markdown: proposedMarkdown })
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        operationType: 'append',
        operationSummary: `Append ${encodedSource.length} characters.`,
      },
    });
  });

  it.each([
    [
      'replace_all',
      '# Heading\nOld\nFooter',
      { type: 'replace_all', markdown: '# Entire replacement' },
      '# Entire replacement',
    ],
    [
      'replace_text',
      '# Heading\nOld\nFooter',
      { type: 'replace_text', target: 'Old', replacement: 'New' },
      '# Heading\nNew\nFooter',
    ],
    [
      'insert_before',
      '# Heading\nOld\nFooter',
      { type: 'insert_before', anchor: 'Footer', content: 'Middle' },
      '# Heading\nOld\nMiddle\nFooter',
    ],
    [
      'insert_after',
      '# Heading\nOld\nFooter',
      { type: 'insert_after', anchor: '# Heading', content: 'Intro' },
      '# Heading\nIntro\nOld\nFooter',
    ],
    [
      'append',
      '# Heading\nOld\nFooter',
      { type: 'append', content: 'Appendix' },
      '# Heading\nOld\nFooter\n\nAppendix',
    ],
    [
      'delete_text',
      '# Heading\nOld\nFooter',
      { type: 'delete_text', target: 'Old' },
      '# Heading\n\nFooter',
    ],
  ] as const)(
    'generates a %s proposal against the latest gateway state',
    async (operationType, currentMarkdown, operation, proposedMarkdown) => {
      read.mockResolvedValue(state(currentMarkdown));

      await expect(
        proposeDocumentEdit.execute({ documentId: DOCUMENT_ID, operation }, ctx)
      ).resolves.toMatchObject({
        success: true,
        data: { operationType, baseMarkdown: currentMarkdown, proposedMarkdown },
      });
      expect(read).toHaveBeenCalledWith(ctx.supabase, DOCUMENT_ID);
    }
  );

  it.each([
    { documentId: DOCUMENT_ID, operation: { type: 'append', content: 'x', unknown: true } },
    { documentId: DOCUMENT_ID, operation: { type: 'unknown', content: 'x' } },
    { documentId: DOCUMENT_ID, operation: { type: 'replace_text', target: 'x' } },
    { documentId: DOCUMENT_ID, operation: { type: 'delete_text', target: '', unknown: false } },
  ])('rejects an invalid or open operation object before resolving: %p', async (params) => {
    await expect(proposeDocumentEdit.execute(params, ctx)).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/invalid parameters/i),
    });
    expect(resolveDocumentForTool).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects provided and resulting strings over the document maximum', async () => {
    await expect(
      proposeDocumentEdit.execute(
        {
          documentId: DOCUMENT_ID,
          operation: { type: 'append', content: 'x'.repeat(500_001) },
        },
        ctx
      )
    ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/invalid parameters/i) });
    expect(read).not.toHaveBeenCalled();

    read.mockResolvedValue(state('x'.repeat(499_999)));
    await expect(
      proposeDocumentEdit.execute(
        { documentId: DOCUMENT_ID, operation: { type: 'append', content: 'y' } },
        ctx
      )
    ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/500000|too large/i) });
  });

  it('re-reads and rejects a stale confirmed proposal without replacing state', async () => {
    read.mockResolvedValueOnce(state()).mockResolvedValueOnce(state('# Changed', 5));
    const params = replaceAllParams();
    const preview = await proposeDocumentEdit.execute(params, ctx);
    const result = await proposeDocumentEdit.executeImport!(preview, params, ctx);

    expect(result).toMatchObject({ success: false });
    expect(replace).not.toHaveBeenCalled();
  });

  it('rejects a confirmed proposal whose signed base Markdown was changed', async () => {
    read.mockResolvedValue(state());
    const params = replaceAllParams();
    const preview = await proposeDocumentEdit.execute(params, ctx);
    const tamperedPreview = {
      ...preview,
      internalData: {
        ...(preview.internalData as Record<string, unknown>),
        baseMarkdown: '# Tampered original',
      },
    };

    await expect(proposeDocumentEdit.executeImport!(tamperedPreview, params, ctx)).resolves.toEqual({
      success: false,
      error: 'The approved document edit payload changed.',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(replaceDocumentAsAgent).not.toHaveBeenCalled();
  });

  it('applies a valid signed proposal through the guarded gateway', async () => {
    read.mockResolvedValue(state());
    replaceDocumentAsAgent.mockResolvedValue(state('# Proposed', 5));
    const params = replaceAllParams();
    const { preview, result } = await withoutConfirmationSecrets(async () => {
      const signedPreview = await proposeDocumentEdit.execute(params, ctx);
      const applied = await proposeDocumentEdit.executeImport!(signedPreview, params, ctx);
      return { preview: signedPreview, result: applied };
    });
    expect(preview).toMatchObject({
      success: true,
      internalData: { approvalSignature: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    expect(preview.data).not.toHaveProperty('approvalSignature');

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
      data: {
        documentId: DOCUMENT_ID,
        token: { epoch: 2, revision: 5 },
        documentName: 'Guide',
        folderName: null,
        operationType: 'replace_all',
        operationSummary: 'Replace entire document (10 characters).',
      },
      invalidations: [{ type: 'documents', projectId: PROJECT_ID, documentId: DOCUMENT_ID }],
    });
    expect(resolveDocumentForTool).toHaveBeenCalledTimes(1);
  });

  it('keeps an applied edit successful when background indexing fails', async () => {
    read.mockResolvedValue(state());
    replaceDocumentAsAgent.mockResolvedValue(state('# Proposed', 5));
    reindexProjectDocumentAsActor.mockRejectedValue(new Error('embedding unavailable'));
    const params = replaceAllParams();
    const result = await withoutConfirmationSecrets(async () => {
      const preview = await proposeDocumentEdit.execute(params, ctx);
      return proposeDocumentEdit.executeImport!(preview, params, ctx);
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(result).toMatchObject({ success: true });
    expect(reindexProjectDocumentAsActor).toHaveBeenCalledWith({
      actorUserId: ctx.userId,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });
  });

  it('rejects proposed Markdown tampering even when its unkeyed hash is recomputed', async () => {
    read.mockResolvedValue(state());
    replaceDocumentAsAgent.mockResolvedValue(state('# Tampered', 5));
    const params = replaceAllParams();
    const preview = await proposeDocumentEdit.execute(params, ctx);
    const tamperedPreview = {
      ...preview,
      internalData: {
        ...(preview.internalData as Record<string, unknown>),
        proposedMarkdown: '# Tampered',
        proposedHash: contentHash('# Tampered'),
      },
    };

    await expect(
      proposeDocumentEdit.executeImport!(tamperedPreview, params, ctx)
    ).resolves.toEqual({
      success: false,
      error: 'The approved document edit payload changed.',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(replaceDocumentAsAgent).not.toHaveBeenCalled();
  });

  it('rejects coherent operation argument and preview content tampering', async () => {
    read.mockResolvedValue(state());
    replaceDocumentAsAgent.mockResolvedValue(state('# Different', 5));
    const params = replaceAllParams();
    const preview = await proposeDocumentEdit.execute(params, ctx);
    const tamperedParams = replaceAllParams('# Different');
    const tamperedPreview = {
      ...preview,
      internalData: {
        ...(preview.internalData as Record<string, unknown>),
        operationSummary: 'Replace entire document (11 characters).',
        proposedMarkdown: '# Different',
        proposedHash: contentHash('# Different'),
      },
    };

    await expect(
      proposeDocumentEdit.executeImport!(tamperedPreview, tamperedParams, ctx)
    ).resolves.toEqual({
      success: false,
      error: 'The approved document edit payload changed.',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(replaceDocumentAsAgent).not.toHaveBeenCalled();
  });

  it('rejects operation metadata tampering', async () => {
    read.mockResolvedValue(state());
    replaceDocumentAsAgent.mockResolvedValue(state('# Proposed', 5));
    const params = replaceAllParams();
    const preview = await proposeDocumentEdit.execute(params, ctx);
    const tamperedPreview = {
      ...preview,
      internalData: {
        ...(preview.internalData as Record<string, unknown>),
        operationSummary: 'Append 10 characters.',
      },
    };

    await expect(
      proposeDocumentEdit.executeImport!(tamperedPreview, params, ctx)
    ).resolves.toEqual({
      success: false,
      error: 'The approved document edit payload changed.',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(replaceDocumentAsAgent).not.toHaveBeenCalled();
  });

  it('rejects a proposal with a missing approval signature', async () => {
    read.mockResolvedValue(state());
    replaceDocumentAsAgent.mockResolvedValue(state('# Proposed', 5));
    const params = replaceAllParams();
    const preview = await proposeDocumentEdit.execute(params, ctx);
    const { approvalSignature: _approvalSignature, ...unsignedData } = preview.internalData as Record<
      string,
      unknown
    >;
    const unsignedPreview = { ...preview, internalData: unsignedData };

    await expect(
      proposeDocumentEdit.executeImport!(unsignedPreview, params, ctx)
    ).resolves.toEqual({
      success: false,
      error: 'The approved document edit payload changed.',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(replaceDocumentAsAgent).not.toHaveBeenCalled();
  });

  it('rejects a proposal when server-only signed preview data is missing', async () => {
    read.mockResolvedValue(state());
    const params = replaceAllParams();
    const preview = await proposeDocumentEdit.execute(params, ctx);

    await expect(
      proposeDocumentEdit.executeImport!({ ...preview, internalData: undefined }, params, ctx)
    ).resolves.toEqual({
      success: false,
      error: 'The approved document edit payload changed.',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(replaceDocumentAsAgent).not.toHaveBeenCalled();
  });

  it('rejects a confirmed proposal when the gateway update tail changed', async () => {
    const baseState = {
      ...state(),
      updateTail: [{ id: '55555555-5555-4555-8555-555555555555' }],
    };
    const changedTail = {
      ...baseState,
      updateTail: [{ id: '66666666-6666-4666-8666-666666666666' }],
    };
    read.mockResolvedValueOnce(baseState).mockResolvedValueOnce(changedTail);
    const params = replaceAllParams();
    const preview = await proposeDocumentEdit.execute(params, ctx);

    await expect(proposeDocumentEdit.executeImport!(preview, params, ctx)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('changed after this edit was proposed'),
    });
    expect(replaceDocumentAsAgent).not.toHaveBeenCalled();
  });

  it('keeps a committed Agent edit successful when reset acceleration fails', async () => {
    read.mockResolvedValue(state());
    replaceDocumentAsAgent.mockResolvedValue(state('# Proposed', 5));
    broadcastDocumentStateReset.mockRejectedValueOnce(new Error('realtime offline'));
    const params = replaceAllParams();
    const preview = await proposeDocumentEdit.execute(params, ctx);

    await expect(
      proposeDocumentEdit.executeImport!(preview, params, ctx)
    ).resolves.toMatchObject({ success: true });
  });
});
