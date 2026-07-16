import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

const getLibraryProperties = jest.fn();
const listProjectFolders = jest.fn();
const listResolvedProjectDocuments = jest.fn();

jest.mock('@/lib/agent/data-access', () => ({
  getLibraryProperties,
  listProjectFolders,
}));
jest.mock('@/lib/agent/document-resolver', () => ({ listResolvedProjectDocuments }));

import { listDocumentsTool } from '@/lib/agent/tools/list-documents';
import { listProjectStructure } from '@/lib/agent/tools/list-project-structure';
import { resolveTool } from '@/lib/agent/tools';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const FOLDER_ID = '22222222-2222-4222-8222-222222222222';

const documents = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    project_id: PROJECT_ID,
    folder_id: FOLDER_ID,
    name: 'World Guide',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-10T00:00:00.000Z',
    folderName: 'Lore',
    content: 'SECRET BODY MUST NEVER LEAK',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    project_id: PROJECT_ID,
    folder_id: FOLDER_ID,
    name: 'World Notes',
    created_at: '2026-07-02T00:00:00.000Z',
    updated_at: '2026-07-11T00:00:00.000Z',
    folderName: 'Lore',
    content: 'ANOTHER SECRET BODY',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    project_id: PROJECT_ID,
    folder_id: null,
    name: 'Production',
    created_at: '2026-07-03T00:00:00.000Z',
    updated_at: '2026-07-12T00:00:00.000Z',
    folderName: null,
    content: 'ROOT SECRET BODY',
  },
];

function context(): ToolContext {
  const order = jest.fn().mockResolvedValue({ data: [], error: null });
  const eq = jest.fn().mockReturnValue({ order });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });

  return {
    projectId: PROJECT_ID,
    userId: '66666666-6666-4666-8666-666666666666',
    conversationId: '77777777-7777-4777-8777-777777777777',
    userRole: 'viewer',
    supabase: { from } as unknown as SupabaseClient,
  };
}

describe('Agent document discovery tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listProjectFolders.mockResolvedValue([{ id: FOLDER_ID, name: 'Lore' }]);
    listResolvedProjectDocuments.mockResolvedValue(documents);
    getLibraryProperties.mockResolvedValue([]);
  });

  it('adds lightweight document summaries to list_project_structure without content', async () => {
    expect(listProjectStructure.description).toContain('documents');
    const result = await listProjectStructure.execute({}, context());

    expect(result).toMatchObject({
      success: true,
      data: {
        documentCount: 3,
        documents: [
          {
            id: documents[0].id,
            name: 'World Guide',
            folderId: FOLDER_ID,
            folderName: 'Lore',
            createdAt: documents[0].created_at,
            updatedAt: documents[0].updated_at,
          },
          expect.any(Object),
          expect.any(Object),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('SECRET BODY');
    expect(listResolvedProjectDocuments).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID
    );
  });

  it('bounds document summaries for large projects with explicit pagination guidance', async () => {
    const manyDocuments = Array.from({ length: 1_000 }, (_, index) => ({
      ...documents[0],
      id: `${String(index).padStart(8, '0')}-3333-4333-8333-333333333333`,
      name: `Document ${String(index).padStart(4, '0')}`,
    }));
    listResolvedProjectDocuments.mockResolvedValue(manyDocuments);

    const result = await listProjectStructure.execute({}, context());
    const data = result.data as {
      documentCount: number;
      documents: unknown[];
      documentResultMetadata: Record<string, unknown>;
    };

    expect(data.documentCount).toBe(1_000);
    expect(data.documents).toHaveLength(50);
    expect(data.documentResultMetadata).toEqual({
      totalProjectDocumentCount: 1_000,
      returnedDocumentCount: 50,
      limit: 50,
      isLimited: true,
      isTruncated: true,
      nextTool: 'list_documents',
      guidance: expect.stringContaining('list_documents'),
    });
    expect(JSON.stringify(result).length).toBeLessThan(20_000);
    expect(() => JSON.parse(JSON.stringify(result))).not.toThrow();
  });

  it('filters list_documents metadata and explicitly reports a limited partial result', async () => {
    const result = await listDocumentsTool.execute(
      { nameQuery: 'WORLD', folderName: 'Lore', limit: 1 },
      context()
    );

    expect(result).toEqual({
      success: true,
      displayHint: 'list',
      data: {
        documentCount: 1,
        documents: [
          {
            id: documents[0].id,
            name: 'World Guide',
            folderId: FOLDER_ID,
            folderName: 'Lore',
            createdAt: documents[0].created_at,
            updatedAt: documents[0].updated_at,
          },
        ],
        resultMetadata: {
          totalProjectDocumentCount: 3,
          matchedDocumentCount: 2,
          returnedDocumentCount: 1,
          nameMatch: 'case-insensitive substring',
          folderMatch: 'exact',
          limit: 1,
          offset: 0,
          nextOffset: 1,
          isLimited: true,
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('SECRET BODY');
  });

  it('paginates list_documents so structure truncation guidance is actionable', async () => {
    const result = await listDocumentsTool.execute(
      { limit: 1, offset: 1 },
      context()
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        documentCount: 1,
        documents: [{ id: documents[1].id }],
        resultMetadata: {
          totalProjectDocumentCount: 3,
          matchedDocumentCount: 3,
          returnedDocumentCount: 1,
          offset: 1,
          nextOffset: 2,
          isLimited: true,
        },
      },
    });
  });

  it('declares closed JSON schemas and rejects unknown list parameters at runtime', async () => {
    expect(listDocumentsTool.parameters).toMatchObject({ additionalProperties: false });
    expect(listProjectStructure.parameters).toMatchObject({ additionalProperties: false });

    await expect(
      listDocumentsTool.execute({ unexpected: true }, context())
    ).resolves.toMatchObject({ success: false });
    expect(listResolvedProjectDocuments).not.toHaveBeenCalled();
  });

  it('registers list_documents for agent tool resolution', () => {
    expect(resolveTool('list_documents')).toBe(listDocumentsTool);
  });
});
