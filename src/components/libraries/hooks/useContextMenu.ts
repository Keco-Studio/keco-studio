import { useCallback } from 'react';
import { AssetRow } from '@/lib/types/libraryAssets';
import { CellKey } from './useCellSelection';

export interface UseContextMenuParams {
  selectedRowIds: Set<string>;
  selectedCells: Set<CellKey>;
  setSelectedCells: React.Dispatch<React.SetStateAction<Set<CellKey>>>;
  setBatchEditMenuVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setBatchEditMenuPosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  setContextMenuRowId: React.Dispatch<React.SetStateAction<string | null>>;
  setContextMenuPosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  contextMenuRowIdRef: React.MutableRefObject<string | null>;
  getCurrentScrollY: () => number;
  adjustMenuPosition: (x: number, y: number) => { x: number; y: number };
  batchEditMenuOriginalPositionRef: React.MutableRefObject<{ x: number; y: number; scrollY: number } | null>;
}

/**
 * Hook to handle context menu (right-click) operations
 * Manages both row context menu and batch edit menu
 */
export function useContextMenu({
  selectedRowIds,
  selectedCells,
  setSelectedCells,
  setBatchEditMenuVisible,
  setBatchEditMenuPosition,
  setContextMenuRowId,
  setContextMenuPosition,
  contextMenuRowIdRef,
  getCurrentScrollY,
  adjustMenuPosition,
  batchEditMenuOriginalPositionRef,
}: UseContextMenuParams) {
  
  /**
   * Handle right-click on row
   */
  const handleRowContextMenu = useCallback((e: React.MouseEvent, row: AssetRow) => {
    e.preventDefault();
    e.stopPropagation();
    
    const scrollY = getCurrentScrollY();
    const menuPos = adjustMenuPosition(e.clientX, e.clientY);
    
    // Save original position with scroll info for scroll tracking
    batchEditMenuOriginalPositionRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollY: scrollY,
    };
    
    // Priority 1: If there are selected rows (via checkbox), use row selection
    // Clear any cell selection first to avoid conflicts
    if (selectedRowIds.size > 0) {
      setSelectedCells(new Set());
      // Show batch edit menu (operations will use selectedRowIds)
      setBatchEditMenuVisible(true);
      setBatchEditMenuPosition(menuPos);
      return;
    }
    
    // Priority 2: If there are selected cells (from drag selection), show batch edit menu
    if (selectedCells.size > 0) {
      setBatchEditMenuVisible(true);
      setBatchEditMenuPosition(menuPos);
      return;
    }
    
    // Priority 3: Otherwise show normal row context menu
    setContextMenuRowId(row.id);
    contextMenuRowIdRef.current = row.id;
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  }, [
    selectedRowIds,
    selectedCells,
    setSelectedCells,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
    setContextMenuRowId,
    setContextMenuPosition,
    contextMenuRowIdRef,
    getCurrentScrollY,
    adjustMenuPosition,
    batchEditMenuOriginalPositionRef,
  ]);

  /**
   * Handle right-click on cell for batch edit
   */
  const handleCellContextMenu = useCallback((
    e: React.MouseEvent,
    rowId: string,
    propertyKey: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    const scrollY = getCurrentScrollY();
    const menuPos = adjustMenuPosition(e.clientX, e.clientY);
    
    // Save original position with scroll info for scroll tracking
    batchEditMenuOriginalPositionRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollY: scrollY,
    };
    
    // Priority 1: If there are selected rows (via checkbox), use row selection
    // Clear any cell selection first to avoid conflicts
    if (selectedRowIds.size > 0) {
      setSelectedCells(new Set());
      // Show batch edit menu (operations will use selectedRowIds)
      setBatchEditMenuVisible(true);
      setBatchEditMenuPosition(menuPos);
      return;
    }
    
    // Priority 2: If there are already selected cells (from drag selection), use them
    if (selectedCells.size > 0) {
      setBatchEditMenuVisible(true);
      setBatchEditMenuPosition(menuPos);
      return;
    }
    
    // Priority 3: Otherwise, if this cell is not selected, select it first
    const cellKey: CellKey = `${rowId}-${propertyKey}` as CellKey;
    if (!selectedCells.has(cellKey)) {
      setSelectedCells(new Set([cellKey]));
    }
    
    // Show batch edit menu
    setBatchEditMenuVisible(true);
    setBatchEditMenuPosition(menuPos);
  }, [
    selectedRowIds,
    selectedCells,
    setSelectedCells,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
    getCurrentScrollY,
    adjustMenuPosition,
    batchEditMenuOriginalPositionRef,
  ]);

  return {
    handleRowContextMenu,
    handleCellContextMenu,
  };
}

