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

function resolveTableQuery(table: string): QueryPayload {
  if (table === 'library_field_definitions') {
    return {
      data: [
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
      error: null,
    };
  }

  if (table === 'library_assets') {
    return {
      data: [
        {
          id: assetId,
          library_id: libraryId,
          name: 'Castle',
          created_at: '2026-07-07T00:00:00.000Z',
          row_index: 1,
        },
      ],
      error: null,
    };
  }

  throw new Error(`Unexpected awaited table ${table}`);
}

function createExportClient(user: { id: string } | null): ExportClientFake {
  return {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
    },
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        in: async () => {
          if (table === 'library_asset_values') {
            return {
              data: [
                {
                  asset_id: assetId,
                  field_id: fieldId,
                  value_json: 'Fortress',
                },
              ],
              error: null,
            };
          }
          throw new Error(`Unexpected in() table ${table}`);
        },
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
        ) => Promise.resolve(resolveTableQuery(table)).then(resolve, reject),
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
});
