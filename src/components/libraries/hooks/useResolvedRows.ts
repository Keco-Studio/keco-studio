import { useMemo } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';

type OptimisticEditUpdate = { name: string; propertyValues: Record<string, any> };

/**
 * useResolvedRows - 合并 allRowsSource、乐观编辑、乐观新增、已删除，得到最终展示行列表
 * 顺序：先按 allRowsSource，再追加仅存在于 optimisticNewAssets 的行。
 */
export function useResolvedRows({
  allRowsSource,
  deletedAssetIds,
  optimisticEditUpdates,
  optimisticNewAssets,
}: {
  allRowsSource: AssetRow[];
  deletedAssetIds: Set<string>;
  optimisticEditUpdates: Map<string, OptimisticEditUpdate>;
  optimisticNewAssets: Map<string, AssetRow>;
}): AssetRow[] {
  return useMemo(() => {
    const allRowsMap = new Map<string, AssetRow>();

    allRowsSource
      .filter((row): row is AssetRow => !deletedAssetIds.has(row.id))
      .forEach((row) => {
        const assetRow = row as AssetRow;
        const opt = optimisticEditUpdates.get(assetRow.id);
        if (opt && opt.name === assetRow.name) {
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

    optimisticNewAssets.forEach((asset, id) => {
      if (done.has(id)) return;
      out.push(asset);
      done.add(id);
    });

    return out;
  }, [
    allRowsSource,
    deletedAssetIds,
    optimisticEditUpdates,
    optimisticNewAssets,
  ]);
}
