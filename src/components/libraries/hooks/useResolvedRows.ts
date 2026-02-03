import { useMemo } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';

type OptimisticEditUpdate = { name: string; propertyValues: Record<string, any> };


export function useResolvedRows({
  allRowsSource,
  deletedAssetIds,
  optimisticEditUpdates,
  optimisticNewAssets,
  optimisticInsertIndices = new Map(),
}: {
  allRowsSource: AssetRow[];
  deletedAssetIds: Set<string>;
  optimisticEditUpdates: Map<string, OptimisticEditUpdate>;
  optimisticNewAssets: Map<string, AssetRow>;
  optimisticInsertIndices?: Map<string, number>;
}): AssetRow[] {
  return useMemo(() => {
    const allRowsMap = new Map<string, AssetRow>();

    allRowsSource
      .filter((row): row is AssetRow => !deletedAssetIds.has(row.id))
      .forEach((row) => {
        const assetRow = row as AssetRow;
        const opt = optimisticEditUpdates.get(assetRow.id);
        if (opt) {
          allRowsMap.set(assetRow.id, {
            ...assetRow,
            name: opt.name,
            propertyValues: { ...assetRow.propertyValues, ...opt.propertyValues },
          });
        } else if (!allRowsMap.has(assetRow.id)) {
          allRowsMap.set(assetRow.id, assetRow);
        }
      });

    optimisticNewAssets.forEach((asset, id) => {
      if (!allRowsMap.has(id)) allRowsMap.set(id, asset);
    });

    const out: AssetRow[] = [];
    const done = new Set<string>();

    allRowsSource.forEach((row) => {
      if (deletedAssetIds.has(row.id) || done.has(row.id)) return;
      const r = allRowsMap.get(row.id);
      if (r) {
        out.push(r);
        done.add(row.id);
      }
    });

    // Insert optimistic new rows at their index (insert above/below) or append (add row at end)
    const toInsert: Array<{ index: number; asset: AssetRow; id: string }> = [];
    const toAppend: Array<{ asset: AssetRow; id: string }> = [];
    optimisticNewAssets.forEach((asset, id) => {
      if (done.has(id)) return;
      const idx = optimisticInsertIndices.get(id);
      if (typeof idx === 'number' && idx >= 0) {
        toInsert.push({ index: Math.min(idx, out.length), asset, id });
      } else {
        toAppend.push({ asset, id });
      }
    });
    toInsert.sort((a, b) => a.index - b.index);
    toInsert.forEach(({ index, asset, id }) => {
      out.splice(index, 0, asset);
      done.add(id);
    });
    toAppend.forEach(({ asset, id }) => {
      out.push(asset);
      done.add(id);
    });

    return out;
  }, [
    allRowsSource,
    deletedAssetIds,
    optimisticEditUpdates,
    optimisticNewAssets,
    optimisticInsertIndices,
  ]);
}
