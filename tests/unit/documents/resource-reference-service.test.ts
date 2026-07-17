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

function indexedUuid(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function applyFilters(
  rows: readonly unknown[],
  filters: ReadonlyArray<[string, string, unknown]>
): unknown[] {
  return rows.filter((rawRow) => {
    const row = rawRow as Record<string, unknown>;
    return filters.every(([operation, column, value]) => {
      if (operation === 'eq') return row[column] === value;
      if (operation === 'neq') return row[column] !== value;
      if (operation === 'in') return (value as readonly unknown[]).includes(row[column]);
      if (operation !== 'or') return true;
      const pairs = Array.from(
        String(value).matchAll(
          /and\(asset_id\.eq\.([^,]+),field_id\.eq\.([^)]+)\)/g
        )
      );
      return pairs.some(
        (match) => row.asset_id === match[1] && row.field_id === match[2]
      );
    });
  });
}

function makeClient(
  rows: Partial<Record<string, unknown[]>> = {},
  errors: Partial<Record<string, QueryResult['error']>> = {},
  rangeErrors: Partial<Record<string, Record<number, QueryResult['error']>>> = {}
): {
  client: SupabaseClient;
  calls: Array<[string, string, unknown?]>;
  queries: Array<{
    table: string;
    filters: Array<[string, string, unknown]>;
  }>;
} {
  const calls: Array<[string, string, unknown?]> = [];
  const queries: Array<{
    table: string;
    filters: Array<[string, string, unknown]>;
  }> = [];
  const from = jest.fn((table: string) => {
    const query = { table, filters: [] as Array<[string, string, unknown]> };
    queries.push(query);
    const builder = {
      select(columns: string) {
        calls.push([table, 'select', columns]);
        return builder;
      },
      in(column: string, values: readonly unknown[]) {
        calls.push([table, `in:${column}`, values]);
        query.filters.push(['in', column, values]);
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push([table, `eq:${column}`, value]);
        query.filters.push(['eq', column, value]);
        return builder;
      },
      neq(column: string, value: unknown) {
        calls.push([table, `neq:${column}`, value]);
        query.filters.push(['neq', column, value]);
        return builder;
      },
      or(filter: string) {
        calls.push([table, 'or', filter]);
        query.filters.push(['or', '', filter]);
        return builder;
      },
      order(column: string, options: unknown) {
        calls.push([table, `order:${column}`, options]);
        return builder;
      },
      range(from: number, to: number) {
        calls.push([table, 'range', { from, to }]);
        const filtered = applyFilters(rows[table] ?? [], query.filters);
        return Promise.resolve({
          data: filtered.slice(from, to + 1),
          error: rangeErrors[table]?.[from] ?? errors[table] ?? null,
        });
      },
      then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ) {
        const filtered = applyFilters(rows[table] ?? [], query.filters);
        return Promise.resolve({
          data: filtered.slice(0, 1_000),
          error: errors[table] ?? null,
        }).then(onfulfilled, onrejected);
      },
    };
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls, queries };
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

  it('queries only exact requested table value pairs', async () => {
    const otherAssetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const targets = [
      tableTarget(),
      tableTarget({ assetId: otherAssetId, displayFieldId: OTHER_FIELD_ID }),
    ];
    const { client, queries } = makeClient({
      libraries: [{ id: LIBRARY_ID, project_id: PROJECT_ID, name: 'Characters' }],
      library_assets: [
        { id: ASSET_ID, library_id: LIBRARY_ID, name: 'Ada' },
        { id: otherAssetId, library_id: LIBRARY_ID, name: 'Grace' },
      ],
      library_field_definitions: [
        { id: FIELD_ID, library_id: LIBRARY_ID, label: 'Status', order_index: 1 },
        { id: OTHER_FIELD_ID, library_id: LIBRARY_ID, label: 'Role', order_index: 2 },
      ],
      library_asset_values: [
        { asset_id: ASSET_ID, field_id: FIELD_ID, value_json: 'Active' },
        { asset_id: otherAssetId, field_id: OTHER_FIELD_ID, value_json: 'Admiral' },
      ],
    });

    await resolveResourceReferences(client, PROJECT_ID, targets);

    const valueQueries = queries.filter(
      (query) => query.table === 'library_asset_values'
    );
    expect(valueQueries).toHaveLength(1);
    expect(valueQueries[0]?.filters).toContainEqual([
      'or',
      '',
      `and(asset_id.eq.${ASSET_ID},field_id.eq.${FIELD_ID}),` +
        `and(asset_id.eq.${otherAssetId},field_id.eq.${OTHER_FIELD_ID})`,
    ]);
  });

  it('batches more than 100 exact value pairs without one query per field', async () => {
    const fixtures = Array.from({ length: 101 }, (_, index) => {
      const libraryId = indexedUuid('10000000', index);
      const assetId = indexedUuid('20000000', index);
      const fieldId = indexedUuid('30000000', index);
      return {
        target: tableTarget({ libraryId, assetId, displayFieldId: fieldId }),
        library: { id: libraryId, project_id: PROJECT_ID, name: `Library ${index}` },
        asset: { id: assetId, library_id: libraryId, name: `Asset ${index}` },
        field: {
          id: fieldId,
          library_id: libraryId,
          label: `Field ${index}`,
          order_index: index,
        },
        value: { asset_id: assetId, field_id: fieldId, value_json: `Value ${index}` },
      };
    });
    const { client, calls, queries } = makeClient({
      libraries: fixtures.map((fixture) => fixture.library),
      library_assets: fixtures.map((fixture) => fixture.asset),
      library_field_definitions: fixtures.map((fixture) => fixture.field),
      library_asset_values: fixtures.map((fixture) => fixture.value),
    });

    const resolved = await resolveResourceReferences(
      client,
      PROJECT_ID,
      fixtures.map((fixture) => fixture.target)
    );

    expect(resolved.size).toBe(101);
    expect([...resolved.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'available', label: 'Value 100' }),
      ])
    );
    const valueQueries = queries.filter(
      (query) => query.table === 'library_asset_values'
    );
    expect(valueQueries).toHaveLength(2);
    expect(valueQueries.map((query) => {
      const filter = query.filters.find(([operation]) => operation === 'or')?.[2];
      return Array.from(String(filter).matchAll(/and\(/g)).length;
    })).toEqual([100, 1]);
    for (const table of [
      'libraries',
      'library_assets',
      'library_field_definitions',
      'library_asset_values',
    ]) {
      expect(calls.filter(([calledTable, operation]) =>
        calledTable === table && operation === 'range'
      )).toEqual([
        [table, 'range', { from: 0, to: 999 }],
        [table, 'range', { from: 0, to: 999 }],
      ]);
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

  it.each([
    ['paragraph first', ['paragraph', 'heading']],
    ['heading first', ['heading', 'paragraph']],
  ] as const)(
    'keeps a conflicting document block type unavailable regardless of order: %s',
    async (_label, blockTypes) => {
      const targets = blockTypes.map((blockType) => documentTarget({ blockType }));
      const { client } = makeClient({
        documents: [{ id: DOCUMENT_ID, project_id: PROJECT_ID, name: 'World outline' }],
      });
      readDocumentState.mockResolvedValue({
        documentId: DOCUMENT_ID,
        projectId: PROJECT_ID,
        markdown: '# Current authoritative markdown',
      });
      createHeadlessDocumentEditor.mockResolvedValue({
        setMarkdown: jest.fn(async () => undefined),
        listReferenceBlocks: jest.fn(() => [{
          blockId: BLOCK_ID,
          blockType: 'paragraph',
          text: 'Current paragraph',
        }]),
      });
      const key = `document-block:${DOCUMENT_ID}:${BLOCK_ID}`;

      await expect(resolveResourceReferences(client, PROJECT_ID, targets))
        .resolves.toEqual(new Map([[key, unavailable(key)]]));
    }
  );

  it('deduplicates fallback-only target differences without making the reference unavailable', async () => {
    const { client } = makeClient({
      documents: [{ id: DOCUMENT_ID, project_id: PROJECT_ID, name: 'World outline' }],
    });
    readDocumentState.mockResolvedValue({
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      markdown: '# Current authoritative markdown',
    });
    createHeadlessDocumentEditor.mockResolvedValue({
      setMarkdown: jest.fn(async () => undefined),
      listReferenceBlocks: jest.fn(() => [{
        blockId: BLOCK_ID,
        blockType: 'paragraph',
        text: 'Current paragraph',
      }]),
    });

    const resolved = await resolveResourceReferences(client, PROJECT_ID, [
      documentTarget({ fallbackLabel: 'Old fallback' }),
      documentTarget({ fallbackLabel: 'New fallback' }),
    ]);

    expect(resolved.get(`document-block:${DOCUMENT_ID}:${BLOCK_ID}`))
      .toMatchObject({ status: 'available', label: 'Current paragraph' });
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

  it('returns table and document picker sources beyond the default page cap', async () => {
    const { client, calls } = makeClient({
      libraries: Array.from({ length: 1_001 }, (_, index) => ({
        id: indexedUuid('40000000', index),
        project_id: PROJECT_ID,
        name: `Library ${index}`,
      })),
      documents: Array.from({ length: 1_001 }, (_, index) => ({
        id: indexedUuid('50000000', index),
        project_id: PROJECT_ID,
        name: `Document ${index}`,
      })),
    });

    await expect(listTableReferenceSources(client, PROJECT_ID))
      .resolves.toHaveLength(1_001);
    await expect(listDocumentReferenceSources(client, PROJECT_ID, OTHER_PROJECT_ID))
      .resolves.toHaveLength(1_001);
    expect(calls.filter(([, operation]) => operation === 'range')).toEqual([
      ['libraries', 'range', { from: 0, to: 999 }],
      ['libraries', 'range', { from: 1000, to: 1999 }],
      ['documents', 'range', { from: 0, to: 999 }],
      ['documents', 'range', { from: 1000, to: 1999 }],
    ]);
  });

  it('propagates an error from the second picker source page', async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => ({
      id: indexedUuid('40000000', index),
      project_id: PROJECT_ID,
      name: `Library ${index}`,
    }));
    const { client } = makeClient(
      { libraries: rows },
      {},
      { libraries: { 1_000: { message: 'page two failed' } } }
    );

    await expect(listTableReferenceSources(client, PROJECT_ID))
      .rejects.toEqual({ message: 'page two failed' });
  });

  it('returns ordered fields and row value records for a table', async () => {
    const secondAssetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const { client, calls } = makeClient({
      libraries: [{ id: LIBRARY_ID, project_id: PROJECT_ID, name: 'Characters' }],
      library_field_definitions: [
        { id: FIELD_ID, library_id: LIBRARY_ID, label: 'Status', order_index: 2 },
        { id: OTHER_FIELD_ID, library_id: LIBRARY_ID, label: 'Name', order_index: 1 },
      ],
      library_assets: [
        {
          id: ASSET_ID,
          library_id: LIBRARY_ID,
          name: 'Ada',
          row_index: 1,
          created_at: '2026-07-17T02:00:00.000Z',
        },
        {
          id: secondAssetId,
          library_id: LIBRARY_ID,
          name: 'Babbage',
          row_index: 1,
          created_at: '2026-07-17T01:00:00.000Z',
        },
      ],
      library_asset_values: [
        { asset_id: ASSET_ID, field_id: FIELD_ID, value_json: 'Active' },
        { asset_id: ASSET_ID, field_id: OTHER_FIELD_ID, value_json: 'Ada Lovelace' },
      ],
    });

    await expect(
      listTableReferenceRows(client, PROJECT_ID, LIBRARY_ID)
    ).resolves.toEqual({
      fields: [
        { id: OTHER_FIELD_ID, label: 'Name', orderIndex: 1 },
        { id: FIELD_ID, label: 'Status', orderIndex: 2 },
      ],
      rows: [
        { id: secondAssetId, name: 'Babbage', values: {} },
        {
          id: ASSET_ID,
          name: 'Ada',
          values: { [FIELD_ID]: 'Active', [OTHER_FIELD_ID]: 'Ada Lovelace' },
        },
      ],
    });
    expect(calls).toContainEqual(['library_assets', 'order:row_index', { ascending: true }]);
    expect(calls).toContainEqual([
      'library_assets',
      'order:created_at',
      { ascending: true },
    ]);
    expect(calls).toContainEqual([
      'library_field_definitions',
      'order:order_index',
      { ascending: true },
    ]);
  });

  it('orders rows without row indexes by created time and then id', async () => {
    const earlierAssetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const { client } = makeClient({
      libraries: [{ id: LIBRARY_ID, project_id: PROJECT_ID, name: 'Characters' }],
      library_field_definitions: [],
      library_assets: [
        {
          id: ASSET_ID,
          library_id: LIBRARY_ID,
          name: 'Later',
          row_index: null,
          created_at: '2026-07-17T02:00:00.000Z',
        },
        {
          id: earlierAssetId,
          library_id: LIBRARY_ID,
          name: 'Earlier',
          row_index: null,
          created_at: '2026-07-17T01:00:00.000Z',
        },
      ],
      library_asset_values: [],
    });

    const result = await listTableReferenceRows(client, PROJECT_ID, LIBRARY_ID);

    expect(result.rows.map((row) => row.id)).toEqual([earlierAssetId, ASSET_ID]);
  });

  it('returns table fields, rows, and values beyond the default page cap', async () => {
    const assets = Array.from({ length: 1_001 }, (_, index) => ({
      id: indexedUuid('60000000', index),
      library_id: LIBRARY_ID,
      name: `Asset ${index}`,
      row_index: index,
      created_at: '2026-07-17T01:00:00.000Z',
    }));
    const fields = Array.from({ length: 1_001 }, (_, index) => ({
      id: indexedUuid('70000000', index),
      library_id: LIBRARY_ID,
      label: `Field ${index}`,
      order_index: index,
    }));
    const values = assets.map((asset, index) => ({
      asset_id: asset.id,
      field_id: fields[index]!.id,
      value_json: `Value ${index}`,
    }));
    const { client, calls } = makeClient({
      libraries: [{ id: LIBRARY_ID, project_id: PROJECT_ID, name: 'Characters' }],
      library_field_definitions: fields,
      library_assets: assets,
      library_asset_values: values,
    });

    const result = await listTableReferenceRows(client, PROJECT_ID, LIBRARY_ID);

    expect(result.fields).toHaveLength(1_001);
    expect(result.rows).toHaveLength(1_001);
    expect(result.rows.at(-1)).toEqual({
      id: assets.at(-1)!.id,
      name: 'Asset 1000',
      values: { [fields.at(-1)!.id]: 'Value 1000' },
    });
    for (const table of ['library_field_definitions', 'library_assets']) {
      expect(calls.filter(([calledTable, operation]) =>
        calledTable === table && operation === 'range'
      )).toEqual([
        [table, 'range', { from: 0, to: 999 }],
        [table, 'range', { from: 1000, to: 1999 }],
      ]);
    }
    expect(calls.filter(([table, operation]) =>
      table === 'library_asset_values' && operation === 'range'
    )).toHaveLength(11);
  });

  it('rejects a cross-project table before loading its rows or values', async () => {
    const { client, calls } = makeClient({
      libraries: [{ id: LIBRARY_ID, project_id: OTHER_PROJECT_ID, name: 'Foreign' }],
    });

    await expect(listTableReferenceRows(client, PROJECT_ID, LIBRARY_ID))
      .rejects.toThrow('Library does not belong to the current project');
    expect(calls.some(([table]) => table === 'library_assets')).toBe(false);
    expect(calls.some(([table]) => table === 'library_field_definitions')).toBe(false);
    expect(calls.some(([table]) => table === 'library_asset_values')).toBe(false);
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

  it('loads durable document blocks only after validating current-project metadata', async () => {
    const { client } = makeClient({
      documents: [{ id: DOCUMENT_ID, project_id: PROJECT_ID, name: 'Outline' }],
    });
    const blocks = [
      { blockId: BLOCK_ID, blockType: 'heading', text: 'Conflict', headingLevel: 2 },
    ];
    ensureDocumentReferenceBlocks.mockResolvedValue({ projectId: PROJECT_ID, blocks });

    await expect(
      listDocumentReferenceBlocks(client, PROJECT_ID, DOCUMENT_ID)
    ).resolves.toEqual(blocks);
    expect(ensureDocumentReferenceBlocks).toHaveBeenCalledWith(client, DOCUMENT_ID);

    const mismatch = makeClient({
      documents: [{ id: DOCUMENT_ID, project_id: OTHER_PROJECT_ID, name: 'Foreign' }],
    });
    ensureDocumentReferenceBlocks.mockClear();
    await expect(
      listDocumentReferenceBlocks(mismatch.client, PROJECT_ID, DOCUMENT_ID)
    ).rejects.toThrow('Document does not belong to the current project');
    expect(ensureDocumentReferenceBlocks).not.toHaveBeenCalled();
  });
});
