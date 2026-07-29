/**
 * @jest-environment node
 */
import { generateFromDocument } from '@/lib/agent/tools/generate-from-document';
import { allTools } from '@/lib/agent/tools';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('@/lib/agent/document-resolver', () => ({
  resolveDocumentForTool: jest.fn(),
}));
jest.mock('@/lib/server/documentExportSourceService', () => ({
  getDocumentExportSource: jest.fn(),
}));
jest.mock('@/lib/services/scriptConversionService', () => ({
  resolveStoryForImport: jest.fn(),
}));
jest.mock('@/lib/services/scriptImportService', () => ({
  importStoryDocument: jest.fn(),
}));

import { resolveDocumentForTool } from '@/lib/agent/document-resolver';
import { getDocumentExportSource } from '@/lib/server/documentExportSourceService';
import { resolveStoryForImport } from '@/lib/services/scriptConversionService';
import { importStoryDocument } from '@/lib/services/scriptImportService';

const resolveDocumentForToolMock = resolveDocumentForTool as jest.MockedFunction<
  typeof resolveDocumentForTool
>;
const getDocumentExportSourceMock = getDocumentExportSource as jest.MockedFunction<
  typeof getDocumentExportSource
>;
const resolveStoryForImportMock = resolveStoryForImport as jest.MockedFunction<
  typeof resolveStoryForImport
>;
const importStoryDocumentMock = importStoryDocument as jest.MockedFunction<
  typeof importStoryDocument
>;

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    supabase: {} as ToolContext['supabase'],
    userId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    userRole: 'admin',
    ...overrides,
  } as ToolContext;
}

describe('generate_from_document', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is registered in allTools', () => {
    expect(allTools.some((tool) => tool.name === 'generate_from_document')).toBe(true);
  });

  it('rejects unsupported exportType', async () => {
    const result = await generateFromDocument.execute(
      { documentId: '33333333-3333-4333-8333-333333333333', exportType: 'pdf' },
      makeCtx()
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exportType/i);
  });

  it('returns candidates when document name is ambiguous', async () => {
    resolveDocumentForToolMock.mockResolvedValue({
      ok: false,
      code: 'AMBIGUOUS',
      error: 'Multiple documents named "Story".',
      candidates: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Story',
          folderId: null,
          folderName: null,
          updatedAt: '2026-07-29T00:00:00.000Z',
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Story',
          folderId: null,
          folderName: null,
          updatedAt: '2026-07-29T00:00:00.000Z',
        },
      ],
    });

    const result = await generateFromDocument.execute(
      { documentName: 'Story', exportType: 'table' },
      makeCtx()
    );

    expect(result.success).toBe(false);
    expect(result.data).toEqual(
      expect.objectContaining({
        candidates: expect.any(Array),
      })
    );
  });

  it('fails for non-admin before import', async () => {
    resolveDocumentForToolMock.mockResolvedValue({
      ok: true,
      source: 'id',
      document: {
        id: '33333333-3333-4333-8333-333333333333',
        project_id: '22222222-2222-4222-8222-222222222222',
        folder_id: null,
        name: 'Story',
        created_at: '',
        updated_at: '2026-07-29T00:00:00.000Z',
        folderName: null,
      },
    });
    getDocumentExportSourceMock.mockRejectedValue(
      new Error('Only admin users can export project content')
    );

    const result = await generateFromDocument.execute(
      { documentId: '33333333-3333-4333-8333-333333333333', exportType: 'script' },
      makeCtx({ userRole: 'editor' })
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Only admin');
    expect(importStoryDocumentMock).not.toHaveBeenCalled();
  });

  it('imports a derived table library nested under the document', async () => {
    resolveDocumentForToolMock.mockResolvedValue({
      ok: true,
      source: 'id',
      document: {
        id: '33333333-3333-4333-8333-333333333333',
        project_id: '22222222-2222-4222-8222-222222222222',
        folder_id: '55555555-5555-4555-8555-555555555555',
        name: 'Story',
        created_at: '',
        updated_at: '2026-07-29T00:00:00.000Z',
        folderName: 'Acts',
      },
    });
    getDocumentExportSourceMock.mockResolvedValue({
      documentId: '33333333-3333-4333-8333-333333333333',
      documentName: 'Story',
      projectId: '22222222-2222-4222-8222-222222222222',
      folderId: '55555555-5555-4555-8555-555555555555',
      markdown: '# Chapter\n\nHello.',
      token: { epoch: 1, revision: 1 },
      snapshotToken: 'snap',
    });
    resolveStoryForImportMock.mockResolvedValue({
      document: { type: 'story', version: 1, scenes: [] } as never,
    });
    importStoryDocumentMock.mockResolvedValue({
      libraryId: '66666666-6666-4666-8666-666666666666',
      rowCount: 3,
      fieldCount: 5,
    });

    const result = await generateFromDocument.execute(
      { documentId: '33333333-3333-4333-8333-333333333333', exportType: 'table' },
      makeCtx()
    );

    expect(result.success).toBe(true);
    expect(importStoryDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        libraryName: 'Story Table',
        folderId: '55555555-5555-4555-8555-555555555555',
        documentSource: {
          sourceDocumentId: '33333333-3333-4333-8333-333333333333',
          exportType: 'table',
        },
      })
    );
    expect(result.invalidations).toEqual([
      {
        type: 'library',
        id: '66666666-6666-4666-8666-666666666666',
        projectId: '22222222-2222-4222-8222-222222222222',
        sourceDocumentId: '33333333-3333-4333-8333-333333333333',
      },
    ]);
  });
});
