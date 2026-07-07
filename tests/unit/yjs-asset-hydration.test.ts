import { describe, expect, it } from '@jest/globals';
import * as Y from 'yjs';
import {
  hydrateYAssetsFromRows,
  hydrateYAssetsFromSnapshot,
} from '@/lib/library/yjsAssetHydration';
import type { AssetRow } from '@/lib/types/libraryAssets';

const readYAssets = (yAssets: Y.Map<Y.Map<unknown>>) => {
  const result = new Map<string, Record<string, unknown>>();
  yAssets.forEach((yAsset, assetId) => {
    const yPropertyValues = yAsset.get('propertyValues') as Y.Map<unknown>;
    const propertyValues: Record<string, unknown> = {};
    yPropertyValues.forEach((value, key) => {
      propertyValues[key] = value;
    });
    result.set(assetId, {
      name: yAsset.get('name'),
      propertyValues,
      created_at: yAsset.get('created_at'),
      row_index: yAsset.get('row_index'),
    });
  });
  return result;
};

describe('Yjs asset hydration helpers', () => {
  it('replaces in-memory Yjs assets from Supabase rows', () => {
    const yDoc = new Y.Doc();
    const yAssets = yDoc.getMap<Y.Map<unknown>>('assets');
    yAssets.set('stale', new Y.Map());

    const rows: AssetRow[] = [
      {
        id: 'asset-1',
        libraryId: 'library-1',
        name: 'Alice',
        propertyValues: {
          name: 'Alice',
          stats: { hp: 10 },
        },
        created_at: '2026-07-08T00:00:00.000Z',
        rowIndex: 2,
      },
    ];

    hydrateYAssetsFromRows(yDoc, yAssets, rows);

    const assets = readYAssets(yAssets);
    expect(assets.has('stale')).toBe(false);
    expect(assets.get('asset-1')).toEqual({
      name: 'Alice',
      propertyValues: {
        name: 'Alice',
        stats: { hp: 10 },
      },
      created_at: '2026-07-08T00:00:00.000Z',
      row_index: 2,
    });

    rows[0].propertyValues.stats = { hp: 99 };
    expect((assets.get('asset-1')?.propertyValues as Record<string, unknown>).stats).toEqual({
      hp: 10,
    });
  });

  it('replaces in-memory Yjs assets from a library snapshot', () => {
    const yDoc = new Y.Doc();
    const yAssets = yDoc.getMap<Y.Map<unknown>>('assets');

    hydrateYAssetsFromSnapshot(yDoc, yAssets, {
      assets: [
        {
          id: 'asset-2',
          name: 'Bob',
          propertyValues: { title: 'Captain' },
          createdAt: '2026-07-08T01:00:00.000Z',
          rowIndex: 3,
        },
      ],
    });

    expect(readYAssets(yAssets).get('asset-2')).toEqual({
      name: 'Bob',
      propertyValues: { title: 'Captain' },
      created_at: '2026-07-08T01:00:00.000Z',
      row_index: 3,
    });
  });
});
