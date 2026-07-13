import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { POST } from '@/app/api/search/cell-values/replace/route';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';
import { verifyLibraryUpdatePermission } from '@/lib/services/authorizationService';
import { syncReferencesForSourceChanges } from '@/lib/services/referenceSyncService';

jest.mock('@/lib/createSupabaseServerClient', () => ({
  createSupabaseServerClient: jest.fn(),
}));

jest.mock('@/lib/services/authorizationService', () => ({
  verifyAssetUpdatePermission: jest.fn(),
  verifyLibraryUpdatePermission: jest.fn(),
}));

jest.mock('@/lib/services/referenceSyncService', () => ({
  syncReferencesForSourceChanges: jest.fn(),
}));

const createClientMock = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>;
const verifyLibraryPermissionMock = verifyLibraryUpdatePermission as jest.MockedFunction<
  typeof verifyLibraryUpdatePermission
>;
const syncReferencesMock = syncReferencesForSourceChanges as jest.MockedFunction<
  typeof syncReferencesForSourceChanges
>;

describe('cell replace permission batching (issue #224)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('checks update permission once per library rather than once per asset', async () => {
    verifyLibraryPermissionMock.mockResolvedValue(undefined);
    const targets = [
      { asset_id: 'asset-1', field_id: 'field-1', field_label: 'Name', library_id: 'library-1' },
      { asset_id: 'asset-2', field_id: 'field-1', field_label: 'Name', library_id: 'library-1' },
    ];
    const values = targets.map((target) => ({
      asset_id: target.asset_id,
      field_id: target.field_id,
      value_json: 'old value',
    }));

    const supabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
      },
      rpc: async () => ({ data: targets, error: null }),
      from: (table: string) => {
        const builder = {
          select: () => builder,
          in: () => builder,
          then: (
            resolve: (value: { data: unknown[]; error: null }) => void,
            reject?: (reason: unknown) => void
          ) => Promise.resolve(
            table === 'library_asset_values'
              ? { data: values, error: null }
              : { data: [{ id: 'field-1', data_type: 'string' }], error: null }
          ).then(resolve, reject),
        };
        return builder;
      },
    };
    createClientMock.mockReturnValue(supabase as never);

    const response = await POST(new Request('https://example.test/api/search/cell-values/replace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ find: 'old', replace: 'new', mode: 'all', dryRun: true }),
    }));

    expect(response.status).toBe(200);
    expect(verifyLibraryPermissionMock).toHaveBeenCalledTimes(1);
    expect(verifyLibraryPermissionMock).toHaveBeenCalledWith(
      supabase,
      'library-1',
      'user-1',
      { allowEditor: true }
    );
  });

  it('returns the committed cell updates for realtime delivery', async () => {
    verifyLibraryPermissionMock.mockResolvedValue(undefined);
    syncReferencesMock.mockResolvedValue([]);
    const targets = [
      { asset_id: 'asset-1', field_id: 'field-1', field_label: 'Name', library_id: 'library-1' },
    ];
    const values = [
      { asset_id: 'asset-1', field_id: 'field-1', value_json: 'old value' },
    ];

    const supabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
      },
      rpc: async () => ({ data: targets, error: null }),
      from: (table: string) => {
        const builder = {
          select: () => builder,
          in: () => builder,
          upsert: async () => ({ error: null }),
          update: () => ({ in: async () => ({ error: null }) }),
          then: (
            resolve: (value: { data: unknown[]; error: null }) => void,
            reject?: (reason: unknown) => void
          ) => Promise.resolve(
            table === 'library_asset_values'
              ? { data: values, error: null }
              : { data: [{ id: 'field-1', data_type: 'string' }], error: null }
          ).then(resolve, reject),
        };
        return builder;
      },
    };
    createClientMock.mockReturnValue(supabase as never);

    const response = await POST(new Request('https://example.test/api/search/cell-values/replace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ find: 'old', replace: 'new', mode: 'all', dryRun: false }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      updated: 1,
      cells: [{
        libraryId: 'library-1',
        assetId: 'asset-1',
        propertyKey: 'field-1',
        oldValue: 'old value',
        newValue: 'new',
      }],
    });
  });
});
