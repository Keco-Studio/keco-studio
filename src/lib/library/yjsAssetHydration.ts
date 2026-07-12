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
    const cloned = structuredClone(value);
    const containsCrossRealmObject = (candidate: unknown): boolean => {
      if (candidate === null || typeof candidate !== 'object') return false;
      if (Array.isArray(candidate)) {
        return Object.getPrototypeOf(candidate) !== Array.prototype || candidate.some(containsCrossRealmObject);
      }
      if (Object.getPrototypeOf(candidate) !== Object.prototype) return true;
      return Object.values(candidate as Record<string, unknown>).some(containsCrossRealmObject);
    };
    // Jest executes structuredClone in a host realm; Yjs rejects those object
    // prototypes. Browser clones stay on the fast path.
    return containsCrossRealmObject(cloned)
      ? JSON.parse(JSON.stringify(cloned)) as unknown
      : cloned;
  }
  return value;
};

const valuesAreEqual = (current: unknown, next: unknown): boolean => {
  if (Object.is(current, next)) return true;
  if (current === null || next === null) return false;
  if (typeof current !== 'object' || typeof next !== 'object') return false;
  return JSON.stringify(current) === JSON.stringify(next);
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
    if (valuesAreEqual(yPropertyValues.get(fieldId), value)) return;
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

  if (existing.get('name') !== asset.name) existing.set('name', asset.name);
  syncPropertyValues(existing, asset.propertyValues);
  if (asset.createdAt) {
    if (existing.get('created_at') !== asset.createdAt) {
      existing.set('created_at', asset.createdAt);
    }
  } else if (existing.has('created_at')) {
    existing.delete('created_at');
  }
  if (typeof asset.rowIndex === 'number') {
    if (existing.get('row_index') !== asset.rowIndex) {
      existing.set('row_index', asset.rowIndex);
    }
  } else if (existing.has('row_index')) {
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
