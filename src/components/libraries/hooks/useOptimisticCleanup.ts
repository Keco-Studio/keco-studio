import { useEffect, useMemo } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';

type OptimisticEditUpdate = {
  name: string;
  propertyValues: Record<string, any>;
};

/**
 * useOptimisticCleanup - 当 rows 更新（父组件刷新）时清理 optimistic 状态
 *
 * - 当乐观编辑与后端数据一致时，清除 optimisticEditUpdates
 * - 当新增的乐观资产在 rows 中找到对应真实行时，清除 optimisticNewAssets
 * - 当 optimistic 的 name 与 row 不一致时，视为过期并清除
 */
export function useOptimisticCleanup({
  rows,
  optimisticNewAssets,
  setOptimisticEditUpdates,
  setOptimisticNewAssets,
}: {
  rows: AssetRow[];
  optimisticNewAssets: Map<string, AssetRow>;
  setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, OptimisticEditUpdate>>>;
  setOptimisticNewAssets: React.Dispatch<React.SetStateAction<Map<string, AssetRow>>>;
}) {
  const rowsSignature = useMemo(
    () => rows.map((r) => `${r.id}:${r.name}`).join('|'),
    [rows]
  );

  useEffect(() => {
    setOptimisticEditUpdates((prev) => {
      if (prev.size === 0) return prev;

      const newMap = new Map(prev);
      let hasChanges = false;

      for (const row of rows) {
        const optimisticUpdate = newMap.get(row.id);
        if (!optimisticUpdate) continue;

        let allMatch = optimisticUpdate.name === row.name;

        if (allMatch) {
          for (const [propertyKey, optimisticValue] of Object.entries(
            optimisticUpdate.propertyValues
          )) {
            const rowValue = row.propertyValues[propertyKey];

            if (optimisticValue !== rowValue) {
              if (
                typeof optimisticValue === 'object' &&
                optimisticValue !== null &&
                typeof rowValue === 'object' &&
                rowValue !== null
              ) {
                const optimisticObj = optimisticValue as Record<string, any>;
                const rowObj = rowValue as Record<string, any>;

                if (optimisticObj.url && rowObj.url) {
                  if (
                    optimisticObj.url !== rowObj.url &&
                    optimisticObj.path !== rowObj.path &&
                    optimisticObj.fileName !== rowObj.fileName
                  ) {
                    allMatch = false;
                    break;
                  }
                } else {
                  const optimisticKeys = Object.keys(optimisticObj);
                  const rowKeys = Object.keys(rowObj);
                  if (optimisticKeys.length !== rowKeys.length) {
                    allMatch = false;
                    break;
                  }
                  for (const key of optimisticKeys) {
                    if (optimisticObj[key] !== rowObj[key]) {
                      allMatch = false;
                      break;
                    }
                  }
                  if (!allMatch) break;
                }
              } else {
                allMatch = false;
                break;
              }
            }
          }
        }

        if (allMatch) {
          newMap.delete(row.id);
          hasChanges = true;
        }
      }

      return hasChanges ? newMap : prev;
    });

    if (optimisticNewAssets.size > 0) {
      setOptimisticNewAssets((prev) => {
        const newMap = new Map(prev);
        let hasChanges = false;

        for (const [tempId, optimisticAsset] of newMap.entries()) {
          const matchingRow = rows.find((row) => {
            const assetRow = row as AssetRow;
            if (assetRow.name !== optimisticAsset.name) return false;

            const optimisticKeys = Object.keys(optimisticAsset.propertyValues);
            const rowKeys = Object.keys(assetRow.propertyValues);
            if (optimisticKeys.length !== rowKeys.length) return false;

            const matchingKeys = optimisticKeys.filter((key) => {
              const optimisticValue = optimisticAsset.propertyValues[key];
              const rowValue = assetRow.propertyValues[key];

              if (!optimisticValue && !rowValue) return true;
              if (!optimisticValue || !rowValue) return false;

              if (
                typeof optimisticValue === 'object' &&
                optimisticValue !== null &&
                typeof rowValue === 'object' &&
                rowValue !== null
              ) {
                const optimisticObj = optimisticValue as Record<string, any>;
                const rowObj = rowValue as Record<string, any>;
                if (optimisticObj.url && rowObj.url) {
                  return (
                    optimisticObj.url === rowObj.url ||
                    optimisticObj.path === rowObj.path ||
                    optimisticObj.fileName === rowObj.fileName
                  );
                }
                return Object.keys(optimisticObj).every(
                  (k) => optimisticObj[k] === rowObj[k]
                );
              }

              return optimisticValue === rowValue;
            });

            return matchingKeys.length >= optimisticKeys.length * 0.8;
          });

          if (matchingRow) {
            newMap.delete(tempId);
            hasChanges = true;
          }
        }

        return hasChanges ? newMap : prev;
      });
    }

    // Removed: "if row.name !== optimisticUpdate.name then delete optimistic"
    // That caused 清空 name 列后 refetch 的 row.name='' 与 optimistic.name 旧值不等 → 整行乐观被删 → 其他列回退到 base（其他列恢复）.
    // Cleanup now only happens in the first pass when optimistic fully matches row (allMatch).
  }, [rows, rowsSignature, optimisticNewAssets.size, setOptimisticEditUpdates, setOptimisticNewAssets]);
}
