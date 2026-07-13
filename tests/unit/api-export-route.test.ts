import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/export/route';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/createSupabaseServerClient', () => ({
  createSupabaseServerClient: jest.fn(),
}));

jest.mock('@/lib/services/authorizationService', () => ({
  getUserProjectRole: jest.fn(async () => ({ role: 'admin', isOwner: true })),
}));

type ExportClientFake = {
  auth: {
    getUser: (token?: string) => Promise<{ data: { user: { id: string } | null }; error?: { message: string } | null }>;
  };
  from: (table: string) => unknown;
};

const createClientMock = createClient as unknown as jest.MockedFunction<
  (url: string, key: string, options?: unknown) => ExportClientFake
>;

const userId = 'user-1';
const libraryId = '00000000-0000-4000-8000-000000000021';
const projectId = '00000000-0000-4000-8000-000000000022';
const assetId = '00000000-0000-4000-8000-000000000023';
const fieldId = '00000000-0000-4000-8000-000000000024';

type QueryPayload = {
  data: unknown[] | Record<string, unknown> | null;
  error: { message: string } | null;
};

type ExportDataset = {
  fields: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  values: Record<string, unknown>[];
};

const defaultDataset: ExportDataset = {
  fields: [
    {
      id: fieldId,
      library_id: libraryId,
      section: 'Main',
      label: 'Title',
      description: null,
      data_type: 'string',
      enum_options: null,
      reference_libraries: null,
      formula_expression: null,
      order_index: 1,
    },
  ],
  assets: [
    {
      id: assetId,
      library_id: libraryId,
      name: 'Castle',
      created_at: '2026-07-07T00:00:00.000Z',
      row_index: 1,
    },
  ],
  values: [{ asset_id: assetId, field_id: fieldId, value_json: 'Fortress' }],
};

function createExportClient(
  user: { id: string } | null,
  dataset: ExportDataset = defaultDataset
): ExportClientFake {
  return {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
    },
    from: (table: string) => {
      const rows = table === 'library_field_definitions'
        ? dataset.fields
        : table === 'library_assets'
          ? dataset.assets
          : table === 'library_asset_values'
            ? dataset.values
            : null;
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        in: () => builder,
        range: async (from: number, to: number) => ({
          data: rows?.slice(from, to + 1) ?? [],
          error: null,
        }),
        single: async () => {
          if (table === 'libraries') {
            return {
              data: {
                id: libraryId,
                name: 'Locations',
                project_id: projectId,
              },
              error: null,
            };
          }
          if (table === 'projects') {
            return {
              data: { owner_id: userId },
              error: null,
            };
          }
          throw new Error(`Unexpected single() table ${table}`);
        },
        then: (
          resolve: (value: QueryPayload) => void,
          reject?: (reason: unknown) => void
        ) => Promise.resolve({ data: rows?.slice(0, 1000) ?? null, error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
}

describe('GET /api/export', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('requires authentication', async () => {
    createClientMock.mockReturnValue(createExportClient(null));

    const response = await GET(
      new NextRequest(`https://example.test/api/export?libraryId=${libraryId}&format=json`, {
        headers: { Authorization: 'Bearer token' },
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('exports accessible library data as JSON', async () => {
    createClientMock.mockReturnValue(createExportClient({ id: userId }));

    const response = await GET(
      new NextRequest(`https://example.test/api/export?libraryId=${libraryId}&format=json`, {
        headers: { Authorization: 'Bearer token' },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    const payload = await response.json();

    expect(payload).toMatchObject({
      libraryName: 'Locations',
      sections: [{ name: 'Main', orderIndex: 1 }],
      properties: [{ id: fieldId, name: 'Title', dataType: 'string' }],
      rows: [
        {
          id: assetId,
          name: 'Castle',
          propertyValues: { [fieldId]: 'Fortress' },
          created_at: '2026-07-07T00:00:00.000Z',
          rowIndex: 1,
        },
      ],
    });
    expect(typeof payload.exportedAt).toBe('string');
  });

  it('exports every cell value beyond the PostgREST page limit', async () => {
    const fields = Array.from({ length: 3 }, (_, index) => ({
      ...defaultDataset.fields[0],
      id: `field-${index}`,
      label: `Field ${index}`,
      order_index: index,
    }));
    const assets = Array.from({ length: 501 }, (_, index) => ({
      ...defaultDataset.assets[0],
      id: `asset-${String(index).padStart(3, '0')}`,
      name: `Asset ${index}`,
      row_index: index,
    }));
    const values = assets.flatMap((asset) =>
      fields.map((field) => ({
        asset_id: asset.id,
        field_id: field.id,
        value_json: `${asset.id}:${field.id}`,
      }))
    );
    createClientMock.mockReturnValue(createExportClient({ id: userId }, { fields, assets, values }));

    const response = await GET(
      new NextRequest(`https://example.test/api/export?libraryId=${libraryId}&format=json`, {
        headers: { Authorization: 'Bearer token' },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(values).toHaveLength(1503);
    expect(payload.rows).toHaveLength(501);
    expect(payload.rows[500].propertyValues).toEqual({
      'field-0': 'asset-500:field-0',
      'field-1': 'asset-500:field-1',
      'field-2': 'asset-500:field-2',
    });
  });
});
