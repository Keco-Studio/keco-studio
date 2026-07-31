/**
 * @jest-environment node
 */
import {
  insertResourceReference,
  serializeResourceReferenceSnippet,
} from '@/lib/agent/tools/insert-resource-reference';
import { allTools } from '@/lib/agent/tools';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('@/lib/agent/document-resolver', () => ({
  resolveDocumentForTool: jest.fn(),
}));
jest.mock('@/lib/documents/resourceReferenceService', () => ({
  listDocumentReferenceBlocks: jest.fn(),
  listTableReferenceRows: jest.fn(),
  resolveResourceReferences: jest.fn(),
}));
jest.mock('@/lib/agent/data-access', () => ({
  findLibraryByName: jest.fn(),
}));

import { resolveDocumentForTool } from '@/lib/agent/document-resolver';
import {
  listTableReferenceRows,
  resolveResourceReferences,
} from '@/lib/documents/resourceReferenceService';
import { findLibraryByName } from '@/lib/agent/data-access';
import { resourceReferenceKey } from '@/lib/documents/resourceReferenceTypes';

const resolveDocumentForToolMock = resolveDocumentForTool as jest.MockedFunction<
  typeof resolveDocumentForTool
>;
const listTableReferenceRowsMock = listTableReferenceRows as jest.MockedFunction<
  typeof listTableReferenceRows
>;
const resolveResourceReferencesMock = resolveResourceReferences as jest.MockedFunction<
  typeof resolveResourceReferences
>;
const findLibraryByNameMock = findLibraryByName as jest.MockedFunction<typeof findLibraryByName>;

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    supabase: {} as ToolContext['supabase'],
    userId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    userRole: 'editor',
    ...overrides,
  } as ToolContext;
}

describe('insert_resource_reference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is registered in allTools', () => {
    expect(allTools.some((tool) => tool.name === 'insert_resource_reference')).toBe(true);
  });

  it('serializes a sanctioned table-row ResourceReference chip', () => {
    const snippet = serializeResourceReferenceSnippet({
      kind: 'table-row',
      libraryId: '11111111-1111-4111-8111-111111111111',
      assetId: '22222222-2222-4222-8222-222222222222',
      displayFieldId: '33333333-3333-4333-8333-333333333333',
      fallbackLabel: 'Micro Vision',
    });
    expect(snippet).toBe(
      '<ResourceReference kind="table-row" libraryId="11111111-1111-4111-8111-111111111111" assetId="22222222-2222-4222-8222-222222222222" displayFieldId="33333333-3333-4333-8333-333333333333" fallbackLabel="Micro Vision" />'
    );
  });

  it('asks for row and display field when table reference is ambiguous', async () => {
    resolveDocumentForToolMock.mockResolvedValue({
      ok: true,
      source: 'id',
      document: {
        id: '44444444-4444-4444-8444-444444444444',
        project_id: '22222222-2222-4222-8222-222222222222',
        folder_id: null,
        name: 'Rainy Night Manor',
        created_at: '',
        updated_at: '2026-07-29T00:00:00.000Z',
        folderName: null,
      },
    });
    findLibraryByNameMock.mockResolvedValue({
      library: {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'table2',
        folder_id: null,
      },
      available: ['table2'],
    });
    listTableReferenceRowsMock.mockResolvedValue({
      fields: [{ id: '33333333-3333-4333-8333-333333333333', label: 'Work ID', orderIndex: 0 }],
      rows: [{ id: '7901d562-f309-4b15-8cdf-456f39b2a152', name: 'Micro Vision', values: {} }],
    });

    const preparation = await insertResourceReference.prepareConfirmation!(
      { kind: 'table-row', libraryName: 'table2' },
      makeCtx()
    );

    expect(preparation.success).toBe(false);
    if (preparation.success) throw new Error('expected failure');
    expect(preparation.error).toMatch(/rowIndex|assetId|displayField/i);
  });

  it('seals a table-row ResourceReference snippet for confirmation', async () => {
    resolveDocumentForToolMock.mockResolvedValue({
      ok: true,
      source: 'id',
      document: {
        id: '44444444-4444-4444-8444-444444444444',
        project_id: '22222222-2222-4222-8222-222222222222',
        folder_id: null,
        name: 'Rainy Night Manor',
        created_at: '',
        updated_at: '2026-07-29T00:00:00.000Z',
        folderName: null,
      },
    });
    findLibraryByNameMock.mockResolvedValue({
      library: {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'table2',
        folder_id: null,
      },
      available: ['table2'],
    });
    listTableReferenceRowsMock.mockResolvedValue({
      fields: [{ id: '33333333-3333-4333-8333-333333333333', label: 'Work ID', orderIndex: 0 }],
      rows: [
        {
          id: '7901d562-f309-4b15-8cdf-456f39b2a152',
          name: 'Micro Vision',
          values: { '33333333-3333-4333-8333-333333333333': '2026001571' },
        },
      ],
    });
    const target = {
      kind: 'table-row' as const,
      libraryId: '55555555-5555-4555-8555-555555555555',
      assetId: '7901d562-f309-4b15-8cdf-456f39b2a152',
      displayFieldId: '33333333-3333-4333-8333-333333333333',
      fallbackLabel: '2026001571',
    };
    resolveResourceReferencesMock.mockResolvedValue(
      new Map([
        [
          resourceReferenceKey(target),
          {
            key: resourceReferenceKey(target),
            status: 'available',
            label: '2026001571',
            href: '/project/lib',
          },
        ],
      ])
    );

    const preparation = await insertResourceReference.prepareConfirmation!(
      {
        kind: 'table-row',
        libraryName: 'table2',
        assetId: '7901d562-f309-4b15-8cdf-456f39b2a152',
        displayFieldName: 'Work ID',
      },
      makeCtx()
    );

    expect(preparation.success).toBe(true);
    if (!preparation.success) throw new Error('expected success');
    expect(preparation.args.snippet).toContain('<ResourceReference kind="table-row"');
    expect(preparation.args.snippet).toContain('7901d562-f309-4b15-8cdf-456f39b2a152');
    expect(preparation.preview).toMatchObject({
      type: 'insert_resource_reference',
      name: 'Rainy Night Manor',
      kind: 'table-row',
    });
  });
});
