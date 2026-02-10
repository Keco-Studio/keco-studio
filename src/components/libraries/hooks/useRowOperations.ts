import { useCallback, useEffect } from 'react';
import type * as Y from 'yjs';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { CellKey } from './useCellSelection';
import type { SupabaseClient } from '@supabase/supabase-js';
import { shiftRowIndices } from '@/lib/services/libraryAssetsService';

// Compatible interface for yRows (supports both Y.Array and mock objects)
interface YRowsLike {
  length: number;
  toArray: () => AssetRow[];
  insert: (index: number, content: AssetRow[]) => void;
  delete: (index: number, length: number) => void;
}

export type UseRowOperationsParams = {
  onSaveAsset?: (assetName: string, propertyValues: Record<string, any>, options?: { createdAt?: Date; rowIndex?: number }) => Promise<void>;
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  /** Batch update: all updates then one dispatch → one invalidate, avoids 先消失后恢复再消失 + 其他列恢复 */
  onUpdateAssets?: (updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>) => Promise<void>;
  /** Clear Content 专用：批量更新 + 一次性广播，效仿 Delete Row 的即时同步 */
  onUpdateAssetsWithBatchBroadcast?: (updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>) => Promise<void>;
  onDeleteAsset?: (assetId: string) => Promise<void>;
  /** Batch delete: Supabase .delete().in(), one round-trip */
  onDeleteAssets?: (assetIds: string[]) => Promise<void>;
  library: { id: string } | null;
  supabase: SupabaseClient | null;
  orderedProperties: PropertyConfig[];
  getAllRowsForCellSelection: () => AssetRow[];
  yRows: YRowsLike;
  selectedCells: Set<CellKey>;
  selectedRowIds: Set<string>;
  selectedCellsRef: React.MutableRefObject<Set<CellKey>>;
  contextMenuRowIdRef: React.MutableRefObject<string | null>;
  setSelectedCells: React.Dispatch<React.SetStateAction<Set<CellKey>>>;
  setSelectedRowIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setBatchEditMenuVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setBatchEditMenuPosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  setContextMenuRowId: React.Dispatch<React.SetStateAction<string | null>>;
  setContextMenuPosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  setClearContentsConfirmVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setDeleteRowConfirmVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setDeleteConfirmVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setDeletingAssetId: React.Dispatch<React.SetStateAction<string | null>>;
  setOptimisticNewAssets: React.Dispatch<React.SetStateAction<Map<string, AssetRow>>>;
  /** When using mock yRows (no real insert), pass this so optimistic rows are shown at correct index instead of appended */
  setOptimisticInsertIndices?: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, { name: string; propertyValues: Record<string, any> }>>>;
  setDeletedAssetIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setToastMessage: React.Dispatch<React.SetStateAction<{ message: string; type: 'success' | 'error' | 'default' } | null>>;
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>;
  enableRealtime?: boolean;
  currentUser?: { id: string; name: string } | null;
  broadcastAssetCreate: (tempId: string, name: string, propertyValues: Record<string, any>, options?: { insertBeforeRowId?: string; insertAfterRowId?: string }) => Promise<void>;
  broadcastAssetDelete: (assetId: string, assetName: string) => Promise<void>;
  deletingAssetId: string | null;
  rows: AssetRow[];
};

function closeRowOpMenus(
  setBatchEditMenuVisible: UseRowOperationsParams['setBatchEditMenuVisible'],
  setBatchEditMenuPosition: UseRowOperationsParams['setBatchEditMenuPosition'],
  setContextMenuRowId: UseRowOperationsParams['setContextMenuRowId'],
  setContextMenuPosition: UseRowOperationsParams['setContextMenuPosition'],
  contextMenuRowIdRef: React.MutableRefObject<string | null>
) {
  setBatchEditMenuVisible(false);
  setBatchEditMenuPosition(null);
  setContextMenuRowId(null);
  setContextMenuPosition(null);
  contextMenuRowIdRef.current = null;
}


export function useRowOperations(params: UseRowOperationsParams) {
  const {
    onSaveAsset,
    onUpdateAsset,
    onUpdateAssets,
    onUpdateAssetsWithBatchBroadcast,
    onDeleteAsset,
    onDeleteAssets,
    library,
    supabase,
    orderedProperties,
    getAllRowsForCellSelection,
    yRows,
    selectedCells,
    selectedRowIds,
    selectedCellsRef,
    contextMenuRowIdRef,
    setSelectedCells,
    setSelectedRowIds,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
    setContextMenuRowId,
    setContextMenuPosition,
    setClearContentsConfirmVisible,
    setDeleteRowConfirmVisible,
    setDeleteConfirmVisible,
    setDeletingAssetId,
    setOptimisticNewAssets,
    setOptimisticInsertIndices,
    setOptimisticEditUpdates,
    setDeletedAssetIds,
    setToastMessage,
    setIsSaving,
    enableRealtime = false,
    currentUser = null,
    broadcastAssetCreate,
    broadcastAssetDelete,
    deletingAssetId,
    rows,
  } = params;

  // Remove from deletedAssetIds only when rows (from refetch) no longer contain that id
  useEffect(() => {
    const rowIds = new Set(rows.map((r) => r.id));
    setDeletedAssetIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      prev.forEach((id) => {
        if (!rowIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [rows, setDeletedAssetIds]);

  const handleInsertRowAbove = useCallback(async () => {
    if (!onSaveAsset || !library) {
      closeRowOpMenus(setBatchEditMenuVisible, setBatchEditMenuPosition, setContextMenuRowId, setContextMenuPosition, contextMenuRowIdRef);
      return;
    }

    let rowsToUse: Set<string>;
    if (selectedRowIds.size > 0) {
      rowsToUse = new Set(selectedRowIds);
    } else if (selectedCells.size > 0) {
      rowsToUse = new Set<string>();
      selectedCells.forEach((cellKey) => {
        for (const property of orderedProperties) {
          const propertyKeyWithDash = '-' + property.key;
          if (cellKey.endsWith(propertyKeyWithDash)) {
            const rowId = cellKey.substring(0, cellKey.length - propertyKeyWithDash.length);
            rowsToUse.add(rowId);
            break;
          }
        }
      });
    } else if (contextMenuRowIdRef.current) {
      rowsToUse = new Set([contextMenuRowIdRef.current]);
    } else {
      closeRowOpMenus(setBatchEditMenuVisible, setBatchEditMenuPosition, setContextMenuRowId, setContextMenuPosition, contextMenuRowIdRef);
      return;
    }

    if (rowsToUse.size === 0) {
      closeRowOpMenus(setBatchEditMenuVisible, setBatchEditMenuPosition, setContextMenuRowId, setContextMenuPosition, contextMenuRowIdRef);
      return;
    }

    // 使用当前表格渲染用的 rows 顺序（来自 Adapter，已按 rowIndex 排好）来决定插入位置
    const allRowsForSelection = rows;
    const sortedRowIds = Array.from(rowsToUse).sort((a, b) => {
      const indexA = allRowsForSelection.findIndex((r) => r.id === a);
      const indexB = allRowsForSelection.findIndex((r) => r.id === b);
      return indexA - indexB;
    });

    const numRowsToInsert = sortedRowIds.length;
    closeRowOpMenus(setBatchEditMenuVisible, setBatchEditMenuPosition, setContextMenuRowId, setContextMenuPosition, contextMenuRowIdRef);
    setIsSaving(true);

    try {
      // 逐个目标行从下往上插入，保证「每个选中行上方各插入一行」，
      // 而不是在第一行前一次性插入一整块空行。
      for (let i = sortedRowIds.length - 1; i >= 0; i--) {
        const rowId = sortedRowIds[i];
        const targetRow = allRowsForSelection.find((r) => r.id === rowId);
        if (!targetRow) continue;

        const baseRowIndex =
          typeof targetRow.rowIndex === 'number'
            ? targetRow.rowIndex
            : 1;

        if (supabase) {
          await shiftRowIndices(supabase, library.id, baseRowIndex, 1);
        }

        await onSaveAsset('Untitled', {}, { rowIndex: baseRowIndex });
      }

      setToastMessage({ message: numRowsToInsert === 1 ? '1 row inserted' : `${numRowsToInsert} rows inserted`, type: 'success' });
      setTimeout(() => setToastMessage(null), 2000);
    } catch (e) {
      console.error('Failed to insert rows above:', e);
      setToastMessage({ message: 'Failed to insert rows above', type: 'error' });
      setTimeout(() => setToastMessage(null), 2000);
    } finally {
      setIsSaving(false);
    }

    closeRowOpMenus(setBatchEditMenuVisible, setBatchEditMenuPosition, setContextMenuRowId, setContextMenuPosition, contextMenuRowIdRef);
    setSelectedCells(new Set());
    setSelectedRowIds(new Set());
  }, [
    onSaveAsset,
    library,
    supabase,
    orderedProperties,
    selectedCells,
    selectedRowIds,
    contextMenuRowIdRef,
    getAllRowsForCellSelection,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
    setContextMenuRowId,
    setContextMenuPosition,
    setToastMessage,
    setIsSaving,
    setSelectedCells,
    setSelectedRowIds,
  ]);

  const handleInsertRowBelow = useCallback(async () => {
    if (!onSaveAsset || !library) {
      closeRowOpMenus(setBatchEditMenuVisible, setBatchEditMenuPosition, setContextMenuRowId, setContextMenuPosition, contextMenuRowIdRef);
      return;
    }

    let rowsToUse: Set<string>;
    if (selectedRowIds.size > 0) {
      rowsToUse = new Set(selectedRowIds);
    } else if (selectedCells.size > 0) {
      rowsToUse = new Set<string>();
      selectedCells.forEach((cellKey) => {
        for (const property of orderedProperties) {
          const propertyKeyWithDash = '-' + property.key;
          if (cellKey.endsWith(propertyKeyWithDash)) {
            const rowId = cellKey.substring(0, cellKey.length - propertyKeyWithDash.length);
            rowsToUse.add(rowId);
            break;
          }
        }
      });
    } else if (contextMenuRowIdRef.current) {
      rowsToUse = new Set([contextMenuRowIdRef.current]);
    } else {
      closeRowOpMenus(setBatchEditMenuVisible, setBatchEditMenuPosition, setContextMenuRowId, setContextMenuPosition, contextMenuRowIdRef);
      return;
    }

    if (rowsToUse.size === 0) {
      closeRowOpMenus(setBatchEditMenuVisible, setBatchEditMenuPosition, setContextMenuRowId, setContextMenuPosition, contextMenuRowIdRef);
      return;
    }

    // 使用当前表格渲染用的 rows 顺序（来自 Adapter，已按 rowIndex 排好）来决定插入位置
    const allRowsForSelection = rows;
    const sortedRowIds = Array.from(rowsToUse).sort((a, b) => {
      const indexA = allRowsForSelection.findIndex((r) => r.id === a);
      const indexB = allRowsForSelection.findIndex((r) => r.id === b);
      return indexA - indexB;
    });

    const numRowsToInsert = sortedRowIds.length;
    closeRowOpMenus(setBatchEditMenuVisible, setBatchEditMenuPosition, setContextMenuRowId, setContextMenuPosition, contextMenuRowIdRef);
    setIsSaving(true);

    try {
      // 逐个目标行从下往上插入，保证「每个选中行下方各插入一行」，
      // 而不是在最后一行之后一次性插入一整块空行。
      for (let i = sortedRowIds.length - 1; i >= 0; i--) {
        const rowId = sortedRowIds[i];
        const targetRow = allRowsForSelection.find((r) => r.id === rowId);
        if (!targetRow) continue;

        const baseRowIndex =
          typeof targetRow.rowIndex === 'number'
            ? targetRow.rowIndex + 1
            : 1;

        if (supabase) {
          await shiftRowIndices(supabase, library.id, baseRowIndex, 1);
        }

        await onSaveAsset('Untitled', {}, { rowIndex: baseRowIndex });
      }

      setToastMessage({ message: numRowsToInsert === 1 ? '1 row inserted' : `${numRowsToInsert} rows inserted`, type: 'success' });
      setTimeout(() => setToastMessage(null), 2000);
    } catch (e) {
      console.error('Failed to insert rows below:', e);
      setToastMessage({ message: 'Failed to insert rows below', type: 'error' });
      setTimeout(() => setToastMessage(null), 2000);
    } finally {
      setIsSaving(false);
    }

    closeRowOpMenus(setBatchEditMenuVisible, setBatchEditMenuPosition, setContextMenuRowId, setContextMenuPosition, contextMenuRowIdRef);
    setSelectedCells(new Set());
    setSelectedRowIds(new Set());
  }, [
    onSaveAsset,
    library,
    supabase,
    orderedProperties,
    selectedCells,
    selectedRowIds,
    contextMenuRowIdRef,
    getAllRowsForCellSelection,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
    setContextMenuRowId,
    setContextMenuPosition,
    setToastMessage,
    setIsSaving,
    setSelectedCells,
    setSelectedRowIds,
    enableRealtime,
    currentUser,
    broadcastAssetCreate,
  ]);

  const handleClearContents = useCallback(async () => {
    let cellsToClear = selectedCells;
    if (selectedCells.size === 0 && selectedRowIds.size > 0) {
      const allRowCellKeys: CellKey[] = [];
      selectedRowIds.forEach((selectedRowId) => {
        orderedProperties.forEach((property) => {
          allRowCellKeys.push(`${selectedRowId}-${property.key}` as CellKey);
        });
      });
      cellsToClear = new Set(allRowCellKeys);
      setSelectedCells(cellsToClear);
    }

    if (cellsToClear.size === 0) {
      setClearContentsConfirmVisible(false);
      return;
    }
    if (!onUpdateAsset && !onUpdateAssetsWithBatchBroadcast) {
      setClearContentsConfirmVisible(false);
      return;
    }

    const allRowsForSelection = getAllRowsForCellSelection();
    const cellsByRow = new Map<string, { propertyValues: Record<string, any>; assetName: string | null }>();
    const clearedKeysByRow = new Map<string, Set<string>>();

    cellsToClear.forEach((cellKey) => {
      let rowId = '';
      let propertyKey = '';
      let propertyIndex = -1;
      for (let i = 0; i < orderedProperties.length; i++) {
        const p = orderedProperties[i];
        const suffix = '-' + p.key;
        if (cellKey.endsWith(suffix)) {
          rowId = cellKey.substring(0, cellKey.length - suffix.length);
          propertyKey = p.key;
          propertyIndex = i;
          break;
        }
      }
      if (rowId && propertyKey) {
        const row = allRowsForSelection.find((r) => r.id === rowId);
        if (row) {
          if (!cellsByRow.has(rowId)) {
            cellsByRow.set(rowId, { propertyValues: { ...row.propertyValues }, assetName: row.name || null });
          }
          if (!clearedKeysByRow.has(rowId)) clearedKeysByRow.set(rowId, new Set());
          clearedKeysByRow.get(rowId)!.add(propertyKey);
          const rowData = cellsByRow.get(rowId)!;
          const prop = orderedProperties[propertyIndex];
          // Name field is identified by label='name' and dataType='string', not by position
          const isNameField = prop && prop.name === 'name' && prop.dataType === 'string';
          if (isNameField) {
            rowData.assetName = '';
            rowData.propertyValues[propertyKey] = null;
          } else {
            rowData.propertyValues[propertyKey] = prop?.dataType === 'boolean' ? false : null;
          }
        }
      }
    });

    setClearContentsConfirmVisible(false);

    setOptimisticEditUpdates((prev) => {
      const newMap = new Map(prev);
      for (const [rowId, rowData] of cellsByRow.entries()) {
        const row = allRowsForSelection.find((r) => r.id === rowId);
        if (!row) continue;
        const existing = prev.get(rowId);
        const displayName =
          rowData.assetName !== null && rowData.assetName !== undefined
            ? rowData.assetName
            : (existing?.name ?? row.name ?? 'Untitled');
        // Only overlay cleared keys onto existing optimistic (or row). Replacing with full
        // rowData.propertyValues could overwrite other columns if row was ever stale/partial,
        // causing "其他列也清空，过一会又恢复".
        const clearedDelta: Record<string, any> = {};
        for (const [k, v] of Object.entries(rowData.propertyValues)) {
          if (row.propertyValues[k] !== v) clearedDelta[k] = v;
        }
        const baseForMerge = existing?.propertyValues ?? row.propertyValues ?? {};
        newMap.set(rowId, {
          name: displayName,
          propertyValues: { ...baseForMerge, ...clearedDelta },
        });
      }
      return newMap;
    });

    setIsSaving(true);
    try {
      const entries = Array.from(cellsByRow.entries()).filter(([rowId]) =>
        allRowsForSelection.some((r) => r.id === rowId)
      );
      const updates = entries.map(([rowId, rowData]) => {
        const row = allRowsForSelection.find((r) => r.id === rowId)!;
        const assetName = rowData.assetName !== null ? rowData.assetName : (row.name || 'Untitled');
        const clearedKeys = clearedKeysByRow.get(rowId);
        const propertyValues =
          clearedKeys && clearedKeys.size > 0
            ? Object.fromEntries([...clearedKeys].map((k) => [k, rowData.propertyValues[k]]))
            : {};
        return { assetId: rowId, assetName, propertyValues };
      });

      // 优先使用批量广播（效仿 Delete Row），协作者即时同步；否则回退到普通批量更新
      if (updates.length > 0 && onUpdateAssetsWithBatchBroadcast) {
        await onUpdateAssetsWithBatchBroadcast(updates);
      } else if (entries.length > 1 && onUpdateAssets) {
        await onUpdateAssets(updates);
      } else if (onUpdateAsset) {
        await Promise.all(
          entries.map(([rowId, rowData]) => {
            const row = allRowsForSelection.find((r) => r.id === rowId);
            if (!row) return Promise.resolve();
            const assetName = rowData.assetName !== null ? rowData.assetName : (row.name || 'Untitled');
            return onUpdateAsset!(rowId, assetName, rowData.propertyValues);
          })
        );
      }
      // Rely on useOptimisticCleanup when rows match; no setTimeout clear to avoid 先消失后恢复再消失
      setSelectedCells(new Set());
      setSelectedRowIds(new Set());
    } catch (e) {
      console.error('Failed to clear contents:', e);
      setOptimisticEditUpdates((prev) => {
        const newMap = new Map(prev);
        for (const rowId of cellsByRow.keys()) newMap.delete(rowId);
        return newMap;
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    selectedCells,
    selectedRowIds,
    orderedProperties,
    getAllRowsForCellSelection,
    onUpdateAsset,
    onUpdateAssets,
    onUpdateAssetsWithBatchBroadcast,
    setSelectedCells,
    setSelectedRowIds,
    setClearContentsConfirmVisible,
    setOptimisticEditUpdates,
    setIsSaving,
  ]);

  const handleDeleteRow = useCallback(async () => {
    const currentSelectedCells = selectedCellsRef.current;
    let rowsToDelete: Set<string>;

    if (currentSelectedCells && currentSelectedCells.size > 0) {
      const allRowsForSelection = getAllRowsForCellSelection();
      rowsToDelete = new Set<string>();
      currentSelectedCells.forEach((cellKey) => {
        for (const property of orderedProperties) {
          const suffix = '-' + property.key;
          if (cellKey.endsWith(suffix)) {
            const rowId = cellKey.substring(0, cellKey.length - suffix.length);
            rowsToDelete.add(rowId);
            break;
          }
        }
      });
    } else if (selectedRowIds.size > 0) {
      rowsToDelete = new Set(selectedRowIds);
    } else {
      setDeleteRowConfirmVisible(false);
      return;
    }

    if (rowsToDelete.size === 0) {
      setDeleteRowConfirmVisible(false);
      return;
    }

    const tempIds = new Set<string>();
    const realIds = new Set<string>();
    rowsToDelete.forEach((id) => {
      if (id.startsWith('temp-')) tempIds.add(id);
      else realIds.add(id);
    });

    if (realIds.size > 0 && !onDeleteAsset && !onDeleteAssets) {
      setDeleteRowConfirmVisible(false);
      return;
    }

    setDeleteRowConfirmVisible(false);
    const failedRowIds: string[] = [];

    try {
      // Delete temp rows (e.g. from paste auto-expand): remove from Yjs + optimisticNewAssets only
      if (tempIds.size > 0) {
        const allRows = yRows.toArray();
        const indicesToRemove: number[] = [];
        tempIds.forEach((tid) => {
          const idx = allRows.findIndex((r) => r.id === tid);
          if (idx >= 0) indicesToRemove.push(idx);
        });
        indicesToRemove.sort((a, b) => b - a);
        indicesToRemove.forEach((idx) => {
          try {
            yRows.delete(idx, 1);
          } catch (e) {
            console.warn('Failed to remove temp row from Yjs:', e);
          }
        });
        setOptimisticNewAssets((prev) => {
          const next = new Map(prev);
          tempIds.forEach((tid) => next.delete(tid));
          return next;
        });
      }

      // Optimistically hide all rows to delete (single update)
      setDeletedAssetIds((prev) => {
        const next = new Set(prev);
        realIds.forEach((id) => next.add(id));
        return next;
      });

      const realIdsArr = Array.from(realIds);
      const useBatch = realIdsArr.length > 1 && !!onDeleteAssets;

      if (useBatch) {
        try {
          await onDeleteAssets!(realIdsArr);
        } catch (err: any) {
          if (err?.name !== 'AuthorizationError' || err?.message !== 'Asset not found') {
            console.error('Batch delete failed:', err);
            failedRowIds.push(...realIdsArr);
            setDeletedAssetIds((prev) => {
              const next = new Set(prev);
              realIdsArr.forEach((id) => next.delete(id));
              return next;
            });
          }
        }
      } else {
        const results = await Promise.allSettled(
          realIdsArr.map((rowId) => onDeleteAsset!(rowId))
        );
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            const rowId = realIdsArr[i];
            const err = r.reason;
            if (err?.name === 'AuthorizationError' && err?.message === 'Asset not found') return;
            console.error(`Failed to delete asset ${rowId}:`, err);
            failedRowIds.push(rowId);
          }
        });
        if (failedRowIds.length > 0) {
          setDeletedAssetIds((prev) => {
            const next = new Set(prev);
            failedRowIds.forEach((id) => next.delete(id));
            return next;
          });
        }
      }

      const allDeleted = new Set([...tempIds, ...realIds]);
      if (failedRowIds.length === 0) {
        setSelectedCells((prev) => {
          const next = new Set(prev);
          allDeleted.forEach((rowId) => {
            orderedProperties.forEach((p) => next.delete(`${rowId}-${p.key}` as CellKey));
          });
          return next;
        });
        setSelectedRowIds((prev) => {
          const next = new Set(prev);
          allDeleted.forEach((id) => next.delete(id));
          return next;
        });

        // Show success toast for delete row
        const deletedCount = allDeleted.size;
        setToastMessage({
          message: deletedCount === 1 ? '1 row deleted' : `${deletedCount} rows deleted`,
          type: 'success',
        });
        setTimeout(() => setToastMessage(null), 2000);
      }
      // deletedAssetIds cleaned by useEffect when row not in rows (no fixed timeout)
      if (failedRowIds.length > 0) {
        alert(`Failed to delete ${failedRowIds.length} row(s). Please try again.`);
      }
    } catch (e) {
      console.error('Failed to delete rows:', e);
      setDeletedAssetIds((prev) => {
        const next = new Set(prev);
        realIds.forEach((id) => {
          if (!failedRowIds.includes(id)) next.delete(id);
        });
        return next;
      });
    }
  }, [
    selectedCellsRef,
    selectedRowIds,
    orderedProperties,
    getAllRowsForCellSelection,
    onDeleteAsset,
    onDeleteAssets,
    yRows,
    setOptimisticNewAssets,
    setDeleteRowConfirmVisible,
    setDeletedAssetIds,
    setSelectedCells,
    setSelectedRowIds,
  ]);

  const handleDeleteAsset = useCallback(async () => {
    if (!deletingAssetId) return;
    const assetIdToDelete = deletingAssetId;
    const isTemp = assetIdToDelete.startsWith('temp-');
    const asset = rows.find((r) => r.id === assetIdToDelete);
    const assetName = asset?.name || 'Untitled';

    setDeleteConfirmVisible(false);
    setDeletingAssetId(null);
    setContextMenuRowId(null);
    setContextMenuPosition(null);

    if (isTemp) {
      const allRows = yRows.toArray();
      const idx = allRows.findIndex((r) => r.id === assetIdToDelete);
      if (idx >= 0) {
        try {
          yRows.delete(idx, 1);
        } catch (e) {
          console.warn('Failed to remove temp row from Yjs:', e);
        }
      }
      setOptimisticNewAssets((prev) => {
        const next = new Map(prev);
        next.delete(assetIdToDelete);
        return next;
      });
      return;
    }

    if (!onDeleteAsset) return;
    setDeletedAssetIds((prev) => new Set(prev).add(assetIdToDelete));

    try {
      await onDeleteAsset(assetIdToDelete);
      if (enableRealtime && currentUser) {
        await broadcastAssetDelete(assetIdToDelete, assetName);
      }
      // deletedAssetIds cleaned by useEffect when row not in rows (no fixed timeout)
    } catch (e) {
      console.error('Failed to delete asset:', e);
      setDeletedAssetIds((prev) => {
        const next = new Set(prev);
        next.delete(assetIdToDelete);
        return next;
      });
      alert('Failed to delete asset. Please try again.');
    }
  }, [
    deletingAssetId,
    onDeleteAsset,
    rows,
    yRows,
    setOptimisticNewAssets,
    setDeletedAssetIds,
    setDeleteConfirmVisible,
    setDeletingAssetId,
    setContextMenuRowId,
    setContextMenuPosition,
    enableRealtime,
    currentUser,
    broadcastAssetDelete,
  ]);

  return {
    handleInsertRowAbove,
    handleInsertRowBelow,
    handleClearContents,
    handleDeleteRow,
    handleDeleteAsset,
  };
}
