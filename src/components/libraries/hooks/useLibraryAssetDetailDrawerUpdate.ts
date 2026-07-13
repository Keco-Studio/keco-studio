import { useCallback } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';

type AssetPropertyValues = AssetRow['propertyValues'];

type UseLibraryAssetDetailDrawerUpdateParams = {
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: AssetPropertyValues) => Promise<void>;
  rowStore: {
    toArray: () => AssetRow[];
    delete: (index: number, length: number) => void;
    insert: (index: number, rows: AssetRow[]) => void;
  };
  setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, { name: string; propertyValues: AssetPropertyValues }>>>;
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useLibraryAssetDetailDrawerUpdate({
  onUpdateAsset,
  rowStore,
  setOptimisticEditUpdates,
  setIsSaving,
}: UseLibraryAssetDetailDrawerUpdateParams) {
  return useCallback(async (
    assetId: string,
    name: string,
    propertyValues: AssetPropertyValues
  ) => {
    if (!onUpdateAsset) return;
    const allRows = rowStore.toArray();
    const rowIndex = allRows.findIndex((row) => row.id === assetId);
    if (rowIndex >= 0) {
      const existingRow = allRows[rowIndex];
      const updatedRow = { ...existingRow, name, propertyValues };
      rowStore.delete(rowIndex, 1);
      rowStore.insert(rowIndex, [updatedRow]);
    }
    setOptimisticEditUpdates((prev) => {
      const newMap = new Map(prev);
      newMap.set(assetId, { name, propertyValues });
      return newMap;
    });
    setIsSaving(true);
    try {
      await onUpdateAsset(assetId, name, propertyValues);
      setTimeout(() => {
        setOptimisticEditUpdates((prev) => {
          const newMap = new Map(prev);
          newMap.delete(assetId);
          return newMap;
        });
      }, 500);
    } catch (err) {
      setOptimisticEditUpdates((prev) => {
        const newMap = new Map(prev);
        newMap.delete(assetId);
        return newMap;
      });
      console.error('Failed to update from drawer:', err);
    } finally {
      setIsSaving(false);
    }
  }, [onUpdateAsset, rowStore, setOptimisticEditUpdates, setIsSaving]);
}
