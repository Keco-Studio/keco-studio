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

    // ⚠️ 为了保证协作视图稳定，这里不再把 optimisticNewAssets 单独插入/追加到 out。
    // 新建行统一依赖 LibraryDataContext.createAsset → allRowsSource 来驱动展示，
    // 避免「本地乐观 temp 行 + 真实行」双重渲染导致表格比 DB 多出几行。

    return out;
  }, [
    allRowsSource,
    deletedAssetIds,
    optimisticEditUpdates,
    optimisticNewAssets,
    optimisticInsertIndices,
  ]);
}
