import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

const createDocument = jest.fn();
const deleteDocument = jest.fn();
const updateDocumentName = jest.fn();
const moveDocument = jest.fn();
const listResolvedProjectDocuments = jest.fn();
const resolveDocumentForTool = jest.fn();
const findFolderByName = jest.fn();
const initialize = jest.fn();
const reindexProjectDocumentAsActor = jest.fn();

jest.mock('@/lib/services/documentService', () => ({
  createDocument,
  deleteDocument,
  updateDocumentName,
  moveDocument,
}));
jest.mock('@/lib/agent/document-resolver', () => ({
  listResolvedProjectDocuments,
  resolveDocumentForTool,
}));
jest.mock('@/lib/agent/data-access', () => ({ findFolderByName }));
jest.mock('@/lib/documents/documentStateGateway', () => ({
  documentStateGateway: { initialize },
}));
jest.mock('@/lib/server/documentEmbeddingIndexService', () => ({
  reindexProjectDocumentAsActor,
}));

import { createDocumentTool } from '@/lib/agent/tools/create-document';
import { renameDocument } from '@/lib/agent/tools/rename-document';
import { moveDocumentTool } from '@/lib/agent/tools/move-document';
import { resolveTool } from '@/lib/agent/tools';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_DOCUMENT_ID = '55555555-5555-4555-8555-555555555555';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const ARCHIVE_ID = '66666666-6666-4666-8666-666666666666';
const MIXED_CASE_FOLDER_ID = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const CANONICAL_FOLDER_ID = MIXED_CASE_FOLDER_ID.toLowerCase();

const ctx = {
  projectId: PROJECT_ID,
  userId: '33333333-3333-4333-8333-333333333333',
  conversationId: '44444444-4444-4444-8444-444444444444',
  userRole: 'editor',
  supabase: {} as SupabaseClient,
  currentDocumentId: DOCUMENT_ID,
  currentDocumentName: 'Guide',
} satisfies ToolContext;

function documentSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: DOCUMENT_ID,
    project_id: PROJECT_ID,
    folder_id: null,
    folderName: null,
    name: 'Guide',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('Agent document metadata tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listResolvedProjectDocuments.mockResolvedValue([]);
    resolveDocumentForTool.mockResolvedValue({
      ok: true,
      source: 'current',
      document: documentSummary(),
    });
    findFolderByName.mockResolvedValue({
      folder: { id: ARCHIVE_ID, name: 'Archive' },
      available: ['Archive'],
    });
    createDocument.mockResolvedValue({ id: OTHER_DOCUMENT_ID, name: 'Guide' });
    initialize.mockResolvedValue(undefined);
    updateDocumentName.mockResolvedValue(undefined);
    moveDocument.mockResolvedValue(undefined);
    reindexProjectDocumentAsActor.mockResolvedValue({ documentId: DOCUMENT_ID, chunks: 1 });
  });

  it.each([
    ['create_document', createDocumentTool],
    ['rename_document', renameDocument],
    ['move_document', moveDocumentTool],
  ])('declares a closed schema and editor pre-execution policy for %s', (_name, tool) => {
    expect(tool.parameters).toMatchObject({ additionalProperties: false });
    expect(tool.requiredPermission).toBe('editor');
    expect(tool.confirmationMode).toBe('pre_execute');
  });

  it('keeps runtime and JSON Schema name constraints aligned', async () => {
    expect(createDocumentTool.parameters).toMatchObject({
      properties: {
        name: { minLength: 1, maxLength: 200, pattern: '\\S' },
        content: { maxLength: 500_000, default: '' },
        folderId: { format: 'uuid' },
      },
    });
    expect(renameDocument.parameters).toMatchObject({
      properties: { newName: { minLength: 1, maxLength: 200, pattern: '\\S' } },
    });
    await expect(renameDocument.execute({ newName: '   ' }, ctx)).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/invalid parameters/i),
    });
    expect(resolveDocumentForTool).not.toHaveBeenCalled();
  });

  it('measures JSON Schema string limits in Unicode code points', async () => {
    const maximumName = '\u{1F680}'.repeat(200);
    const tooLongName = `${maximumName}\u{1F680}`;

    await expect(
      createDocumentTool.execute({ name: maximumName, content: '' }, ctx)
    ).resolves.toMatchObject({ success: true });
    expect(createDocument).toHaveBeenCalledWith(
      ctx.supabase,
      expect.objectContaining({ name: maximumName })
    );

    createDocument.mockClear();
    await expect(
      createDocumentTool.execute({ name: tooLongName, content: '' }, ctx)
    ).resolves.toMatchObject({ success: false });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('preflights an exact duplicate in the target folder without creating it', async () => {
    listResolvedProjectDocuments.mockResolvedValue([
      documentSummary({ folder_id: ARCHIVE_ID, folderName: 'Archive' }),
      documentSummary({
        id: OTHER_DOCUMENT_ID,
        name: 'Guide',
        folder_id: null,
        folderName: null,
      }),
    ]);

    await expect(
      createDocumentTool.execute(
        { name: 'Guide', content: '# New', folderId: ARCHIVE_ID },
        ctx
      )
    ).resolves.toEqual({
      success: false,
      error: 'A document named "Guide" already exists in the target folder.',
      data: {
        candidates: [
          {
            id: DOCUMENT_ID,
            name: 'Guide',
            folderId: ARCHIVE_ID,
            folderName: 'Archive',
            updatedAt: '2026-07-15T00:00:00.000Z',
          },
        ],
      },
    });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('preflights a root duplicate using the service-trimmed document name', async () => {
    listResolvedProjectDocuments.mockResolvedValue([documentSummary()]);

    await expect(
      createDocumentTool.execute({ name: ' Guide ', content: '# New' }, ctx)
    ).resolves.toMatchObject({
      success: false,
      error: 'A document named "Guide" already exists in the target folder.',
      data: { candidates: [{ id: DOCUMENT_ID, name: 'Guide', folderId: null }] },
    });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('preflights a folder duplicate using a canonical lowercase UUID', async () => {
    listResolvedProjectDocuments.mockResolvedValue([
      documentSummary({ folder_id: CANONICAL_FOLDER_ID, folderName: 'Archive' }),
    ]);

    await expect(
      createDocumentTool.execute(
        { name: 'Guide', content: '# New', folderId: MIXED_CASE_FOLDER_ID },
        ctx
      )
    ).resolves.toMatchObject({
      success: false,
      data: {
        candidates: [{ id: DOCUMENT_ID, folderId: CANONICAL_FOLDER_ID }],
      },
    });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('uses the same canonical values for an explicitly confirmed duplicate retry', async () => {
    listResolvedProjectDocuments.mockResolvedValue([
      documentSummary({ folder_id: CANONICAL_FOLDER_ID, folderName: 'Archive' }),
    ]);

    await expect(
      createDocumentTool.execute(
        {
          name: ' Guide ',
          content: '# New',
          folderId: MIXED_CASE_FOLDER_ID,
          allowDuplicate: true,
        },
        ctx
      )
    ).resolves.toMatchObject({ success: true, data: { name: 'Guide' } });
    expect(createDocument).toHaveBeenCalledWith(ctx.supabase, {
      projectId: PROJECT_ID,
      name: 'Guide',
      content: '# New',
      folderId: CANONICAL_FOLDER_ID,
    });
  });

  it('renames the current document when no selector is supplied', async () => {
    await expect(
      renameDocument.execute({ newName: 'Updated' }, ctx)
    ).resolves.toMatchObject({
      success: true,
      invalidations: [{ type: 'documents', projectId: PROJECT_ID, documentId: DOCUMENT_ID }],
      data: {
        documentId: DOCUMENT_ID,
        oldName: 'Guide',
        name: 'Updated',
        folderName: null,
      },
    });
    expect(resolveDocumentForTool).toHaveBeenCalledWith(
      ctx.supabase,
      PROJECT_ID,
      {},
      ctx
    );
    expect(updateDocumentName).toHaveBeenCalledWith(
      ctx.supabase,
      DOCUMENT_ID,
      'Updated'
    );
  });

  it('uses an explicit selector instead of the current document for rename', async () => {
    resolveDocumentForTool.mockResolvedValue({
      ok: true,
      source: 'name',
      document: documentSummary({
        id: OTHER_DOCUMENT_ID,
        name: 'Notes',
        folder_id: ARCHIVE_ID,
        folderName: 'Archive',
      }),
    });

    await renameDocument.execute(
      { documentName: 'Notes', folderName: 'Archive', newName: 'Ideas' },
      ctx
    );

    expect(resolveDocumentForTool).toHaveBeenCalledWith(
      ctx.supabase,
      PROJECT_ID,
      { documentName: 'Notes', folderName: 'Archive' },
      ctx
    );
    expect(updateDocumentName).toHaveBeenCalledWith(
      ctx.supabase,
      OTHER_DOCUMENT_ID,
      'Ideas'
    );
  });

  it('moves an explicitly selected document into a resolved folder', async () => {
    await expect(
      moveDocumentTool.execute(
        { documentName: 'Guide', folderName: 'Archive' },
        ctx
      )
    ).resolves.toMatchObject({
      success: true,
      invalidations: [{ type: 'documents', projectId: PROJECT_ID, documentId: DOCUMENT_ID }],
      data: {
        documentId: DOCUMENT_ID,
        name: 'Guide',
        folderId: ARCHIVE_ID,
        folderName: 'Archive',
      },
    });
    expect(resolveDocumentForTool).toHaveBeenCalledWith(
      ctx.supabase,
      PROJECT_ID,
      { documentName: 'Guide' },
      ctx
    );
    expect(findFolderByName).toHaveBeenCalledWith(
      ctx.supabase,
      PROJECT_ID,
      'Archive',
      ctx
    );
    expect(moveDocument).toHaveBeenCalledWith(ctx.supabase, DOCUMENT_ID, {
      folderId: ARCHIVE_ID,
    });
  });

  it('moves the current document to the project root', async () => {
    await expect(
      moveDocumentTool.execute({ moveToRoot: true }, ctx)
    ).resolves.toMatchObject({
      success: true,
      data: { documentId: DOCUMENT_ID, folderId: null, folderName: null },
    });
    expect(resolveDocumentForTool).toHaveBeenCalledWith(
      ctx.supabase,
      PROJECT_ID,
      {},
      ctx
    );
    expect(findFolderByName).not.toHaveBeenCalled();
    expect(moveDocument).toHaveBeenCalledWith(ctx.supabase, DOCUMENT_ID, {
      folderId: null,
    });
  });

  it.each([
    {},
    { moveToRoot: false },
    { folderName: 'Archive', moveToRoot: true },
    { documentName: 'Guide', folderName: 'Archive', unexpected: true },
  ])('rejects invalid move destinations before resolving: %p', async (params) => {
    await expect(moveDocumentTool.execute(params, ctx)).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/invalid parameters/i),
    });
    expect(resolveDocumentForTool).not.toHaveBeenCalled();
    expect(moveDocument).not.toHaveBeenCalled();
  });

  it('returns resolver ambiguity candidates without mutating metadata', async () => {
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
      moveDocumentTool.execute(
        { documentName: 'Guide', folderName: 'Archive' },
        ctx
      )
    ).resolves.toEqual({
      success: false,
      error: 'Multiple documents named "Guide" were found in this project.',
      data: { candidates },
    });
    expect(findFolderByName).not.toHaveBeenCalled();
    expect(moveDocument).not.toHaveBeenCalled();
  });

  it('registers both metadata tools', () => {
    expect(resolveTool('rename_document')).toBe(renameDocument);
    expect(resolveTool('move_document')).toBe(moveDocumentTool);
  });

  it('keeps create, rename, and move successful when background indexing fails', async () => {
    reindexProjectDocumentAsActor.mockRejectedValue(new Error('embedding unavailable'));
    const results = await Promise.all([
      createDocumentTool.execute({ name: 'New', content: '# New' }, ctx),
      renameDocument.execute({ newName: 'Renamed' }, ctx),
      moveDocumentTool.execute({ moveToRoot: true }, ctx),
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(results).toEqual([
      expect.objectContaining({ success: true }),
      expect.objectContaining({ success: true }),
      expect.objectContaining({ success: true }),
    ]);
    expect(reindexProjectDocumentAsActor).toHaveBeenCalledTimes(3);
  });
});
