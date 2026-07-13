import type { AssetRow } from '@/lib/types/libraryAssets';

export type LibrarySnapshotData = {
  assets?: Array<{
    id: string;
    name?: string;
    propertyValues?: Record<string, unknown>;
    createdAt?: string;
    created_at?: string;
    rowIndex?: number;
    row_index?: number;
  }>;
};

const cloneValue = <T,>(value: T): T => {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const cloneAsset = (asset: AssetRow): AssetRow => ({
  ...asset,
  propertyValues: cloneValue(asset.propertyValues ?? {}),
});

const assetsEqual = (left: AssetRow, right: AssetRow): boolean =>
  left.id === right.id &&
  left.libraryId === right.libraryId &&
  left.name === right.name &&
  left.created_at === right.created_at &&
  left.rowIndex === right.rowIndex &&
  JSON.stringify(left.propertyValues) === JSON.stringify(right.propertyValues);

export class ObservableAssetStore {
  private assets = new Map<string, AssetRow>();
  private snapshot: ReadonlyMap<string, AssetRow> = new Map();
  private listeners = new Set<() => void>();
  private transactionDepth = 0;
  private dirty = false;

  get = (assetId: string): AssetRow | undefined => this.assets.get(assetId);

  has = (assetId: string): boolean => this.assets.has(assetId);

  getSnapshot = (): ReadonlyMap<string, AssetRow> => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  forEach = (
    callback: (asset: AssetRow, assetId: string) => void
  ): void => this.assets.forEach(callback);

  set(asset: AssetRow): void {
    const next = cloneAsset(asset);
    const current = this.assets.get(asset.id);
    if (current && assetsEqual(current, next)) return;
    this.assets.set(asset.id, next);
    this.markDirty();
  }

  delete(assetId: string): void {
    if (!this.assets.delete(assetId)) return;
    this.markDirty();
  }

  replace(assets: AssetRow[]): void {
    const incomingIds = new Set(assets.map((asset) => asset.id));
    this.transact(() => {
      for (const assetId of this.assets.keys()) {
        if (!incomingIds.has(assetId)) this.delete(assetId);
      }
      for (const asset of assets) this.set(asset);
    });
  }

  transact(callback: () => void): void {
    this.transactionDepth += 1;
    try {
      callback();
    } finally {
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0 && this.dirty) this.publish();
    }
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.transactionDepth === 0) this.publish();
  }

  private publish(): void {
    this.dirty = false;
    this.snapshot = new Map(this.assets);
    this.listeners.forEach((listener) => listener());
  }
}

export function hydrateAssetStoreFromRows(
  store: ObservableAssetStore,
  assets: AssetRow[]
): void {
  store.replace(assets);
}

export function hydrateAssetStoreFromSnapshot(
  store: ObservableAssetStore,
  libraryId: string,
  snapshot: LibrarySnapshotData
): void {
  const assets = (snapshot.assets ?? []).map((asset): AssetRow => ({
    id: asset.id,
    libraryId,
    name: asset.name ?? 'Untitled',
    propertyValues: cloneValue(asset.propertyValues ?? {}),
    created_at: asset.createdAt ?? asset.created_at,
    rowIndex: asset.rowIndex ?? asset.row_index,
  }));
  store.replace(assets);
}

export { cloneValue as cloneStoreValue };
