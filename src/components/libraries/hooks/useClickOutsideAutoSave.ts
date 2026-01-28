import { useEffect } from 'react';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

type YRows = {
  toArray: () => AssetRow[];
  delete: (index: number, count: number) => void;
  insert: (index: number, rows: AssetRow[]) => void;
};

type OptimisticEditUpdate = { name: string; propertyValues: Record<string, any> };

export type UseClickOutsideAutoSaveParams = {
  tableContainerRef: React.RefObject<HTMLDivElement | null>;
  isAddingRow: boolean;
  newRowData: Record<string, any>;
  setIsAddingRow: (v: boolean | ((prev: boolean) => boolean)) => void;
  setNewRowData: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  isSaving: boolean;
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>;
  referenceModalOpen: boolean;
  onSaveAsset?: (assetName: string, propertyValues: Record<string, any>, options?: { createdAt?: Date }) => Promise<void>;
  library: { id: string; name: string; description?: string | null } | null;
  properties: PropertyConfig[];
  setOptimisticNewAssets: React.Dispatch<React.SetStateAction<Map<string, AssetRow>>>;
  editingCell: { rowId: string; propertyKey: string } | null;
  editingCellValue: string;
  setEditingCell: React.Dispatch<React.SetStateAction<{ rowId: string; propertyKey: string } | null>>;
  setEditingCellValue: React.Dispatch<React.SetStateAction<string>>;
  setCurrentFocusedCell: React.Dispatch<React.SetStateAction<{ assetId: string; propertyKey: string } | null>>;
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  rows: AssetRow[];
  yRows: YRows;
  setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, OptimisticEditUpdate>>>;
  presenceTracking?: {
    updateActiveCell: (assetId: string | null, propertyKey: string | null) => void;
    getUsersEditingCell: (assetId: string, propertyKey: string) => unknown[];
  };
};

/**
 * useClickOutsideAutoSave
 * Listens for mousedown outside the table container when adding a row or editing a cell.
 * - Add row: auto-save new asset (or create blank) / cancel; then remove listener.
 * - Edit cell: auto-save edited cell; then remove listener.
 */
export function useClickOutsideAutoSave(params: UseClickOutsideAutoSaveParams) {
  const {
    tableContainerRef,
    isAddingRow,
    newRowData,
    setIsAddingRow,
    setNewRowData,
    isSaving,
    setIsSaving,
    referenceModalOpen,
    onSaveAsset,
    library,
    properties,
    setOptimisticNewAssets,
    editingCell,
    editingCellValue,
    setEditingCell,
    setEditingCellValue,
    setCurrentFocusedCell,
    onUpdateAsset,
    rows,
    yRows,
    setOptimisticEditUpdates,
    presenceTracking,
  } = params;

  useEffect(() => {
    const handleClickOutside = async (event: MouseEvent) => {
      if (isSaving) return;
      if (referenceModalOpen) return;

      const target = event.target as Node;
      const el = target as Element;
      if (
        el.closest &&
        (el.closest('[role="dialog"]') ||
          el.closest('.ant-modal') ||
          el.closest('[class*="modal"]') ||
          el.closest('[class*="Modal"]') ||
          el.closest('.ant-select-dropdown') ||
          el.closest('[class*="select-dropdown"]') ||
          el.closest('.rc-select-dropdown'))
      ) {
        return;
      }

      if (!tableContainerRef.current || tableContainerRef.current.contains(target)) return;

      if (isAddingRow) {
        const hasData = Object.keys(newRowData).some((key) => {
          const v = newRowData[key];
          return v != null && v !== '';
        });

        if (hasData && onSaveAsset && library) {
          // Find the name field (identified by label='name' and dataType='string')
          const nameField = properties.find(p => p.name === 'name' && p.dataType === 'string');
          const assetName = nameField ? (newRowData[nameField.id] ?? newRowData[nameField.key] ?? 'Untitled') : 'Untitled';
          const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const optimisticAsset: AssetRow = {
            id: tempId,
            libraryId: library.id,
            name: String(assetName),
            propertyValues: { ...newRowData },
          };
          setOptimisticNewAssets((prev) => {
            const next = new Map(prev);
            next.set(tempId, optimisticAsset);
            return next;
          });
          setIsAddingRow(false);
          const saved = { ...newRowData };
          setNewRowData({});
          setIsSaving(true);
          try {
            await onSaveAsset(assetName, saved);
            setTimeout(() => {
              setOptimisticNewAssets((prev) => {
                if (!prev.has(tempId)) return prev;
                const next = new Map(prev);
                next.delete(tempId);
                return next;
              });
            }, 2000);
          } catch (e) {
            console.error('Failed to save asset:', e);
            setOptimisticNewAssets((prev) => {
              const next = new Map(prev);
              next.delete(tempId);
              return next;
            });
            setIsAddingRow(true);
            setNewRowData(saved);
          } finally {
            setIsSaving(false);
          }
          return;
        }

        if (!hasData && onSaveAsset && library) {
          const assetName = 'Untitled';
          const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const optimisticAsset: AssetRow = {
            id: tempId,
            libraryId: library.id,
            name: assetName,
            propertyValues: {},
          };
          setOptimisticNewAssets((prev) => {
            const next = new Map(prev);
            next.set(tempId, optimisticAsset);
            return next;
          });
          setIsAddingRow(false);
          setNewRowData({});
          setIsSaving(true);
          try {
            await onSaveAsset(assetName, {});
            setTimeout(() => {
              setOptimisticNewAssets((prev) => {
                if (!prev.has(tempId)) return prev;
                const next = new Map(prev);
                next.delete(tempId);
                return next;
              });
            }, 2000);
          } catch (e) {
            console.error('Failed to save blank asset:', e);
            setOptimisticNewAssets((prev) => {
              const next = new Map(prev);
              next.delete(tempId);
              return next;
            });
            setIsAddingRow(true);
          } finally {
            setIsSaving(false);
          }
          return;
        }

        setIsAddingRow(false);
        setNewRowData({});
        return;
      }

      if (editingCell && onUpdateAsset) {
        const { rowId, propertyKey } = editingCell;
        const row = rows.find((r) => r.id === rowId);
        if (!row) return;

        const prop = properties.find((p) => p.key === propertyKey);
        const isNameField = prop && properties[0]?.key === propertyKey;
        const updatedPropertyValues = { ...row.propertyValues, [propertyKey]: editingCellValue };
        const assetName = isNameField ? editingCellValue : (row.name || 'Untitled');

        const allRows = yRows.toArray();
        const rowIndex = allRows.findIndex((r) => r.id === rowId);
        if (rowIndex >= 0) {
          const existing = allRows[rowIndex];
          yRows.delete(rowIndex, 1);
          yRows.insert(rowIndex, [
            { ...existing, name: String(assetName), propertyValues: updatedPropertyValues },
          ]);
        }

        setOptimisticEditUpdates((prev) => {
          const next = new Map(prev);
          next.set(rowId, { name: String(assetName), propertyValues: updatedPropertyValues });
          return next;
        });

        const savedValue = editingCellValue;
        setEditingCell(null);
        setEditingCellValue('');
        setCurrentFocusedCell(null);
        setTimeout(() => presenceTracking?.updateActiveCell(null, null), 1000);
        setIsSaving(true);

        onUpdateAsset(rowId, assetName, updatedPropertyValues)
          .then(() => {
            setTimeout(() => {
              setOptimisticEditUpdates((prev) => {
                const next = new Map(prev);
                next.delete(rowId);
                return next;
              });
            }, 500);
          })
          .catch((err) => {
            console.error('Failed to update cell:', err);
            setOptimisticEditUpdates((prev) => {
              const next = new Map(prev);
              next.delete(rowId);
              return next;
            });
            setEditingCell({ rowId, propertyKey });
            setEditingCellValue(savedValue);
          })
          .finally(() => setIsSaving(false));
      }
    };

    if (!isAddingRow && !editingCell) return;

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [
    isAddingRow,
    editingCell,
    editingCellValue,
    isSaving,
    newRowData,
    onSaveAsset,
    onUpdateAsset,
    properties,
    rows,
    referenceModalOpen,
    tableContainerRef,
    library,
    setIsAddingRow,
    setNewRowData,
    setIsSaving,
    setOptimisticNewAssets,
    setEditingCell,
    setEditingCellValue,
    setCurrentFocusedCell,
    setOptimisticEditUpdates,
    yRows,
    presenceTracking,
  ]);
}
