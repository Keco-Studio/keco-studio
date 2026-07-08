import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Y from 'yjs';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { createLibraryAssetMutations } from '@/components/libraries/hooks/useLibraryAssetMutations';

type MutationHookArgs = Parameters<typeof createLibraryAssetMutations>[0];

type SupabaseCall = {
  table: string;
  updateValues?: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
  selectColumns?: string;
  single?: boolean;
};

function createSupabaseFake() {
  const calls: SupabaseCall[] = [];

  const supabase = {
    from: (table: string) => {
      const call: SupabaseCall = { table, eqs: [] };
      calls.push(call);

      const filterBuilder = {
        eq: (column: string, value: unknown) => {
          call.eqs.push([column, value]);
          return filterBuilder;
        },
        select: (columns: string) => {
          call.selectColumns = columns;
          return {
            single: async () => {
              call.single = true;
              if (table === 'library_assets') {
                return { data: { updated_at: '2026-07-08T00:00:00.000Z' }, error: null };
              }
              return {
                data: { folder_id: 'folder-1', project_id: 'project-1' },
                error: null,
              };
            },
          };
        },
        then: (resolve: (value: { data: null; error: null }) => void) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };

      return {
        update: (values: Record<string, unknown>) => {
          call.updateValues = values;
          return filterBuilder;
        },
      };
    },
  };

  return {
    calls,
    supabase: supabase as unknown as SupabaseClient,
  };
}

describe('useLibraryAssetMutations', () => {
  it('updates asset names through Yjs, Supabase, library updated_at, and realtime', async () => {
    const { calls, supabase } = createSupabaseFake();
    const yDoc = new Y.Doc();
    const yAssets = yDoc.getMap<Y.Map<unknown>>('assets');
    const yAsset = new Y.Map<unknown>();
    yAsset.set('name', 'Original');
    yAsset.set('propertyValues', new Y.Map<unknown>());
    yAssets.set('asset-1', yAsset);

    const queryClient = new QueryClient();
    const broadcastCellUpdate = jest.fn<MutationHookArgs['realtime']['broadcastCellUpdate']>();
    const mutations = createLibraryAssetMutations({
      supabase,
      queryClient,
      libraryId: 'library-1',
      projectId: 'project-1',
      yDoc,
      yAssets,
      assetsRef: {
        current: new Map<string, AssetRow>([
          [
            'asset-1',
            {
              id: 'asset-1',
              libraryId: 'library-1',
              name: 'Original',
              propertyValues: {},
            },
          ],
        ]),
      },
      pendingBatchInsertIdsRef: { current: new Set<string>() },
      getFormulaFieldMeta: async () => [],
      loadInitialData: async () => {},
      realtimeConfig: {},
      realtime: {
        broadcastCellUpdate,
        broadcastAssetCreate: async () => {},
        broadcastAssetDelete: async () => {},
        broadcastCellsBatchUpdate: async () => {},
        broadcastRowOrderChange: async () => {},
      },
    });

    await mutations.updateAssetName('asset-1', 'Renamed');

    expect(yAsset.get('name')).toBe('Renamed');
    expect(calls).toEqual([
      {
        table: 'library_assets',
        updateValues: { name: 'Renamed' },
        eqs: [['id', 'asset-1']],
        selectColumns: 'updated_at',
        single: true,
      },
      {
        table: 'libraries',
        updateValues: expect.objectContaining({ updated_at: expect.any(String) }),
        eqs: [['id', 'library-1']],
        selectColumns: 'folder_id, project_id',
        single: true,
      },
      {
        table: 'projects',
        updateValues: expect.objectContaining({ updated_at: expect.any(String) }),
        eqs: [['id', 'project-1']],
      },
      {
        table: 'folders',
        updateValues: expect.objectContaining({ updated_at: expect.any(String) }),
        eqs: [['id', 'folder-1']],
      },
    ]);
    expect(broadcastCellUpdate).toHaveBeenCalledWith(
      'asset-1',
      'name',
      'Renamed',
      'Original',
      '2026-07-08T00:00:00.000Z'
    );
  });
});
