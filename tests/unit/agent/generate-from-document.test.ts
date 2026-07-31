/**
 * @jest-environment node
 */
import {
  generateFromDocument,
  toolResultFromClientCompletion,
} from '@/lib/agent/tools/generate-from-document';
import { allTools } from '@/lib/agent/tools';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('@/lib/agent/document-resolver', () => ({
  resolveDocumentForTool: jest.fn(),
}));
jest.mock('@/lib/server/documentExportSourceService', () => ({
  getDocumentExportSource: jest.fn(),
}));

import { resolveDocumentForTool } from '@/lib/agent/document-resolver';
import { getDocumentExportSource } from '@/lib/server/documentExportSourceService';

const resolveDocumentForToolMock = resolveDocumentForTool as jest.MockedFunction<
  typeof resolveDocumentForTool
>;
const getDocumentExportSourceMock = getDocumentExportSource as jest.MockedFunction<
  typeof getDocumentExportSource
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

  it('always suspends for client handoff (Auto UI auto-approves without a confirm card)', () => {
    expect(generateFromDocument.confirmationPolicy).toBe('always');
    expect(generateFromDocument.requiredPermission).toBe('admin');
  });

  it('rejects unsupported exportType', async () => {
    const result = await generateFromDocument.execute(
      { documentId: '33333333-3333-4333-8333-333333333333', exportType: 'pdf' },
      makeCtx()
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exportType/i);
  });

  it('does not run Story IR in execute (client handoff required)', async () => {
    const result = await generateFromDocument.execute(
      { documentId: '33333333-3333-4333-8333-333333333333', exportType: 'script' },
      makeCtx()
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/document derived import handoff/i);
  });

  it('prepareConfirmation fails for non-admin before asking the user', async () => {
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

    const preparation = await generateFromDocument.prepareConfirmation!(
      { documentId: '33333333-3333-4333-8333-333333333333', exportType: 'script' },
      makeCtx({ userRole: 'editor' })
    );

    expect(preparation.success).toBe(false);
    if (preparation.success) throw new Error('expected failure');
    expect(preparation.error).toContain('Only admin');
  });

  it('prepareConfirmation seals documentId and exportType for matching RMB path', async () => {
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

    const preparation = await generateFromDocument.prepareConfirmation!(
      { documentId: '33333333-3333-4333-8333-333333333333', exportType: 'table' },
      makeCtx()
    );

    expect(preparation.success).toBe(true);
    if (!preparation.success) throw new Error('expected success');
    expect(preparation.args).toEqual({
      documentId: '33333333-3333-4333-8333-333333333333',
      exportType: 'table',
    });
  });

  it('builds tool result from clientCompletedResult matching sealed args', () => {
    const result = toolResultFromClientCompletion(
      {
        documentId: '33333333-3333-4333-8333-333333333333',
        exportType: 'script',
      },
      {
        libraryId: '66666666-6666-4666-8666-666666666666',
        libraryName: 'Story Conversation',
        exportType: 'script',
        sourceDocumentId: '33333333-3333-4333-8333-333333333333',
        documentName: 'Story',
        projectId: '22222222-2222-4222-8222-222222222222',
        rowCount: 4,
        fieldCount: 6,
      },
      '22222222-2222-4222-8222-222222222222'
    );

    expect(result.success).toBe(true);
    expect(result.invalidations).toEqual([
      {
        type: 'library',
        id: '66666666-6666-4666-8666-666666666666',
        projectId: '22222222-2222-4222-8222-222222222222',
        sourceDocumentId: '33333333-3333-4333-8333-333333333333',
      },
    ]);
  });

  it('rejects mismatched clientCompletedResult document', () => {
    const result = toolResultFromClientCompletion(
      {
        documentId: '33333333-3333-4333-8333-333333333333',
        exportType: 'table',
      },
      {
        libraryId: '66666666-6666-4666-8666-666666666666',
        libraryName: 'Other Table',
        exportType: 'table',
        sourceDocumentId: '44444444-4444-4444-8444-444444444444',
        documentName: 'Other',
        projectId: '22222222-2222-4222-8222-222222222222',
      },
      '22222222-2222-4222-8222-222222222222'
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not match/i);
  });
});
