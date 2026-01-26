import { useState, useRef, useCallback, useEffect } from 'react';
import type { PropertyConfig } from '@/lib/types/libraryAssets';
import type { AssetRow } from '@/lib/types/libraryAssets';

export type CellKey = `${string}-${string}`;

export type SelectionBounds = {
  minRowIndex: number;
  maxRowIndex: number;
  minPropertyIndex: number;
  maxPropertyIndex: number;
};

export type SelectionBorderClassNames = {
  selectionBorderTop: string;
  selectionBorderBottom: string;
  selectionBorderLeft: string;
  selectionBorderRight: string;
};

/**
 * useCellSelection - Handle cell and row selection, drag-to-select, fill-drag (Excel-like fill down)
 *
 * Core responsibilities:
 * - Row selection (checkbox)
 * - Cell click selection
 * - Drag from cell to select rectangle (handleCellFillDragStart)
 * - Drag from expand icon for fill down (handleCellDragStart)
 * - Selection bounds for border rendering
 * - getSelectionBorderClasses helper
 */
export function useCellSelection({
  orderedProperties,
  getAllRowsForCellSelection,
  fillDown,
  currentFocusedCell,
  handleCellBlur,
  selectionBorderClassNames,
}: {
  orderedProperties: PropertyConfig[];
  getAllRowsForCellSelection: () => AssetRow[];
  fillDown: (startRowId: string, endRowId: string, propertyKey: string) => Promise<void>;
  currentFocusedCell: { assetId: string; propertyKey: string } | null;
  handleCellBlur: () => void;
  selectionBorderClassNames: SelectionBorderClassNames;
}) {
  // Row selection state (for checkbox selection)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  // Cell selection state (for drag selection)
  const [selectedCells, setSelectedCells] = useState<Set<CellKey>>(new Set());
  const selectedCellsRef = useRef<Set<CellKey>>(new Set());

  const [dragStartCell, setDragStartCell] = useState<{ rowId: string; propertyKey: string } | null>(null);
  const [dragCurrentCell, setDragCurrentCell] = useState<{ rowId: string; propertyKey: string } | null>(null);
  const isDraggingCellsRef = useRef(false);
  const dragCurrentCellRef = useRef<{ rowId: string; propertyKey: string } | null>(null);

  // Fill drag state (for Excel-like fill down functionality)
  const [fillDragStartCell, setFillDragStartCell] = useState<{
    rowId: string;
    propertyKey: string;
    startY: number;
  } | null>(null);
  const isFillingCellsRef = useRef(false);

  // Track hover state for expand icon
  const [hoveredCellForExpand, setHoveredCellForExpand] = useState<{
    rowId: string;
    propertyKey: string;
  } | null>(null);

  // Selection bounds for multiple cell selection border rendering
  const [selectionBounds, setSelectionBounds] = useState<SelectionBounds | null>(null);

  // Handle row selection toggle
  const handleRowSelectionToggle = useCallback((rowId: string, e?: React.MouseEvent | MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  // Handle cell click (select single cell)
  const handleCellClick = useCallback(
    (rowId: string, propertyKey: string, e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('.ant-checkbox') ||
        target.closest('.ant-select') ||
        target.closest('.ant-switch') ||
        target.closest('input') ||
        target.closest('select') ||
        target.closest('.cellExpandIcon')
      ) {
        return;
      }
      if (isFillingCellsRef.current) {
        return;
      }
      const currentCellKey: CellKey = `${rowId}-${propertyKey}` as CellKey;
      const referenceBackground = target.closest('[data-reference-background="true"]');
      if (selectedCells.has(currentCellKey) && referenceBackground) {
        return;
      }
      e.stopPropagation();
      if (
        currentFocusedCell &&
        (currentFocusedCell.assetId !== rowId || currentFocusedCell.propertyKey !== propertyKey)
      ) {
        handleCellBlur();
      }
      const cellKey: CellKey = `${rowId}-${propertyKey}` as CellKey;
      setSelectedCells(new Set<CellKey>([cellKey]));
      setDragStartCell({ rowId, propertyKey });
      setDragCurrentCell(null);
    },
    [selectedCells, currentFocusedCell, handleCellBlur]
  );

  // Handle cell drag selection start (from cell - multi-selection rectangle)
  const handleCellFillDragStart = useCallback(
    (rowId: string, propertyKey: string, e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('.ant-checkbox') ||
        target.closest('.ant-select') ||
        target.closest('.ant-switch') ||
        target.closest('input') ||
        target.closest('select') ||
        target.closest('.cellExpandIcon')
      ) {
        return;
      }
      const cellKey: CellKey = `${rowId}-${propertyKey}` as CellKey;
      if (selectedCells.has(cellKey) && target.closest('[data-reference-background="true"]')) {
        return;
      }
      if (!selectedCells.has(cellKey) || selectedCells.size !== 1) {
        return;
      }
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      isDraggingCellsRef.current = true;
      const startCell = { rowId, propertyKey };
      setDragStartCell(startCell);
      setDragCurrentCell(startCell);
      dragCurrentCellRef.current = startCell;

      const dragMoveHandler = (moveEvent: MouseEvent) => {
        if (!isDraggingCellsRef.current) return;
        const elementBelow = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        if (!elementBelow) return;
        const cellElement = elementBelow.closest('td');
        if (!cellElement) return;
        const rowElement = cellElement.closest('tr');
        if (
          !rowElement ||
          rowElement.classList.contains('headerRowTop') ||
          rowElement.classList.contains('headerRowBottom') ||
          rowElement.classList.contains('editRow') ||
          rowElement.classList.contains('addRow')
        ) {
          return;
        }
        const currentRowId = rowElement.getAttribute('data-row-id');
        const currentPropertyKey = cellElement.getAttribute('data-property-key');
        if (currentRowId && currentPropertyKey) {
          const newCell = { rowId: currentRowId, propertyKey: currentPropertyKey };
          dragCurrentCellRef.current = newCell;
          setDragCurrentCell(newCell);
        }
      };

      const dragEndHandler = () => {
        if (!isDraggingCellsRef.current) return;
        isDraggingCellsRef.current = false;
        document.removeEventListener('mousemove', dragMoveHandler);
        document.removeEventListener('mouseup', dragEndHandler);
        document.body.style.userSelect = '';
        const allRowsForSelection = getAllRowsForCellSelection();
        const endCell = dragCurrentCellRef.current || { rowId, propertyKey };
        const startRowIndex = allRowsForSelection.findIndex(r => r.id === rowId);
        const endRowIndex = allRowsForSelection.findIndex(r => r.id === endCell.rowId);
        const startPropertyIndex = orderedProperties.findIndex(p => p.key === propertyKey);
        const endPropertyIndex = orderedProperties.findIndex(p => p.key === endCell.propertyKey);
        if (
          startRowIndex !== -1 &&
          endRowIndex !== -1 &&
          startPropertyIndex !== -1 &&
          endPropertyIndex !== -1
        ) {
          const rowStart = Math.min(startRowIndex, endRowIndex);
          const rowEnd = Math.max(startRowIndex, endRowIndex);
          const propStart = Math.min(startPropertyIndex, endPropertyIndex);
          const propEnd = Math.max(startPropertyIndex, endPropertyIndex);
          const cellsToSelect = new Set<CellKey>();
          for (let r = rowStart; r <= rowEnd; r++) {
            const row = allRowsForSelection[r];
            for (let p = propStart; p <= propEnd; p++) {
              const property = orderedProperties[p];
              cellsToSelect.add(`${row.id}-${property.key}`);
            }
          }
          setSelectedCells(cellsToSelect);
        } else {
          setSelectedCells(new Set<CellKey>([`${rowId}-${propertyKey}` as CellKey]));
        }
        setDragStartCell(null);
        setDragCurrentCell(null);
        dragCurrentCellRef.current = null;
      };

      document.addEventListener('mousemove', dragMoveHandler);
      document.addEventListener('mouseup', dragEndHandler);
      document.body.style.userSelect = 'none';
    },
    [selectedCells, getAllRowsForCellSelection, orderedProperties]
  );

  // Handle cell fill drag start (from expand icon - Excel-like fill down)
  const handleCellDragStart = useCallback(
    (rowId: string, propertyKey: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const cellKey: CellKey = `${rowId}-${propertyKey}` as CellKey;
      if (!selectedCells.has(cellKey) || selectedCells.size !== 1) {
        return;
      }
      const property = orderedProperties.find(p => p.key === propertyKey);
      if (!property || !['string', 'int', 'float'].includes(property.dataType)) {
        return;
      }
      const startRowId = rowId;
      const startPropertyKey = propertyKey;
      const startX = e.clientX;
      const startY = e.clientY;
      let hasMoved = false;
      let isClick = true;
      const DRAG_THRESHOLD = 5;

      const fillDragMoveHandler = (moveEvent: MouseEvent) => {
        const deltaX = Math.abs(moveEvent.clientX - startX);
        const deltaY = Math.abs(moveEvent.clientY - startY);
        if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
          hasMoved = true;
          isClick = false;
          if (!isFillingCellsRef.current) {
            isFillingCellsRef.current = true;
            setFillDragStartCell({ rowId: startRowId, propertyKey: startPropertyKey, startY });
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'crosshair';
            document.body.classList.add('filling-cells');
          }
        }
        if (!hasMoved || !isFillingCellsRef.current) return;
        document.body.style.cursor = 'crosshair';
        const elementBelow = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        if (!elementBelow) return;
        const cellElement = elementBelow.closest('td');
        if (!cellElement) return;
        const rowElement = cellElement.closest('tr');
        if (
          !rowElement ||
          rowElement.classList.contains('headerRowTop') ||
          rowElement.classList.contains('headerRowBottom') ||
          rowElement.classList.contains('editRow') ||
          rowElement.classList.contains('addRow')
        ) {
          return;
        }
        const currentRowId = rowElement.getAttribute('data-row-id');
        const currentPropertyKey = cellElement.getAttribute('data-property-key');
        if (currentRowId && currentPropertyKey && currentPropertyKey === startPropertyKey) {
          const allRowsForSelection = getAllRowsForCellSelection();
          const startRowIndex = allRowsForSelection.findIndex(r => r.id === startRowId);
          const currentRowIndex = allRowsForSelection.findIndex(r => r.id === currentRowId);
          if (startRowIndex === -1 || currentRowIndex === -1) return;
          if (currentRowIndex > startRowIndex) {
            const cellsToSelect = new Set<CellKey>();
            for (let r = startRowIndex; r <= currentRowIndex; r++) {
              const row = allRowsForSelection[r];
              if (row) cellsToSelect.add(`${row.id}-${startPropertyKey}`);
            }
            setSelectedCells(cellsToSelect);
          } else if (currentRowIndex < startRowIndex || currentRowIndex === startRowIndex) {
            setSelectedCells(new Set<CellKey>([`${startRowId}-${startPropertyKey}` as CellKey]));
          }
        }
      };

      const fillDragEndHandler = async (endEvent: MouseEvent) => {
        document.removeEventListener('mousemove', fillDragMoveHandler);
        document.removeEventListener('mouseup', fillDragEndHandlerWrapper);
        try {
          if (isClick || !hasMoved) {
            if (isFillingCellsRef.current) {
              setSelectedCells(new Set<CellKey>([`${startRowId}-${startPropertyKey}` as CellKey]));
            }
            return;
          }
          if (!isFillingCellsRef.current) return;
          const allRowsForSelection = getAllRowsForCellSelection();
          const startRowIndex = allRowsForSelection.findIndex(r => r.id === startRowId);
          const elementBelow = document.elementFromPoint(endEvent.clientX, endEvent.clientY);
          if (!elementBelow) {
            setSelectedCells(new Set<CellKey>([`${startRowId}-${startPropertyKey}` as CellKey]));
            return;
          }
          const cellElement = elementBelow.closest('td');
          if (!cellElement) {
            setSelectedCells(new Set<CellKey>([`${startRowId}-${startPropertyKey}` as CellKey]));
            return;
          }
          const rowElement = cellElement.closest('tr');
          if (
            !rowElement ||
            rowElement.classList.contains('headerRowTop') ||
            rowElement.classList.contains('headerRowBottom') ||
            rowElement.classList.contains('editRow') ||
            rowElement.classList.contains('addRow')
          ) {
            setSelectedCells(new Set<CellKey>([`${startRowId}-${startPropertyKey}` as CellKey]));
            return;
          }
          const endRowId = rowElement.getAttribute('data-row-id');
          const endPropertyKey = cellElement.getAttribute('data-property-key');
          if (!endRowId || !endPropertyKey || endPropertyKey !== startPropertyKey) {
            setSelectedCells(new Set<CellKey>([`${startRowId}-${startPropertyKey}` as CellKey]));
            return;
          }
          const endRowIndex = allRowsForSelection.findIndex(r => r.id === endRowId);
          if (startRowIndex === -1 || endRowIndex === -1) {
            setSelectedCells(new Set<CellKey>([`${startRowId}-${startPropertyKey}` as CellKey]));
            return;
          }
          if (endRowIndex > startRowIndex) {
            isFillingCellsRef.current = false;
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            document.body.classList.remove('filling-cells');
            setFillDragStartCell(null);
            void fillDown(startRowId, endRowId, startPropertyKey);
          } else {
            setSelectedCells(new Set<CellKey>([`${startRowId}-${startPropertyKey}` as CellKey]));
          }
        } finally {
          isFillingCellsRef.current = false;
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
          document.body.classList.remove('filling-cells');
          setFillDragStartCell(null);
        }
      };

      const fillDragEndHandlerWrapper = (e: MouseEvent) => {
        fillDragEndHandler(e);
      };
      document.addEventListener('mousemove', fillDragMoveHandler);
      document.addEventListener('mouseup', fillDragEndHandlerWrapper);
    },
    [selectedCells, orderedProperties, getAllRowsForCellSelection, fillDown]
  );

  // Update selected cells during drag (for visual feedback)
  useEffect(() => {
    if (!isDraggingCellsRef.current || !dragStartCell || !dragCurrentCell) return;
    const allRowsForSelection = getAllRowsForCellSelection();
    const startRowIndex = allRowsForSelection.findIndex(r => r.id === dragStartCell.rowId);
    const endRowIndex = allRowsForSelection.findIndex(r => r.id === dragCurrentCell.rowId);
    const startPropertyIndex = orderedProperties.findIndex(p => p.key === dragStartCell.propertyKey);
    const endPropertyIndex = orderedProperties.findIndex(p => p.key === dragCurrentCell.propertyKey);
    if (
      startRowIndex !== -1 &&
      endRowIndex !== -1 &&
      startPropertyIndex !== -1 &&
      endPropertyIndex !== -1
    ) {
      const rowStart = Math.min(startRowIndex, endRowIndex);
      const rowEnd = Math.max(startRowIndex, endRowIndex);
      const propStart = Math.min(startPropertyIndex, endPropertyIndex);
      const propEnd = Math.max(startPropertyIndex, endPropertyIndex);
      const cellsToSelect = new Set<CellKey>();
      for (let r = rowStart; r <= rowEnd; r++) {
        const row = allRowsForSelection[r];
        for (let p = propStart; p <= propEnd; p++) {
          const property = orderedProperties[p];
          cellsToSelect.add(`${row.id}-${property.key}`);
        }
      }
      setSelectedCells(cellsToSelect);
    }
  }, [dragStartCell, dragCurrentCell, getAllRowsForCellSelection, orderedProperties]);

  // Calculate selection bounds when selectedCells changes
  useEffect(() => {
    if (selectedCells.size <= 1) {
      setSelectionBounds(null);
      return;
    }
    const allRowsForSelection = getAllRowsForCellSelection();
    let minRowIndex = Infinity;
    let maxRowIndex = -Infinity;
    let minPropertyIndex = Infinity;
    let maxPropertyIndex = -Infinity;
    selectedCells.forEach(cellKey => {
      for (const property of orderedProperties) {
        const propertyKeyWithDash = '-' + property.key;
        if (cellKey.endsWith(propertyKeyWithDash)) {
          const rowId = cellKey.substring(0, cellKey.length - propertyKeyWithDash.length);
          const rowIndex = allRowsForSelection.findIndex(r => r.id === rowId);
          const propertyIndex = orderedProperties.findIndex(p => p.key === property.key);
          if (rowIndex !== -1 && propertyIndex !== -1) {
            minRowIndex = Math.min(minRowIndex, rowIndex);
            maxRowIndex = Math.max(maxRowIndex, rowIndex);
            minPropertyIndex = Math.min(minPropertyIndex, propertyIndex);
            maxPropertyIndex = Math.max(maxPropertyIndex, propertyIndex);
          }
          break;
        }
      }
    });
    if (
      minRowIndex !== Infinity &&
      maxRowIndex !== -Infinity &&
      minPropertyIndex !== Infinity &&
      maxPropertyIndex !== -Infinity
    ) {
      setSelectionBounds({ minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex });
    } else {
      setSelectionBounds(null);
    }
  }, [selectedCells, getAllRowsForCellSelection, orderedProperties]);

  // Sync selectedCells to ref
  useEffect(() => {
    selectedCellsRef.current = selectedCells;
  }, [selectedCells]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.body.classList.remove('filling-cells');
    };
  }, []);

  // getSelectionBorderClasses
  const getSelectionBorderClasses = useCallback(
    (rowId: string, propertyIndex: number): string => {
      if (!selectionBounds || selectedCells.size <= 1) return '';
      const allRowsForSelection = getAllRowsForCellSelection();
      const rowIndex = allRowsForSelection.findIndex(r => r.id === rowId);
      if (rowIndex === -1) return '';
      const cellKey = `${rowId}-${orderedProperties[propertyIndex].key}` as CellKey;
      if (!selectedCells.has(cellKey)) return '';
      const { minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex } = selectionBounds;
      const classes: string[] = [];
      if (rowIndex === minRowIndex) classes.push(selectionBorderClassNames.selectionBorderTop);
      if (rowIndex === maxRowIndex) classes.push(selectionBorderClassNames.selectionBorderBottom);
      if (propertyIndex === minPropertyIndex) classes.push(selectionBorderClassNames.selectionBorderLeft);
      if (propertyIndex === maxPropertyIndex) classes.push(selectionBorderClassNames.selectionBorderRight);
      return classes.join(' ');
    },
    [
      selectionBounds,
      selectedCells,
      orderedProperties,
      getAllRowsForCellSelection,
      selectionBorderClassNames,
    ]
  );

  return {
    // State
    selectedRowIds,
    setSelectedRowIds,
    selectedCells,
    setSelectedCells,
    selectedCellsRef,
    dragStartCell,
    dragCurrentCell,
    fillDragStartCell,
    hoveredCellForExpand,
    setHoveredCellForExpand,
    selectionBounds,
    isFillingCellsRef,

    // Handlers
    handleRowSelectionToggle,
    handleCellClick,
    handleCellFillDragStart,
    handleCellDragStart,
    getSelectionBorderClasses,
  };
}
