import { useCallback } from 'react';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { CellKey } from './useCellSelection';
import type { SupabaseClient } from '@supabase/supabase-js';

// Compatible interface for yRows (supports both Y.Array and mock objects)
interface YRowsLike {
  length: number;
  toArray: () => AssetRow[];
  insert: (index: number, content: AssetRow[]) => void;
  delete: (index: number, length: number) => void;
}

export type UseRowOperationsParams = {
  onSaveAsset?: (assetName: string, propertyValues: Record<string, any>, options?: { createdAt?: Date }) => Promise<void>;
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  onDeleteAsset?: (assetId: string) => Promise<void>;
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
  setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, { name: string; propertyValues: Record<string, any> }>>>;
  setDeletedAssetIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setToastMessage: React.Dispatch<React.SetStateAction<string | null>>;
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

/**
 * useRowOperations - 行操作：在上方/下方插入行、清空内容、删除行、删除单个资产
 */
export function useRowOperations(params: UseRowOperationsParams) {
  const {
    onSaveAsset,
    onUpdateAsset,
    onDeleteAsset,
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

    const allRows = yRows.toArray();
    const sortedRowIds = Array.from(rowsToUse).sort((a, b) => {
      const indexA = allRows.findIndex((r) => r.id === a);
      const indexB = allRows.findIndex((r) => r.id === b);
      return indexA - indexB;
    });

    const numRowsToInsert = sortedRowIds.length;
    const firstRowId = sortedRowIds[0];
    closeRowOpMenus(setBatchEditMenuVisible, setBatchEditMenuPosition, setContextMenuRowId, setContextMenuPosition, contextMenuRowIdRef);
    setIsSaving(true);

    try {
      const targetRowIndex = allRows.findIndex((r) => r.id === firstRowId);
      if (targetRowIndex === -1) {
        setIsSaving(false);
        return;
      }

      if (supabase) {
        const { data: targetRowData, error: queryError } = await supabase
          .from('library_assets')
          .select('created_at')
          .eq('id', firstRowId)
          .single();

        if (queryError) {
          setIsSaving(false);
          setToastMessage('Failed to insert rows above');
          setTimeout(() => setToastMessage(null), 2000);
          return;
        }

        const targetCreatedAt = new Date(targetRowData.created_at);
        const createdTempIds: string[] = [];
        const optimisticAssets: AssetRow[] = [];

        for (let i = 0; i < numRowsToInsert; i++) {
          const offsetMs = (numRowsToInsert - i) * 1000;
          const newCreatedAt = new Date(targetCreatedAt.getTime() - offsetMs);
          const tempId = `temp-insert-above-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
          createdTempIds.push(tempId);
          optimisticAssets.push({
            id: tempId,
            libraryId: library.id,
            name: 'Untitled',
            propertyValues: {},
          });
        }

        for (let i = optimisticAssets.length - 1; i >= 0; i--) {
          yRows.insert(targetRowIndex, [optimisticAssets[i]]);
        }
        optimisticAssets.forEach((asset) => {
          setOptimisticNewAssets((prev) => {
            const newMap = new Map(prev);
            newMap.set(asset.id, asset);
            return newMap;
          });
        });

        for (let i = 0; i < numRowsToInsert; i++) {
          const offsetMs = (numRowsToInsert - i) * 1000;
          const newCreatedAt = new Date(targetCreatedAt.getTime() - offsetMs);
          await onSaveAsset('Untitled', {}, { createdAt: newCreatedAt });
          if (enableRealtime && currentUser && i < optimisticAssets.length) {
            try {
              await broadcastAssetCreate(createdTempIds[i], optimisticAssets[i].name, optimisticAssets[i].propertyValues, { insertBeforeRowId: firstRowId });
            } catch (e) {
              console.error('Failed to broadcast asset creation:', e);
            }
          }
        }
      } else {
        const createdTempIds: string[] = [];
        const optimisticAssets: AssetRow[] = [];
        for (let i = 0; i < numRowsToInsert; i++) {
          const tempId = `temp-insert-above-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
          createdTempIds.push(tempId);
          optimisticAssets.push({ id: tempId, libraryId: library.id, name: 'Untitled', propertyValues: {} });
        }
        for (let i = optimisticAssets.length - 1; i >= 0; i--) {
          yRows.insert(targetRowIndex, [optimisticAssets[i]]);
        }
        optimisticAssets.forEach((asset) => {
          setOptimisticNewAssets((prev) => {
            const newMap = new Map(prev);
            newMap.set(asset.id, asset);
            return newMap;
          });
        });
        for (let i = 0; i < numRowsToInsert; i++) {
          await onSaveAsset('Untitled', {});
          if (enableRealtime && currentUser && i < optimisticAssets.length) {
            try {
              await broadcastAssetCreate(createdTempIds[i], optimisticAssets[i].name, optimisticAssets[i].propertyValues, { insertBeforeRowId: firstRowId });
            } catch (e) {
              console.error('Failed to broadcast asset creation:', e);
            }
          }
        }
      }

      await new Promise((r) => setTimeout(r, 500));
      setToastMessage(numRowsToInsert === 1 ? '1 row inserted' : `${numRowsToInsert} rows inserted`);
      setTimeout(() => setToastMessage(null), 2000);
    } catch (e) {
      console.error('Failed to insert rows above:', e);
      setToastMessage('Failed to insert rows above');
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
    yRows,
    setOptimisticNewAssets,
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

    const allRows = yRows.toArray();
    const sortedRowIds = Array.from(rowsToUse).sort((a, b) => {
      const indexA = allRows.findIndex((r) => r.id === a);
      const indexB = allRows.findIndex((r) => r.id === b);
      return indexA - indexB;
    });

    const numRowsToInsert = sortedRowIds.length;
    const lastRowId = sortedRowIds[sortedRowIds.length - 1];
    closeRowOpMenus(setBatchEditMenuVisible, setBatchEditMenuPosition, setContextMenuRowId, setContextMenuPosition, contextMenuRowIdRef);
    setIsSaving(true);

    try {
      const allRows2 = yRows.toArray();
      const targetRowIndex = allRows2.findIndex((r) => r.id === lastRowId);
      if (targetRowIndex === -1) {
        setIsSaving(false);
        return;
      }

      if (supabase) {
        const { data: targetRowData, error: queryError } = await supabase
          .from('library_assets')
          .select('created_at')
          .eq('id', lastRowId)
          .single();

        if (queryError) {
          setIsSaving(false);
          setToastMessage('Failed to insert rows below');
          setTimeout(() => setToastMessage(null), 2000);
          return;
        }

        const targetCreatedAt = new Date(targetRowData.created_at);
        const createdTempIds: string[] = [];
        const optimisticAssets: AssetRow[] = [];

        for (let i = 0; i < numRowsToInsert; i++) {
          const offsetMs = (i + 1) * 1000;
          const newCreatedAt = new Date(targetCreatedAt.getTime() + offsetMs);
          const tempId = `temp-insert-below-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
          createdTempIds.push(tempId);
          optimisticAssets.push({ id: tempId, libraryId: library.id, name: 'Untitled', propertyValues: {} });
        }

        const insertIndex = targetRowIndex + 1;
        for (let i = optimisticAssets.length - 1; i >= 0; i--) {
          yRows.insert(insertIndex, [optimisticAssets[i]]);
        }
        optimisticAssets.forEach((asset) => {
          setOptimisticNewAssets((prev) => {
            const newMap = new Map(prev);
            newMap.set(asset.id, asset);
            return newMap;
          });
        });

        for (let i = 0; i < numRowsToInsert; i++) {
          const offsetMs = (i + 1) * 1000;
          const newCreatedAt = new Date(targetCreatedAt.getTime() + offsetMs);
          await onSaveAsset('Untitled', {}, { createdAt: newCreatedAt });
          if (enableRealtime && currentUser && i < optimisticAssets.length) {
            try {
              await broadcastAssetCreate(createdTempIds[i], optimisticAssets[i].name, optimisticAssets[i].propertyValues, { insertAfterRowId: lastRowId });
            } catch (e) {
              console.error('Failed to broadcast asset creation:', e);
            }
          }
        }
      } else {
        const createdTempIds: string[] = [];
        const optimisticAssets: AssetRow[] = [];
        for (let i = 0; i < numRowsToInsert; i++) {
          const tempId = `temp-insert-below-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
          createdTempIds.push(tempId);
          optimisticAssets.push({ id: tempId, libraryId: library.id, name: 'Untitled', propertyValues: {} });
        }
        const insertIndex = targetRowIndex + 1;
        for (let i = optimisticAssets.length - 1; i >= 0; i--) {
          yRows.insert(insertIndex, [optimisticAssets[i]]);
        }
        optimisticAssets.forEach((asset) => {
          setOptimisticNewAssets((prev) => {
            const newMap = new Map(prev);
            newMap.set(asset.id, asset);
            return newMap;
          });
        });
        for (let i = 0; i < numRowsToInsert; i++) {
          await onSaveAsset('Untitled', {});
          if (enableRealtime && currentUser && i < optimisticAssets.length) {
            try {
              await broadcastAssetCreate(createdTempIds[i], optimisticAssets[i].name, optimisticAssets[i].propertyValues, { insertAfterRowId: lastRowId });
            } catch (e) {
              console.error('Failed to broadcast asset creation:', e);
            }
          }
        }
      }

      await new Promise((r) => setTimeout(r, 500));
      setToastMessage(numRowsToInsert === 1 ? '1 row inserted' : `${numRowsToInsert} rows inserted`);
      setTimeout(() => setToastMessage(null), 2000);
    } catch (e) {
      console.error('Failed to insert rows below:', e);
      setToastMessage('Failed to insert rows below');
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
    yRows,
    setOptimisticNewAssets,
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
    if (!onUpdateAsset) {
      setClearContentsConfirmVisible(false);
      return;
    }

    const allRowsForSelection = getAllRowsForCellSelection();
    const cellsByRow = new Map<string, { propertyValues: Record<string, any>; assetName: string | null }>();

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
          const rowData = cellsByRow.get(rowId)!;
          const prop = orderedProperties[propertyIndex];
          const isNameField = propertyIndex === 0;
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
        if (row) {
          const originalName = row.name || 'Untitled';
          newMap.set(rowId, { name: originalName, propertyValues: { ...rowData.propertyValues } });
        }
      }
      return newMap;
    });

    setIsSaving(true);
    try {
      for (const [rowId, rowData] of cellsByRow.entries()) {
        const row = allRowsForSelection.find((r) => r.id === rowId);
        if (row) {
          const assetName = rowData.assetName !== null ? rowData.assetName : (row.name || 'Untitled');
          await onUpdateAsset(rowId, assetName, rowData.propertyValues);
        }
      }
      setTimeout(() => {
        setOptimisticEditUpdates((prev) => {
          const newMap = new Map(prev);
          for (const rowId of cellsByRow.keys()) newMap.delete(rowId);
          return newMap;
        });
      }, 500);
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

    if (realIds.size > 0 && !onDeleteAsset) {
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

      // Delete real rows via API
      for (const rowId of realIds) {
        setDeletedAssetIds((prev) => new Set(prev).add(rowId));
        try {
          await onDeleteAsset!(rowId);
        } catch (err: any) {
          if (err?.name === 'AuthorizationError' && err?.message === 'Asset not found') continue;
          console.error(`Failed to delete asset ${rowId}:`, err);
          failedRowIds.push(rowId);
          setDeletedAssetIds((prev) => {
            const next = new Set(prev);
            next.delete(rowId);
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
      }
      setTimeout(() => {
        realIds.forEach((rowId) => {
          if (!failedRowIds.includes(rowId)) {
            setDeletedAssetIds((prev) => {
              const next = new Set(prev);
              next.delete(rowId);
              return next;
            });
          }
        });
      }, 100);
      if (failedRowIds.length > 0) {
        alert(`Failed to delete ${failedRowIds.length} row(s). Please try again.`);
      }
    } catch (e) {
      console.error('Failed to delete rows:', e);
      realIds.forEach((rowId) => {
        if (!failedRowIds.includes(rowId)) {
          setDeletedAssetIds((prev) => {
            const next = new Set(prev);
            next.delete(rowId);
            return next;
          });
        }
      });
    }
  }, [
    selectedCellsRef,
    selectedRowIds,
    orderedProperties,
    getAllRowsForCellSelection,
    onDeleteAsset,
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
      setTimeout(() => {
        setDeletedAssetIds((prev) => {
          const next = new Set(prev);
          next.delete(assetIdToDelete);
          return next;
        });
      }, 100);
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
