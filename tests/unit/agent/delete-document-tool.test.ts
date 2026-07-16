import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

const resolveDocumentForTool = jest.fn();
const deleteDocument = jest.fn();

jest.mock('@/lib/agent/document-resolver', () => ({ resolveDocumentForTool }));
jest.mock('@/lib/services/documentService', () => ({ deleteDocument }));

import { deleteDocumentTool } from '@/lib/agent/tools/delete-document';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_PROJECT_ID = '55555555-5555-4555-8555-555555555555';
const UPDATED_AT = '2026-07-15T00:00:00.000Z';

const ctx = {
  projectId: PROJECT_ID,
  userId: '33333333-3333-4333-8333-333333333333',
  conversationId: '44444444-4444-4444-8444-444444444444',
  userRole: 'editor',
  supabase: {} as SupabaseClient,
  currentDocumentId: DOCUMENT_ID,
} satisfies ToolContext;

function resolvedDocument(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    source: 'id',
    document: {
      id: DOCUMENT_ID,
      project_id: PROJECT_ID,
      folder_id: '66666666-6666-4666-8666-666666666666',
      folderName: 'Lore',
      name: 'Guide',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: UPDATED_AT,
      ...overrides,
    },
  };
}

const preview = {
  type: 'document_delete' as const,
  documentId: DOCUMENT_ID,
  projectId: PROJECT_ID,
  name: 'Guide',
  folderName: 'Lore',
  updatedAt: UPDATED_AT,
};

describe('delete_document tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveDocumentForTool.mockResolvedValue(resolvedDocument());
    deleteDocument.mockResolvedValue(undefined);
  });

  it('declares mandatory post-preview confirmation and a closed selector schema', () => {
    expect(deleteDocumentTool).toMatchObject({
      name: 'delete_document',
      category: 'write',
      confirmationMode: 'post_preview',
      confirmationPolicy: 'always',
      requiredPermission: 'editor',
    });
    expect(deleteDocumentTool.parameters).toMatchObject({
      additionalProperties: false,
      anyOf: [
        { not: { required: ['folderName'] } },
        { required: ['documentId'] },
        { required: ['documentName'] },
      ],
    });
  });

  it('rejects unknown parameters and a folder-only selector', async () => {
    await expect(
      deleteDocumentTool.execute({ documentId: DOCUMENT_ID, unexpected: true }, ctx)
    ).resolves.toMatchObject({ success: false });
    await expect(
      deleteDocumentTool.execute({ folderName: 'Lore' }, ctx)
    ).resolves.toMatchObject({ success: false });
    expect(resolveDocumentForTool).not.toHaveBeenCalled();
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('resolves once and returns an exact saved preview without mutating', async () => {
    await expect(
      deleteDocumentTool.execute({ documentName: 'Guide', folderName: 'Lore' }, ctx)
    ).resolves.toEqual({
      success: true,
      displayHint: 'text',
      data: preview,
      internalData: preview,
    });
    expect(resolveDocumentForTool).toHaveBeenCalledWith(
      ctx.supabase,
      PROJECT_ID,
      { documentName: 'Guide', folderName: 'Lore' },
      ctx
    );
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it.each([
    [
      'ambiguous target',
      {
        ok: false,
        code: 'AMBIGUOUS',
        error: 'Multiple documents named "Guide" were found in this project.',
        candidates: [{ id: DOCUMENT_ID, name: 'Guide', folderName: 'Lore' }],
      },
    ],
    [
      'missing target',
      {
        ok: false,
        code: 'NO_TARGET',
        error: 'No document was specified and there is no current document.',
      },
    ],
  ])('returns %s safely during preview', async (_label, resolution) => {
    resolveDocumentForTool.mockResolvedValue(resolution);
    const result = await deleteDocumentTool.execute({}, ctx);
    expect(result).toMatchObject({ success: false, error: resolution.error });
    if ('candidates' in resolution) {
      expect(result).toMatchObject({ data: { candidates: resolution.candidates } });
    }
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('deletes only the saved stable ID after re-resolving it in the same project', async () => {
    const result = await deleteDocumentTool.executeImport!(
      { success: true, data: preview, internalData: preview },
      { documentName: 'Guide', folderName: 'Lore' },
      ctx
    );
    expect(resolveDocumentForTool).toHaveBeenCalledWith(
      ctx.supabase,
      PROJECT_ID,
      { documentId: DOCUMENT_ID },
      ctx
    );
    expect(deleteDocument).toHaveBeenCalledWith(ctx.supabase, DOCUMENT_ID);
    expect(result).toEqual({ success: true, displayHint: 'text', data: preview });
  });

  it('rejects approval when the saved document was renamed', async () => {
    resolveDocumentForTool.mockResolvedValue(resolvedDocument({ name: 'Renamed Guide' }));
    await expect(
      deleteDocumentTool.executeImport!(
        { success: true, data: preview, internalData: preview },
        { documentName: 'Guide' },
        ctx
      )
    ).resolves.toMatchObject({ success: false, error: expect.stringContaining('changed') });
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('rejects approval when the saved ID resolves outside the project', async () => {
    resolveDocumentForTool.mockResolvedValue(resolvedDocument({ project_id: OTHER_PROJECT_ID }));
    await expect(
      deleteDocumentTool.executeImport!(
        { success: true, data: preview, internalData: preview },
        { documentId: DOCUMENT_ID },
        ctx
      )
    ).resolves.toMatchObject({ success: false, error: expect.stringContaining('project') });
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('fails safely when the saved ID no longer exists or private preview is missing', async () => {
    resolveDocumentForTool.mockResolvedValue({
      ok: false,
      code: 'NOT_FOUND',
      error: `Document "${DOCUMENT_ID}" was not found in this project.`,
    });
    await expect(
      deleteDocumentTool.executeImport!(
        { success: true, data: preview, internalData: preview },
        { documentId: DOCUMENT_ID },
        ctx
      )
    ).resolves.toMatchObject({ success: false });
    await expect(
      deleteDocumentTool.executeImport!({ success: true, data: preview }, {}, ctx)
    ).resolves.toMatchObject({ success: false });
    expect(deleteDocument).not.toHaveBeenCalled();
  });
});
