import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyLibraryAccess } from '@/lib/services/authorizationService';
import {
  applyBooleanFieldDefaults,
  getBooleanFieldIdsByLibraryId,
} from '@/lib/services/libraryAssetsService';
import { getLibrariesAssetCounts } from '@/lib/services/libraryService';
import { checkVersionNameExists } from '@/lib/services/versionService';

jest.mock('@/lib/services/authorizationService', () => ({
  verifyProjectOwnership: jest.fn(),
  verifyProjectAccess: jest.fn(),
  verifyLibraryAccess: jest.fn(),
  verifyLibraryDeletionPermission: jest.fn(),
  verifyLibraryCreationPermission: jest.fn(),
  verifyLibraryUpdatePermission: jest.fn(),
  verifyAssetAccess: jest.fn(),
  verifyAssetDeletionPermission: jest.fn(),
  verifyAssetsDeletionPermission: jest.fn(),
  verifyAssetCreationPermission: jest.fn(),
  verifyAssetUpdatePermission: jest.fn(),
  getUserProjectRole: jest.fn(),
  getCurrentUserId: jest.fn(),
}));

type QueryPayload = {
  data: unknown[] | null;
  error: { message: string } | null;
};

const verifyLibraryAccessMock = verifyLibraryAccess as unknown as jest.MockedFunction<
  (client: SupabaseClient, libraryId: string) => Promise<void>
>;

function createSupabaseFake(resolveTable: (table: string) => QueryPayload): SupabaseClient {
  return {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => Promise.resolve(resolveTable(table)),
        limit: () => Promise.resolve(resolveTable(table)),
        then: (
          resolve: (value: QueryPayload) => void,
          reject?: (reason: unknown) => void
        ) => Promise.resolve(resolveTable(table)).then(resolve, reject),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('touched service breadth coverage', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('applies false defaults only for missing boolean field values', () => {
    const original = {
      enabled: true,
      archived: null,
      title: 'Castle',
    };

    expect(applyBooleanFieldDefaults(original, [])).toBe(original);
    expect(applyBooleanFieldDefaults(original, ['enabled', 'archived', 'visible'])).toEqual({
      enabled: true,
      archived: false,
      title: 'Castle',
      visible: false,
    });
  });

  it('loads boolean field IDs for a library', async () => {
    const supabase = createSupabaseFake((table) => {
      expect(table).toBe('library_field_definitions');
      return {
        data: [{ id: 'field-enabled' }, { id: 'field-visible' }],
        error: null,
      };
    });

    await expect(getBooleanFieldIdsByLibraryId(supabase, 'library-1')).resolves.toEqual([
      'field-enabled',
      'field-visible',
    ]);
  });

  it('checks version name existence through a bounded lookup', async () => {
    const supabase = createSupabaseFake((table) => {
      expect(table).toBe('library_versions');
      return {
        data: [{ id: 'version-1' }],
        error: null,
      };
    });

    await expect(checkVersionNameExists(supabase, 'library-1', ' v1 ')).resolves.toBe(true);
  });

  it('aggregates asset counts for accessible libraries', async () => {
    verifyLibraryAccessMock.mockResolvedValue(undefined);
    const supabase = createSupabaseFake((table) => {
      expect(table).toBe('library_assets');
      return {
        data: [
          { library_id: 'library-1' },
          { library_id: 'library-1' },
          { library_id: 'library-2' },
        ],
        error: null,
      };
    });

    await expect(getLibrariesAssetCounts(supabase, ['library-1', 'library-2'])).resolves.toEqual({
      'library-1': 2,
      'library-2': 1,
    });
    expect(verifyLibraryAccessMock).toHaveBeenCalledTimes(2);
  });
});
