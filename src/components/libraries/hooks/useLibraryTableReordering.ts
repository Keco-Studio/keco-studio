import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { reorderLibraryFields } from '@/lib/services/libraryAssetsService';
import { invalidateLibrarySchemaData } from '@/lib/queryInvalidation';
import { applyLibraryTableOperation } from '@/lib/services/libraryTableOperationsService';
import { buildFieldReorderOperation, buildRowReorderOperation } from '@/lib/library/tableOperationSnapshots';
import { moveItemAtEdge, orderItemsById, type DropEdge } from '../utils/tableReorder';
import { sortRowsByNumericColumn, type NumericSortDirection } from '../utils/tableNumericSorting';
import { useColumnValueFilters } from './useColumnValueFilters';
import { useLibraryTableStructure } from './useLibraryTableStructure';

export type LibraryTableOperationHistory = {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  record: (operationId: string) => void;
};

type ToastMessage = { message: string; type: 'success' | 'error' | 'default' } | null;

type UseLibraryTableReorderingParams = {
  library: { id: string } | null;
  properties: PropertyConfig[];
  resolvedRows: AssetRow[];
  assetNamesCache: Parameters<typeof useColumnValueFilters>[2];
  isSaving: boolean;
  canEditColumns: boolean;
  isVersionPreview: boolean;
  supabase: SupabaseClient;
  reorderRows: (rows: AssetRow[]) => Promise<void>;
  broadcastSchemaChange: () => Promise<void>;
  refreshAssetsFromServer: () => Promise<void>;
  tableOperationHistory?: LibraryTableOperationHistory;
  setToastMessage: Dispatch<SetStateAction<ToastMessage>>;
};

export function useLibraryTableReordering({
  library,
  properties,
  resolvedRows,
  assetNamesCache,
  isSaving,
  canEditColumns,
  isVersionPreview,
  supabase,
  reorderRows,
  broadcastSchemaChange,
  refreshAssetsFromServer,
  tableOperationHistory,
  setToastMessage,
}: UseLibraryTableReorderingParams) {
  const queryClient = useQueryClient();
  const [columnOrder, setColumnOrder] = useState<string[] | null>(null);
  const [rowOrder, setRowOrder] = useState<string[] | null>(null);
  const [numericSort, setNumericSort] = useState<{ propertyId: string; direction: NumericSortDirection } | null>(null);
  const [reordering, setReordering] = useState(false);
  const reorderPendingRef = useRef(false);
  const propertiesForDisplay = useMemo(
    () => columnOrder
      ? orderItemsById(properties, columnOrder).map((property, index) => ({ ...property, orderIndex: index }))
      : properties,
    [columnOrder, properties],
  );
  const { orderedProperties, scriptColumns, hasScriptColumns } =
    useLibraryTableStructure(propertiesForDisplay);
  const {
    filteredRows,
    applyColumnFilter,
    isColumnFiltered,
    getCheckedFilterValues,
  } = useColumnValueFilters(
    orderItemsById(resolvedRows, rowOrder),
    orderedProperties,
    assetNamesCache,
  );
  const displayRows = useMemo(
    () => numericSort
      ? sortRowsByNumericColumn(filteredRows, numericSort.propertyId, numericSort.direction)
      : filteredRows,
    [filteredRows, numericSort],
  );
  const canReorder = canEditColumns && !isSaving && !reordering && !isVersionPreview;

  const handleToggleNumericSort = useCallback((propertyId: string) => {
    setNumericSort((current) => {
      if (current?.propertyId !== propertyId) return { propertyId, direction: 'asc' };
      if (current.direction === 'asc') return { propertyId, direction: 'desc' };
      return null;
    });
  }, []);

  const handleColumnReorder = useCallback(async (activeId: string, overId: string, edge: DropEdge) => {
    if (!library || !canReorder || reorderPendingRef.current) return;
    const previousOrder = columnOrder;
    const next = moveItemAtEdge(orderedProperties, activeId, overId, edge);
    if (next.every((property, index) => property.id === orderedProperties[index]?.id)) return;
    reorderPendingRef.current = true;
    setReordering(true);
    setColumnOrder(next.map((property) => property.id));
    try {
      if (tableOperationHistory) {
        const result = await applyLibraryTableOperation(
          supabase,
          library.id,
          buildFieldReorderOperation(orderedProperties, next.map((property) => property.id)),
        );
        tableOperationHistory.record(result.operationId);
        await refreshAssetsFromServer();
      } else {
        await reorderLibraryFields(supabase, library.id, next.map((property) => property.id));
      }
      await broadcastSchemaChange().catch((error) => console.error('Failed to broadcast schema change', error));
      await invalidateLibrarySchemaData(queryClient, { libraryId: library.id, refetchActiveSchema: true });
      setColumnOrder(null);
    } catch (error) {
      setColumnOrder(previousOrder);
      setToastMessage({ message: error instanceof Error ? error.message : 'Failed to move column', type: 'error' });
    } finally {
      reorderPendingRef.current = false;
      setReordering(false);
    }
  }, [broadcastSchemaChange, canReorder, columnOrder, library, orderedProperties, queryClient, refreshAssetsFromServer, supabase, tableOperationHistory]);

  const handleRowReorder = useCallback(async (activeId: string, overId: string, edge: DropEdge) => {
    if (!canReorder || reorderPendingRef.current || resolvedRows.some((row) => row.id.startsWith('temp-'))) return;
    const allRows = orderItemsById(resolvedRows, rowOrder);
    const previousOrder = rowOrder;
    const next = moveItemAtEdge(allRows, activeId, overId, edge);
    if (next.every((row, index) => row.id === allRows[index]?.id)) return;
    reorderPendingRef.current = true;
    setReordering(true);
    setRowOrder(next.map((row) => row.id));
    try {
      if (tableOperationHistory && library) {
        const result = await applyLibraryTableOperation(
          supabase,
          library.id,
          buildRowReorderOperation(allRows, next.map((row) => row.id)),
        );
        tableOperationHistory.record(result.operationId);
        await refreshAssetsFromServer();
      } else {
        await reorderRows(next);
      }
      setRowOrder(null);
    } catch (error) {
      setRowOrder(previousOrder);
      setToastMessage({ message: error instanceof Error ? error.message : 'Failed to move row', type: 'error' });
    } finally {
      reorderPendingRef.current = false;
      setReordering(false);
    }
  }, [canReorder, library, refreshAssetsFromServer, reorderRows, resolvedRows, rowOrder, supabase, tableOperationHistory]);

  return {
    orderedProperties,
    scriptColumns,
    hasScriptColumns,
    rowOrder,
    displayRows,
    applyColumnFilter,
    isColumnFiltered,
    getCheckedFilterValues,
    numericSort,
    canReorder,
    handleToggleNumericSort,
    handleColumnReorder,
    handleRowReorder,
  };
}
