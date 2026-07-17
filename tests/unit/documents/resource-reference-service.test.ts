import type { SupabaseClient } from '@supabase/supabase-js';
import { DocumentAccessError } from '@/lib/documents/documentStateTypes';

const readDocumentState = jest.fn();
const createHeadlessDocumentEditor = jest.fn();
const ensureDocumentReferenceBlocks = jest.fn();

jest.mock('@/lib/documents/documentStateGateway', () => ({
  documentStateGateway: { read: (...args: unknown[]) => readDocumentState(...args) },
}));

jest.mock('@/lib/documents/headlessDocumentNodes', () => ({
  createHeadlessDocumentEditor: (...args: unknown[]) =>
    createHeadlessDocumentEditor(...args),
}));

jest.mock('@/lib/documents/documentReferenceBlocks', () => ({
  ensureDocumentReferenceBlocks: (...args: unknown[]) =>
    ensureDocumentReferenceBlocks(...args),
}));

import {
  listDocumentReferenceBlocks,
  listDocumentReferenceSources,
  listTableReferenceRows,
  listTableReferenceSources,
  resolveResourceReferences,
} from '@/lib/documents/resourceReferenceService';
import type { ResourceReferenceTarget } from '@/lib/documents/resourceReferenceTypes';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const LIBRARY_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_LIBRARY_ID = '44444444-4444-4444-8444-444444444444';
const ASSET_ID = '55555555-5555-4555-8555-555555555555';
const FIELD_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_FIELD_ID = '77777777-7777-4777-8777-777777777777';
const DOCUMENT_ID = '88888888-8888-4888-8888-888888888888';
const BLOCK_ID = '99999999-9999-4999-8999-999999999999';

type QueryResult = {
  data: unknown[] | null;
  error: null | { message: string; code?: string };
};

function makeClient(
  rows: Partial<Record<string, unknown[]>> = {},
  errors: Partial<Record<string, QueryResult['error']>> = {}
): { client: SupabaseClient; calls: Array<[string, string, unknown?]> } {
  const calls: Array<[string, string, unknown?]> = [];
  const from = jest.fn((table: string) => {
    const builder = {
      select(columns: string) {
        calls.push([table, 'select', columns]);
        return builder;
      },
      in(column: string, values: readonly unknown[]) {
        calls.push([table, `in:${column}`, values]);
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push([table, `eq:${column}`, value]);
        return builder;
      },
      neq(column: string, value: unknown) {
        calls.push([table, `neq:${column}`, value]);
        return builder;
      },
      order(column: string, options: unknown) {
        calls.push([table, `order:${column}`, options]);
        return builder;
      },
      then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ) {
        return Promise.resolve({
          data: rows[table] ?? [],
          error: errors[table] ?? null,
        }).then(onfulfilled, onrejected);
      },
    };
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

function tableTarget(
  overrides: Partial<Extract<ResourceReferenceTarget, { kind: 'table-row' }>> = {}
): Extract<ResourceReferenceTarget, { kind: 'table-row' }> {
  return {
    kind: 'table-row',
    libraryId: LIBRARY_ID,
    assetId: ASSET_ID,
    displayFieldId: FIELD_ID,
    fallbackLabel: 'Old status',
    ...overrides,
  };
}

function documentTarget(
  overrides: Partial<Extract<ResourceReferenceTarget, { kind: 'document-block' }>> = {}
): Extract<ResourceReferenceTarget, { kind: 'document-block' }> {
  return {
    kind: 'document-block',
    documentId: DOCUMENT_ID,
    blockId: BLOCK_ID,
    blockType: 'paragraph',
    fallbackLabel: 'Old paragraph',
    ...overrides,
  };
}

const unavailable = (key: string) => ({
  key,
  status: 'unavailable',
  label: 'Reference unavailable',
});

describe('resolveResourceReferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('batch-resolves and deduplicates a current-project table target', async () => {
    const target = tableTarget();
    const { client, calls } = makeClient({
      libraries: [{ id: LIBRARY_ID, project_id: PROJECT_ID, name: 'Characters' }],
      library_assets: [{ id: ASSET_ID, library_id: LIBRARY_ID, name: 'Ada' }],
      library_field_definitions: [
        { id: FIELD_ID, library_id: LIBRARY_ID, label: 'Status', order_index: 2 },
      ],
      library_asset_values: [
        { asset_id: ASSET_ID, field_id: FIELD_ID, value_json: 'Active' },
      ],
    });

    const resolved = await resolveResourceReferences(client, PROJECT_ID, [target, target]);

    expect([...resolved.values()]).toEqual([
      {
        key: `table-row:${LIBRARY_ID}:${ASSET_ID}:${FIELD_ID}`,
        status: 'available',
        label: 'Active',
        contextLabel: 'Characters / Ada / Status',
        href: `/${PROJECT_ID}/${LIBRARY_ID}/${ASSET_ID}?field=${FIELD_ID}`,
      },
    ]);
    for (const table of [
      'libraries',
      'library_assets',
      'library_field_definitions',
      'library_asset_values',
    ]) {
      expect(calls.filter(([calledTable, operation]) =>
        calledTable === table && operation === 'select'
      )).toHaveLength(1);
    }
  });

  it('uses the existing empty-field label when the field has no value row', async () => {
    const target = tableTarget();
    const { client } = makeClient({
      libraries: [{ id: LIBRARY_ID, project_id: PROJECT_ID, name: 'Characters' }],
      library_assets: [{ id: ASSET_ID, library_id: LIBRARY_ID, name: 'Ada' }],
      library_field_definitions: [
        { id: FIELD_ID, library_id: LIBRARY_ID, label: 'Status', order_index: 2 },
      ],
      library_asset_values: [],
    });

    await expect(resolveResourceReferences(client, PROJECT_ID, [target])).resolves
      .toEqual(new Map([
        [
          `table-row:${LIBRARY_ID}:${ASSET_ID}:${FIELD_ID}`,
          {
            key: `table-row:${LIBRARY_ID}:${ASSET_ID}:${FIELD_ID}`,
            status: 'available',
            label: '(empty)',
            contextLabel: 'Characters / Ada / Status',
            href: `/${PROJECT_ID}/${LIBRARY_ID}/${ASSET_ID}?field=${FIELD_ID}`,
          },
        ],
      ]));
  });

  it('returns one unavailable shape for cross-project, mismatched, deleted, and hidden table targets', async () => {
    const crossProject = tableTarget();
    const mismatched = tableTarget({ displayFieldId: OTHER_FIELD_ID });
    const deleted = tableTarget({ assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const hidden = tableTarget({ libraryId: OTHER_LIBRARY_ID });
    const { client } = makeClient({
      libraries: [
        { id: LIBRARY_ID, project_id: OTHER_PROJECT_ID, name: 'Foreign' },
      ],
      library_assets: [
        { id: ASSET_ID, library_id: LIBRARY_ID, name: 'Ada' },
      ],
      library_field_definitions: [
        { id: FIELD_ID, library_id: LIBRARY_ID, label: 'Status', order_index: 2 },
        { id: OTHER_FIELD_ID, library_id: OTHER_LIBRARY_ID, label: 'Other', order_index: 3 },
      ],
      library_asset_values: [
        { asset_id: ASSET_ID, field_id: FIELD_ID, value_json: 'Active' },
      ],
    });

    const resolved = await resolveResourceReferences(client, PROJECT_ID, [
      crossProject,
      mismatched,
      deleted,
      hidden,
    ]);

    for (const target of [crossProject, mismatched, deleted, hidden]) {
      const key = target.kind === 'table-row'
        ? `table-row:${target.libraryId}:${target.assetId}:${target.displayFieldId}`
        : '';
      expect(resolved.get(key)).toEqual(unavailable(key));
    }
  });

  it('resolves each unique document once and uses current block text and heading context', async () => {
    const target = documentTarget();
    const { client } = makeClient({
      documents: [{ id: DOCUMENT_ID, project_id: PROJECT_ID, name: 'World outline' }],
    });
    const editor = {
      setMarkdown: jest.fn(async () => undefined),
      listReferenceBlocks: jest.fn(() => [
        {
          blockId: BLOCK_ID,
          blockType: 'paragraph',
          text: 'The city closes its gates.',
          nearestHeading: 'Conflict',
        },
      ]),
    };
    readDocumentState.mockResolvedValue({
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      markdown: '# Current authoritative markdown',
    });
    createHeadlessDocumentEditor.mockResolvedValue(editor);

    const resolved = await resolveResourceReferences(client, PROJECT_ID, [target, target]);

    expect(readDocumentState).toHaveBeenCalledTimes(1);
    expect(readDocumentState).toHaveBeenCalledWith(client, DOCUMENT_ID);
    expect(editor.setMarkdown).toHaveBeenCalledWith('# Current authoritative markdown');
    expect(resolved.get(`document-block:${DOCUMENT_ID}:${BLOCK_ID}`)).toEqual({
      key: `document-block:${DOCUMENT_ID}:${BLOCK_ID}`,
      status: 'available',
      label: 'The city closes its gates.',
      contextLabel: 'World outline / Conflict',
      href: `/${PROJECT_ID}/doc/${DOCUMENT_ID}#block-${BLOCK_ID}`,
    });
  });

  it('does not leak whether a document is hidden, cross-project, missing, or type-mismatched', async () => {
    const hidden = documentTarget();
    const crossProject = documentTarget({ documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const missing = documentTarget({ blockId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    const typeMismatch = documentTarget({ blockType: 'heading' });
    const { client } = makeClient({
      documents: [
        { id: DOCUMENT_ID, project_id: PROJECT_ID, name: 'World outline' },
        {
          id: crossProject.documentId,
          project_id: OTHER_PROJECT_ID,
          name: 'Foreign document',
        },
      ],
    });
    readDocumentState.mockImplementation(async (_client, documentId) => {
      if (documentId === DOCUMENT_ID) {
        throw new DocumentAccessError('RLS denied this document');
      }
      return {
        documentId,
        projectId: OTHER_PROJECT_ID,
        markdown: '# Foreign',
      };
    });

    const resolved = await resolveResourceReferences(client, PROJECT_ID, [
      hidden,
      crossProject,
      missing,
      typeMismatch,
    ]);

    for (const target of [hidden, crossProject, missing, typeMismatch]) {
      const key = `document-block:${target.documentId}:${target.blockId}`;
      expect(resolved.get(key)).toEqual(unavailable(key));
    }
  });

  it('propagates non-access document failures as transient resolver errors', async () => {
    const target = documentTarget();
    const { client } = makeClient({
      documents: [{ id: DOCUMENT_ID, project_id: PROJECT_ID, name: 'World outline' }],
    });
    readDocumentState.mockRejectedValue(new Error('network unavailable'));

    await expect(resolveResourceReferences(client, PROJECT_ID, [target]))
      .rejects.toThrow('network unavailable');
  });
});

describe('resource reference picker loaders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists current-project table sources', async () => {
    const { client, calls } = makeClient({
      libraries: [{ id: LIBRARY_ID, project_id: PROJECT_ID, name: 'Characters' }],
    });

    await expect(listTableReferenceSources(client, PROJECT_ID)).resolves.toEqual([
      { id: LIBRARY_ID, projectId: PROJECT_ID, name: 'Characters' },
    ]);
    expect(calls).toContainEqual(['libraries', 'eq:project_id', PROJECT_ID]);
  });

  it('returns ordered fields and row value records for a table', async () => {
    const secondAssetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const { client, calls } = makeClient({
      library_field_definitions: [
        { id: FIELD_ID, library_id: LIBRARY_ID, label: 'Status', order_index: 2 },
        { id: OTHER_FIELD_ID, library_id: LIBRARY_ID, label: 'Name', order_index: 1 },
      ],
      library_assets: [
        { id: ASSET_ID, library_id: LIBRARY_ID, name: 'Ada', row_index: 1 },
        { id: secondAssetId, library_id: LIBRARY_ID, name: 'Babbage', row_index: 2 },
      ],
      library_asset_values: [
        { asset_id: ASSET_ID, field_id: FIELD_ID, value_json: 'Active' },
        { asset_id: ASSET_ID, field_id: OTHER_FIELD_ID, value_json: 'Ada Lovelace' },
      ],
    });

    await expect(listTableReferenceRows(client, LIBRARY_ID)).resolves.toEqual({
      fields: [
        { id: OTHER_FIELD_ID, label: 'Name', orderIndex: 1 },
        { id: FIELD_ID, label: 'Status', orderIndex: 2 },
      ],
      rows: [
        {
          id: ASSET_ID,
          name: 'Ada',
          values: { [FIELD_ID]: 'Active', [OTHER_FIELD_ID]: 'Ada Lovelace' },
        },
        { id: secondAssetId, name: 'Babbage', values: {} },
      ],
    });
    expect(calls).toContainEqual(['library_assets', 'order:row_index', { ascending: true }]);
    expect(calls).toContainEqual([
      'library_field_definitions',
      'order:order_index',
      { ascending: true },
    ]);
  });

  it('lists document sources while excluding the open document', async () => {
    const otherDocumentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const { client, calls } = makeClient({
      documents: [
        { id: otherDocumentId, project_id: PROJECT_ID, name: 'Other document' },
      ],
    });

    await expect(
      listDocumentReferenceSources(client, PROJECT_ID, DOCUMENT_ID)
    ).resolves.toEqual([
      { id: otherDocumentId, projectId: PROJECT_ID, name: 'Other document' },
    ]);
    expect(calls).toContainEqual(['documents', 'neq:id', DOCUMENT_ID]);
  });

  it('loads durable document blocks and rejects a project mismatch', async () => {
    const { client } = makeClient();
    const blocks = [
      { blockId: BLOCK_ID, blockType: 'heading', text: 'Conflict', headingLevel: 2 },
    ];
    ensureDocumentReferenceBlocks.mockResolvedValue({ projectId: PROJECT_ID, blocks });

    await expect(
      listDocumentReferenceBlocks(client, PROJECT_ID, DOCUMENT_ID)
    ).resolves.toEqual(blocks);
    expect(ensureDocumentReferenceBlocks).toHaveBeenCalledWith(client, DOCUMENT_ID);

    ensureDocumentReferenceBlocks.mockResolvedValue({
      projectId: OTHER_PROJECT_ID,
      blocks,
    });
    await expect(
      listDocumentReferenceBlocks(client, PROJECT_ID, DOCUMENT_ID)
    ).rejects.toThrow('Document does not belong to the current project');
  });
});
