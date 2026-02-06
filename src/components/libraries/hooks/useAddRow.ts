import { useState, useCallback } from 'react';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { MediaFileMetadata } from '@/lib/services/mediaFileUploadService';

// Compatible interface for yRows (supports both Y.Array and mock objects)
interface YRowsLike {
  length: number;
  toArray: () => AssetRow[];
  insert: (index: number, content: AssetRow[]) => void;
  delete: (index: number, length: number) => void;
}

export type UseAddRowParams = {
  properties: PropertyConfig[];
  library: { id: string; name: string; description?: string | null } | null;
  onSaveAsset?: (assetName: string, propertyValues: Record<string, any>, options?: { createdAt?: Date; rowIndex?: number }) => Promise<void>;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  yRows: YRowsLike;
  /** 当前表格的行（来自 Adapter），用于计算新增行的 rowIndex（追加在末尾 max+1） */
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
    yRows,
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

    // 使用当前 rows 中的最大 rowIndex 来分配新行的 rowIndex，确保追加在末尾（max+1）
    const maxRowIndex =
      rows.length > 0
        ? rows.reduce((max, r) => {
            const idx = typeof r.rowIndex === 'number' ? r.rowIndex : 0;
            return idx > max ? idx : max;
          }, 0)
        : 0;
    const nextRowIndex = maxRowIndex + 1;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const optimisticAsset: AssetRow = {
      id: tempId,
      libraryId: library.id,
      name: String(assetName),
      propertyValues: { ...newRowData },
      rowIndex: nextRowIndex,
    };

    yRows.insert(yRows.length, [optimisticAsset]);
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
        const idx = yRows.toArray().findIndex((r) => r.id === tempId);
        if (idx >= 0) yRows.delete(idx, 1);
        setOptimisticNewAssets((prev) => {
          const next = new Map(prev);
          next.delete(tempId);
          return next;
        });
      }, 500);
    } catch (e) {
      console.error('Failed to save asset:', e);
      const idx = yRows.toArray().findIndex((r) => r.id === tempId);
      if (idx >= 0) yRows.delete(idx, 1);
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
    yRows,
    rows,
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
    handleCancelAdding,
    handleInputChange,
    handleMediaFileChange,
  };
}
