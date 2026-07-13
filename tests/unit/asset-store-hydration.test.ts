import { describe, expect, it, jest } from '@jest/globals';
import {
  hydrateAssetStoreFromRows,
  hydrateAssetStoreFromSnapshot,
  ObservableAssetStore,
} from '@/lib/library/assetStore';
import type { AssetRow } from '@/lib/types/libraryAssets';

describe('asset store hydration', () => {
  it('replaces stale assets and clones nested row values', () => {
    const store = new ObservableAssetStore();
    store.set({ id: 'stale', libraryId: 'library-1', name: 'Stale', propertyValues: {} });
    const rows: AssetRow[] = [{
      id: 'asset-1',
      libraryId: 'library-1',
      name: 'Alice',
      propertyValues: { stats: { hp: 10 } },
      created_at: '2026-07-08T00:00:00.000Z',
      rowIndex: 2,
    }];

    hydrateAssetStoreFromRows(store, rows);
    rows[0].propertyValues.stats = { hp: 99 };

    expect(store.has('stale')).toBe(false);
    expect(store.get('asset-1')).toEqual({
      ...rows[0],
      propertyValues: { stats: { hp: 10 } },
    });
  });

  it('hydrates snapshot field aliases into plain assets', () => {
    const store = new ObservableAssetStore();
    hydrateAssetStoreFromSnapshot(store, 'library-1', {
      assets: [{
        id: 'asset-2',
        name: 'Bob',
        propertyValues: { title: 'Captain' },
        createdAt: '2026-07-08T01:00:00.000Z',
        rowIndex: 3,
      }],
    });

    expect(store.get('asset-2')).toEqual({
      id: 'asset-2',
      libraryId: 'library-1',
      name: 'Bob',
      propertyValues: { title: 'Captain' },
      created_at: '2026-07-08T01:00:00.000Z',
      rowIndex: 3,
    });
  });

  it('does not publish unchanged repeated hydration', () => {
    const store = new ObservableAssetStore();
    const listener = jest.fn();
    const rows: AssetRow[] = [{
      id: 'asset-stable', libraryId: 'library-1', name: 'Stable',
      propertyValues: { tags: ['a', 'b'] }, rowIndex: 1,
    }];
    hydrateAssetStoreFromRows(store, rows);
    store.subscribe(listener);
    hydrateAssetStoreFromRows(store, rows);
    expect(listener).not.toHaveBeenCalled();
  });
});
