import { useState, useCallback } from 'react';
import type { AssetRow, CreateLibraryAssetOptions, PropertyConfig } from '@/lib/types/libraryAssets';
import type { MediaFileMetadata } from '@/lib/services/mediaFileUploadService';
import { getNextAppendRowIndex } from '@/lib/utils/assetEmptiness';

// Compatible interface for rowStore (supports both row store and mock objects)
interface RowStoreLike {
  length: number;
  toArray: () => AssetRow[];
  insert: (index: number, content: AssetRow[]) => void;
  delete: (index: number, length: number) => void;
}

export type UseAddRowParams = {
  properties: PropertyConfig[];
  library: { id: string; name: string; description?: string | null } | null;
  onSaveAsset?: (
    assetName: string,
    propertyValues: Record<string, any>,
    options?: CreateLibraryAssetOptions
  ) => Promise<void>;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  rowStore: RowStoreLike;
  /** The rows of the current table (from the Adapter), used to calculate the rowIndex of the newly added row (appended at the end with a value of max + 1). */
  rows: AssetRow[];
  setOptimisticNewAssets: React.Dispatch<React.SetStateAction<Map<string, AssetRow>>>;
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>;
  enableRealtime?: boolean;
  currentUser?: { id: string; name: string; email: string; avatarColor?: string } | null;
  broadcastAssetCreate?: (tempId: string, name: string, propertyValues: Record<string, any>) => Promise<void>;
};

export function useAddRow(params: UseAddRowParams) {
  const {
    properties,
    library,
    onSaveAsset,
    userRole,
    rowStore,
    rows,
    setOptimisticNewAssets,
    setIsSaving,
    enableRealtime,
    currentUser,
    broadcastAssetCreate = async () => {},
  } = params;

  const [isAddingRow, setIsAddingRow] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, any>>({});

  const handleSaveNewAsset = useCallback(async () => {
    if (userRole === 'viewer') return;
    if (!onSaveAsset || !library) return;

    const assetName = newRowData[properties[0]?.id] ?? newRowData[properties[0]?.key] ?? 'Untitled';

    // Append at end: max+1 when indices exist; length+1 when any are missing (normalize first).
    const nextRowIndex = getNextAppendRowIndex(rows);
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const optimisticAsset: AssetRow = {
      id: tempId,
      libraryId: library.id,
      name: String(assetName),
      propertyValues: { ...newRowData },
      rowIndex: nextRowIndex,
    };

    rowStore.insert(rowStore.length, [optimisticAsset]);
    setOptimisticNewAssets((prev) => {
      const next = new Map(prev);
      next.set(tempId, optimisticAsset);
      return next;
    });

    setIsAddingRow(false);
    const savedNewRowData = { ...newRowData };
    setNewRowData({});

    setIsSaving(true);
    try {
      await onSaveAsset(assetName, savedNewRowData, { rowIndex: nextRowIndex });
      if (enableRealtime && currentUser) {
        await broadcastAssetCreate(tempId, assetName, savedNewRowData);
      }
      setTimeout(() => {
        const idx = rowStore.toArray().findIndex((r) => r.id === tempId);
        if (idx >= 0) rowStore.delete(idx, 1);
        setOptimisticNewAssets((prev) => {
          const next = new Map(prev);
          next.delete(tempId);
          return next;
        });
      }, 500);
    } catch (e) {
      console.error('Failed to save asset:', e);
      const idx = rowStore.toArray().findIndex((r) => r.id === tempId);
      if (idx >= 0) rowStore.delete(idx, 1);
      setOptimisticNewAssets((prev) => {
        const next = new Map(prev);
        next.delete(tempId);
        return next;
      });
      setIsAddingRow(true);
      setNewRowData(savedNewRowData);
      alert('Failed to save asset. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [
    userRole,
    onSaveAsset,
    library,
    properties,
    newRowData,
    rowStore,
    rows,
    setOptimisticNewAssets,
    setIsSaving,
    enableRealtime,
    currentUser,
    broadcastAssetCreate,
  ]);

  /**
   * Directly add and save a new row (with default 'Untitled' name and empty
   * property values) without entering editing mode.  The row is immediately
   * persisted to the database and appears optimistically in the table.
   */
  const handleAddRowDirect = useCallback(async () => {
    if (userRole === 'viewer') return;
    if (!onSaveAsset || !library) return;

    const nextRowIndex = getNextAppendRowIndex(rows);

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const optimisticAsset: AssetRow = {
      id: tempId,
      libraryId: library.id,
      name: 'Untitled',
      propertyValues: {},
      rowIndex: nextRowIndex,
    };

    rowStore.insert(rowStore.length, [optimisticAsset]);
    setOptimisticNewAssets((prev) => {
      const next = new Map(prev);
      next.set(tempId, optimisticAsset);
      return next;
    });

    setIsSaving(true);
    try {
      await onSaveAsset('Untitled', {}, { rowIndex: nextRowIndex });
      if (enableRealtime && currentUser) {
        await broadcastAssetCreate(tempId, 'Untitled', {});
      }
      setTimeout(() => {
        const idx = rowStore.toArray().findIndex((r) => r.id === tempId);
        if (idx >= 0) rowStore.delete(idx, 1);
        setOptimisticNewAssets((prev) => {
          const next = new Map(prev);
          next.delete(tempId);
          return next;
        });
      }, 500);
    } catch (e) {
      console.error('Failed to save asset:', e);
      const idx = rowStore.toArray().findIndex((r) => r.id === tempId);
      if (idx >= 0) rowStore.delete(idx, 1);
      setOptimisticNewAssets((prev) => {
        const next = new Map(prev);
        next.delete(tempId);
        return next;
      });
      alert('Failed to add row. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [
    userRole,
    onSaveAsset,
    library,
    rows,
    rowStore,
    setOptimisticNewAssets,
    setIsSaving,
    enableRealtime,
    currentUser,
    broadcastAssetCreate,
  ]);

  const handleCancelAdding = useCallback(() => {
    setIsAddingRow(false);
    setNewRowData({});
  }, []);

  const handleInputChange = useCallback((propertyId: string, value: any) => {
    setNewRowData((prev) => ({ ...prev, [propertyId]: value }));
  }, []);

  const handleMediaFileChange = useCallback((propertyId: string, value: MediaFileMetadata | null) => {
    setNewRowData((prev) => ({ ...prev, [propertyId]: value }));
  }, []);

  return {
    isAddingRow,
    setIsAddingRow,
    newRowData,
    setNewRowData,
    handleSaveNewAsset,
    handleAddRowDirect,
    handleCancelAdding,
    handleInputChange,
    handleMediaFileChange,
  };
}
