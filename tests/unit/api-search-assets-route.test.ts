import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { GET } from '@/app/api/search/assets/route';

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(),
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

type CookieStoreFake = {
  getAll: () => Array<{ name: string; value: string }>;
  set: (name: string, value: string, options?: unknown) => void;
};

type QueryResult = Promise<{ data: unknown[] | null; error: { message: string } | null }>;

type SearchClientFake = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null } }>;
  };
  from: (table: string) => unknown;
};

const createServerClientMock = createServerClient as unknown as jest.MockedFunction<
  (url: string, key: string, options: unknown) => SearchClientFake
>;
const cookiesMock = cookies as unknown as jest.MockedFunction<() => Promise<CookieStoreFake>>;

const validAssetId = '00000000-0000-4000-8000-000000000001';
const validLibraryId = '00000000-0000-4000-8000-000000000002';
const validProjectId = '00000000-0000-4000-8000-000000000003';

function createSearchClient(user: { id: string } | null): SearchClientFake {
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
    },
    from: (table: string) => {
      if (table === 'library_assets') {
        const builder = {
          select: () => builder,
          ilike: () => builder,
          order: () => builder,
          limit: async () => ({
            data: [
              {
                id: validAssetId,
                name: 'Castle',
                library_id: validLibraryId,
                updated_at: '2026-07-08T00:00:00.000Z',
                created_at: '2026-07-07T00:00:00.000Z',
              },
            ],
            error: null,
          }),
        };
        return builder;
      }

      if (table === 'libraries') {
        return {
          select: () => ({
            in: async () => ({
              data: [
                {
                  id: validLibraryId,
                  name: 'Locations',
                  project_id: validProjectId,
                },
              ],
              error: null,
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe('GET /api/search/assets', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('requires authentication', async () => {
    cookiesMock.mockResolvedValue({ getAll: () => [], set: () => undefined });
    createServerClientMock.mockReturnValue(createSearchClient(null));

    const response = await GET(new Request('https://example.test/api/search/assets?q=castle'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('maps matching assets to global search results', async () => {
    cookiesMock.mockResolvedValue({ getAll: () => [], set: () => undefined });
    createServerClientMock.mockReturnValue(createSearchClient({ id: 'user-1' }));

    const response = await GET(new Request('https://example.test/api/search/assets?q=castle&limit=5'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [
        {
          type: 'asset',
          id: validAssetId,
          projectId: validProjectId,
          libraryId: validLibraryId,
          name: 'Castle',
          hierarchy: 'Locations',
          updatedAt: '2026-07-08T00:00:00.000Z',
        },
      ],
    });
  });
});
