import * as Y from 'yjs';
import type { AssetRow } from '@/lib/types/libraryAssets';

export type LibrarySnapshotData = {
  assets?: Array<{
    id: string;
    name?: string;
    propertyValues?: Record<string, unknown>;
    createdAt?: string;
    rowIndex?: number | null;
  }>;
};

const cloneForYjs = (value: unknown): unknown => {
  if (value !== null && typeof value === 'object') {
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
  return value;
};

const createYAsset = ({
  name,
  propertyValues,
  createdAt,
  rowIndex,
}: {
  name: string;
  propertyValues: Record<string, unknown>;
  createdAt?: string;
  rowIndex?: number | null;
}): Y.Map<unknown> => {
  const yAsset = new Y.Map<unknown>();
  yAsset.set('name', name);

  const yPropertyValues = new Y.Map<unknown>();
  Object.entries(propertyValues).forEach(([fieldId, value]) => {
    yPropertyValues.set(fieldId, cloneForYjs(value));
  });
  yAsset.set('propertyValues', yPropertyValues);

  if (createdAt) yAsset.set('created_at', createdAt);
  if (typeof rowIndex === 'number') yAsset.set('row_index', rowIndex);

  return yAsset;
};

export function hydrateYAssetsFromRows(
  yDoc: Y.Doc,
  yAssets: Y.Map<Y.Map<unknown>>,
  assetRows: AssetRow[]
): void {
  yDoc.transact(() => {
    yAssets.clear();

    assetRows.forEach((asset) => {
      yAssets.set(
        asset.id,
        createYAsset({
          name: asset.name,
          propertyValues: asset.propertyValues,
          createdAt: asset.created_at,
          rowIndex: asset.rowIndex,
        })
      );
    });
  });
}

export function hydrateYAssetsFromSnapshot(
  yDoc: Y.Doc,
  yAssets: Y.Map<Y.Map<unknown>>,
  snapshotData: LibrarySnapshotData
): void {
  if (!snapshotData?.assets || !Array.isArray(snapshotData.assets)) return;

  yDoc.transact(() => {
    yAssets.clear();

    snapshotData.assets?.forEach((asset) => {
      yAssets.set(
        asset.id,
        createYAsset({
          name: asset.name ?? 'Untitled',
          propertyValues: asset.propertyValues ?? {},
          createdAt: asset.createdAt,
          rowIndex: asset.rowIndex,
        })
      );
    });
  });
}
