import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createClient } from '@supabase/supabase-js';
import { verifyProjectOwnership } from '@/lib/services/authorizationService';
import { GET } from '@/app/api/projects/[projectId]/libraries/route';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/services/authorizationService', () => ({
  verifyProjectOwnership: jest.fn(),
  verifyLibraryCreationPermission: jest.fn(),
}));

type LibrariesClientFake = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null } }>;
  };
  from: (table: string) => unknown;
};

const createClientMock = createClient as unknown as jest.MockedFunction<
  (url: string, key: string) => LibrariesClientFake
>;
const verifyProjectOwnershipMock = verifyProjectOwnership as unknown as jest.MockedFunction<
  (client: LibrariesClientFake, projectId: string) => Promise<void>
>;

const projectId = '00000000-0000-4000-8000-000000000010';
const libraryId = '00000000-0000-4000-8000-000000000011';

function createLibrariesClient(user: { id: string } | null): LibrariesClientFake {
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
    },
    from: (table: string) => {
      if (table === 'libraries') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          filter: () => builder,
          order: async () => ({
            data: [
              {
                id: libraryId,
                project_id: projectId,
                folder_id: null,
                name: 'Locations',
                description: null,
                created_at: '2026-07-07T00:00:00.000Z',
                updated_at: '2026-07-08T00:00:00.000Z',
              },
            ],
            error: null,
          }),
        };
        return builder;
      }

      if (table === 'library_assets') {
        return {
          select: () => ({
            in: async () => ({
              data: [{ library_id: libraryId }, { library_id: libraryId }],
              error: null,
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe('GET /api/projects/[projectId]/libraries', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('requires authentication', async () => {
    createClientMock.mockReturnValue(createLibrariesClient(null));

    const response = await GET(
      new Request(`https://example.test/api/projects/${projectId}/libraries`, {
        headers: { authorization: 'Bearer token' },
      }),
      { params: Promise.resolve({ projectId }) }
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('lists accessible project libraries with asset counts', async () => {
    const client = createLibrariesClient({ id: 'user-1' });
    createClientMock.mockReturnValue(client);
    verifyProjectOwnershipMock.mockResolvedValue(undefined);

    const response = await GET(
      new Request(`https://example.test/api/projects/${projectId}/libraries`, {
        headers: { authorization: 'Bearer token' },
      }),
      { params: Promise.resolve({ projectId }) }
    );

    expect(verifyProjectOwnershipMock).toHaveBeenCalledWith(client, projectId, 'user-1');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        id: libraryId,
        project_id: projectId,
        folder_id: null,
        name: 'Locations',
        description: null,
        created_at: '2026-07-07T00:00:00.000Z',
        updated_at: '2026-07-08T00:00:00.000Z',
        asset_count: 2,
      },
    ]);
  });
});
