import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Y from 'yjs';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { createLibraryAssetMutations } from '@/components/libraries/hooks/useLibraryAssetMutations';

type MutationHookArgs = Parameters<typeof createLibraryAssetMutations>[0];

type SupabaseCall = {
  table: string;
  insertValues?: unknown;
  upsertValues?: unknown;
  updateValues?: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
  selectColumns?: string;
  single?: boolean;
};

function createSupabaseFake() {
  const calls: SupabaseCall[] = [];
  let touchCounter = 0;

  const supabase = {
    rpc: async (name: string) => {
      if (name !== 'touch_library_asset_edit_updated_at') {
        return { data: null, error: new Error(`Unexpected rpc ${name}`) };
      }
      touchCounter += 1;
      return { data: `2026-07-08T00:00:0${touchCounter}.000Z`, error: null };
    },
    from: (table: string) => {
      const call: SupabaseCall = { table, eqs: [], ins: [] };
      calls.push(call);

      const filterBuilder = {
        eq: (column: string, value: unknown) => {
          call.eqs.push([column, value]);
          return filterBuilder;
        },
        in: (column: string, values: unknown[]) => {
          call.ins.push([column, values]);
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
        order: () => filterBuilder,
        limit: async () => ({ data: [], error: null }),
        then: (resolve: (value: { data: null; error: null }) => void) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };

      return {
        select: (columns: string) => {
          call.selectColumns = columns;
          return filterBuilder;
        },
        insert: (values: unknown) => {
          call.insertValues = values;
          return filterBuilder;
        },
        upsert: (values: unknown) => {
          call.upsertValues = values;
          return Promise.resolve({ data: null, error: null });
        },
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
        ins: [],
        selectColumns: 'updated_at',
        single: true,
      },
      {
        table: 'libraries',
        updateValues: expect.objectContaining({ updated_at: expect.any(String) }),
        eqs: [['id', 'library-1']],
        ins: [],
        selectColumns: 'folder_id, project_id',
        single: true,
      },
      {
        table: 'projects',
        updateValues: expect.objectContaining({ updated_at: expect.any(String) }),
        eqs: [['id', 'project-1']],
        ins: [],
      },
      {
        table: 'folders',
        updateValues: expect.objectContaining({ updated_at: expect.any(String) }),
        eqs: [['id', 'folder-1']],
        ins: [],
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

  it('broadcasts batch field updates with old values and server timestamps', async () => {
    const { supabase } = createSupabaseFake();
    const yDoc = new Y.Doc();
    const yAssets = yDoc.getMap<Y.Map<unknown>>('assets');
    const yAsset = new Y.Map<unknown>();
    const yPropertyValues = new Y.Map<unknown>();
    yPropertyValues.set('field-1', 'Old A');
    yPropertyValues.set('field-2', 'Old B');
    yAsset.set('name', 'Asset');
    yAsset.set('propertyValues', yPropertyValues);
    yAssets.set('asset-1', yAsset);

    const broadcastCellUpdate = jest.fn<MutationHookArgs['realtime']['broadcastCellUpdate']>();
    const mutations = createLibraryAssetMutations({
      supabase,
      queryClient: new QueryClient(),
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
              name: 'Asset',
              propertyValues: {
                'field-1': 'Old A',
                'field-2': 'Old B',
              },
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

    await mutations.updateMultipleFields([
      { assetId: 'asset-1', fieldId: 'field-1', value: 'New A' },
      { assetId: 'asset-1', fieldId: 'field-2', value: 'New B' },
    ]);

    expect(broadcastCellUpdate).toHaveBeenNthCalledWith(
      1,
      'asset-1',
      'field-1',
      'New A',
      'Old A',
      '2026-07-08T00:00:01.000Z'
    );
    expect(broadcastCellUpdate).toHaveBeenNthCalledWith(
      2,
      'asset-1',
      'field-2',
      'New B',
      'Old B',
      '2026-07-08T00:00:02.000Z'
    );
  });

  it('broadcasts batch asset updates with per-cell server timestamps', async () => {
    const { supabase } = createSupabaseFake();
    const yDoc = new Y.Doc();
    const yAssets = yDoc.getMap<Y.Map<unknown>>('assets');
    const yAsset = new Y.Map<unknown>();
    const yPropertyValues = new Y.Map<unknown>();
    yPropertyValues.set('field-1', 'Old');
    yAsset.set('name', 'Old name');
    yAsset.set('propertyValues', yPropertyValues);
    yAssets.set('asset-1', yAsset);

    const broadcastCellsBatchUpdate = jest.fn<MutationHookArgs['realtime']['broadcastCellsBatchUpdate']>();
    const mutations = createLibraryAssetMutations({
      supabase,
      queryClient: new QueryClient(),
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
              name: 'Old name',
              propertyValues: { 'field-1': 'Old' },
            },
          ],
        ]),
      },
      pendingBatchInsertIdsRef: { current: new Set<string>() },
      getFormulaFieldMeta: async () => [],
      loadInitialData: async () => {},
      realtimeConfig: {},
      realtime: {
        broadcastCellUpdate: async () => {},
        broadcastAssetCreate: async () => {},
        broadcastAssetDelete: async () => {},
        broadcastCellsBatchUpdate,
        broadcastRowOrderChange: async () => {},
      },
    });

    await mutations.updateAssetsBatch([
      {
        assetId: 'asset-1',
        assetName: 'New name',
        propertyValues: { 'field-1': 'New' },
      },
    ]);

    expect(broadcastCellsBatchUpdate).toHaveBeenCalledWith([
      {
        assetId: 'asset-1',
        propertyKey: 'name',
        newValue: 'New name',
        oldValue: 'Old name',
        updatedAt: '2026-07-08T00:00:00.000Z',
      },
      {
        assetId: 'asset-1',
        propertyKey: 'field-1',
        newValue: 'New',
        oldValue: 'Old',
        updatedAt: '2026-07-08T00:00:01.000Z',
      },
    ]);
  });
});
