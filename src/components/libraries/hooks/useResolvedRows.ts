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

    // ⚠️ Optimistic insert rows (temp-insert-*) are handled via yRows → useYjsSync → allRowsSource.
    // When temp-insert placeholders exist in yRows, useYjsSync returns yjsRows as allRowsSource,
    // so they naturally appear in the `out` array above without extra splicing here.

    return out;
  }, [
    allRowsSource,
    deletedAssetIds,
    optimisticEditUpdates,
    optimisticNewAssets,
    optimisticInsertIndices,
  ]);
}
