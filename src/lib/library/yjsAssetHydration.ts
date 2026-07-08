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

type HydratableAsset = {
  id: string;
  name: string;
  propertyValues: Record<string, unknown>;
  createdAt?: string;
  rowIndex?: number | null;
};

function syncPropertyValues(
  yAsset: Y.Map<unknown>,
  propertyValues: Record<string, unknown>
): void {
  let yPropertyValues = yAsset.get('propertyValues') as Y.Map<unknown> | undefined;
  if (!yPropertyValues) {
    yPropertyValues = new Y.Map<unknown>();
    yAsset.set('propertyValues', yPropertyValues);
  }

  const nextKeys = new Set(Object.keys(propertyValues));
  Array.from(yPropertyValues.keys()).forEach((fieldId) => {
    if (!nextKeys.has(fieldId)) {
      yPropertyValues.delete(fieldId);
    }
  });
  Object.entries(propertyValues).forEach(([fieldId, value]) => {
    yPropertyValues.set(fieldId, cloneForYjs(value));
  });
}

function upsertYAsset(
  yAssets: Y.Map<Y.Map<unknown>>,
  asset: HydratableAsset
): void {
  const existing = yAssets.get(asset.id);
  if (!existing) {
    yAssets.set(
      asset.id,
      createYAsset({
        name: asset.name,
        propertyValues: asset.propertyValues,
        createdAt: asset.createdAt,
        rowIndex: asset.rowIndex,
      })
    );
    return;
  }

  existing.set('name', asset.name);
  syncPropertyValues(existing, asset.propertyValues);
  if (asset.createdAt) {
    existing.set('created_at', asset.createdAt);
  } else {
    existing.delete('created_at');
  }
  if (typeof asset.rowIndex === 'number') {
    existing.set('row_index', asset.rowIndex);
  } else {
    existing.delete('row_index');
  }
}

function syncYAssets(
  yAssets: Y.Map<Y.Map<unknown>>,
  assets: HydratableAsset[]
): void {
  const nextIds = new Set(assets.map((asset) => asset.id));
  Array.from(yAssets.keys()).forEach((assetId) => {
    if (!nextIds.has(assetId)) {
      yAssets.delete(assetId);
    }
  });
  assets.forEach((asset) => upsertYAsset(yAssets, asset));
}

export function hydrateYAssetsFromRows(
  yDoc: Y.Doc,
  yAssets: Y.Map<Y.Map<unknown>>,
  assetRows: AssetRow[]
): void {
  yDoc.transact(() => {
    syncYAssets(
      yAssets,
      assetRows.map((asset) => ({
        id: asset.id,
        name: asset.name,
        propertyValues: asset.propertyValues,
        createdAt: asset.created_at,
        rowIndex: asset.rowIndex,
      }))
    );
  });
}

export function hydrateYAssetsFromSnapshot(
  yDoc: Y.Doc,
  yAssets: Y.Map<Y.Map<unknown>>,
  snapshotData: LibrarySnapshotData
): void {
  if (!snapshotData?.assets || !Array.isArray(snapshotData.assets)) return;

  yDoc.transact(() => {
    syncYAssets(
      yAssets,
      snapshotData.assets.map((asset) => ({
        id: asset.id,
        name: asset.name ?? 'Untitled',
        propertyValues: asset.propertyValues ?? {},
        createdAt: asset.createdAt,
        rowIndex: asset.rowIndex,
      }))
    );
  });
}
