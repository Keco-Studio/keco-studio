'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

const STORAGE_PREFIX = 'keco-library-table-dimensions';

export const NUMBER_COLUMN_KEY = '__number__';

const MIN_NUMBER_COL_WIDTH = 40;
const MIN_DATA_COL_WIDTH = 80;
const MIN_ROW_HEIGHT = 24;
const MAX_ROW_HEIGHT = 400;

export type TableDimensions = {
  columnWidths: Record<string, number>;
  rowHeights: Record<string, number>;
};

function getMinColWidth(columnKey: string): number {
  return columnKey === NUMBER_COLUMN_KEY ? MIN_NUMBER_COL_WIDTH : MIN_DATA_COL_WIDTH;
}

function sanitizeColumnWidths(widths: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, width] of Object.entries(widths)) {
    const min = getMinColWidth(key);
    if (width >= min) {
      result[key] = width;
    }
  }
  return result;
}

function recordsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function loadDimensions(libraryId: string | undefined): TableDimensions {
  if (!libraryId || typeof window === 'undefined') {
    return { columnWidths: {}, rowHeights: {} };
  }
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}:${libraryId}`);
    if (!raw) return { columnWidths: {}, rowHeights: {} };
    const parsed = JSON.parse(raw) as TableDimensions;
    return {
      columnWidths: sanitizeColumnWidths(parsed.columnWidths ?? {}),
      rowHeights: parsed.rowHeights ?? {},
    };
  } catch {
    return { columnWidths: {}, rowHeights: {} };
  }
}

function saveDimensions(libraryId: string | undefined, dims: TableDimensions) {
  if (!libraryId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}:${libraryId}`, JSON.stringify(dims));
  } catch {
    // Ignore quota errors.
  }
}

function snapshotColumnWidths(
  table: HTMLTableElement,
  columnKeys: readonly string[],
): Record<string, number> {
  const rows = table.querySelectorAll('thead tr');
  const headerRow = rows[rows.length - 1];
  if (!headerRow) return {};

  const cells = headerRow.querySelectorAll('th');
  const result: Record<string, number> = {};
  columnKeys.forEach((key, index) => {
    const cell = cells[index] as HTMLElement | undefined;
    if (cell) {
      result[key] = Math.round(cell.getBoundingClientRect().width);
    }
  });
  return result;
}

function applyColumnWidthsToTable(
  table: HTMLTableElement,
  columnKeys: readonly string[],
  widths: Record<string, number>,
) {
  const cols = table.querySelectorAll('colgroup col');
  columnKeys.forEach((key, index) => {
    const col = cols[index] as HTMLTableColElement | undefined;
    const width = widths[key];
    if (!col || width === undefined) return;
    const minWidth = getMinColWidth(key);
    const clamped = Math.max(minWidth, width);
    col.style.width = `${clamped}px`;
    col.style.minWidth = `${minWidth}px`;
  });
}

function applyRowHeightToRow(row: HTMLTableRowElement, height: number) {
  row.style.setProperty('--row-height', `${height}px`);
  row.dataset.customHeight = 'true';
  row.style.height = `${height}px`;
  row.querySelectorAll('td').forEach((cell) => {
    const el = cell as HTMLElement;
    el.style.height = `${height}px`;
    el.style.minHeight = `${height}px`;
  });
}

type ColumnResizeSession = {
  table: HTMLTableElement;
  columnKey: string;
  startX: number;
  startWidths: Record<string, number>;
  pendingWidths: Record<string, number>;
};

type RowResizeSession = {
  row: HTMLTableRowElement;
  rowId: string;
  startY: number;
  startHeight: number;
  pendingHeight: number;
};

export function useTableResize(libraryId: string | undefined, columnKeys: readonly string[]) {
  const [dimensions, setDimensions] = useState<TableDimensions>(() => loadDimensions(libraryId));
  const [isResizingColumn, setIsResizingColumn] = useState(false);
  const [isResizingRow, setIsResizingRow] = useState(false);

  const columnResizeRef = useRef<ColumnResizeSession | null>(null);
  const rowResizeRef = useRef<RowResizeSession | null>(null);
  const dimensionsRef = useRef(dimensions);
  dimensionsRef.current = dimensions;
  const columnKeysRef = useRef(columnKeys);
  columnKeysRef.current = columnKeys;
  const libraryIdRef = useRef(libraryId);
  libraryIdRef.current = libraryId;

  useEffect(() => {
    setDimensions(loadDimensions(libraryId));
  }, [libraryId]);

  const commitDimensions = useCallback((next: TableDimensions) => {
    setDimensions((prev) => {
      if (
        recordsEqual(prev.columnWidths, next.columnWidths) &&
        recordsEqual(prev.rowHeights, next.rowHeights)
      ) {
        return prev;
      }
      saveDimensions(libraryIdRef.current, next);
      return next;
    });
  }, []);

  const startColumnResize = useCallback(
    (columnKey: string, clientX: number, element: HTMLElement) => {
      const table = element.closest('table');
      if (!table) return;

      const keys = columnKeysRef.current;
      const columnIndex = keys.indexOf(columnKey);
      if (columnIndex === -1) return;

      const startWidths = snapshotColumnWidths(table, keys);
      const mergedWidths = {
        ...dimensionsRef.current.columnWidths,
        ...startWidths,
      };

      columnResizeRef.current = {
        table,
        columnKey,
        startX: clientX,
        startWidths: mergedWidths,
        pendingWidths: mergedWidths,
      };

      applyColumnWidthsToTable(table, keys, mergedWidths);

      // One state update on drag start to freeze layout; no updates during mousemove.
      commitDimensions({
        ...dimensionsRef.current,
        columnWidths: mergedWidths,
      });
      setIsResizingColumn(true);
    },
    [commitDimensions],
  );

  const startRowResize = useCallback((rowId: string, clientY: number, element: HTMLElement) => {
    const row = element.closest('tr') as HTMLTableRowElement | null;
    if (!row) return;

    const startHeight =
      dimensionsRef.current.rowHeights[rowId] ?? row.getBoundingClientRect().height;

    rowResizeRef.current = {
      row,
      rowId,
      startY: clientY,
      startHeight,
      pendingHeight: startHeight,
    };
    setIsResizingRow(true);
  }, []);

  useEffect(() => {
    if (!isResizingColumn) return;

    const onMove = (e: MouseEvent) => {
      const ref = columnResizeRef.current;
      if (!ref) return;

      const keys = columnKeysRef.current;
      const delta = e.clientX - ref.startX;
      const columnKey = ref.columnKey;
      const nextWidth = Math.max(
        getMinColWidth(columnKey),
        ref.startWidths[columnKey] + delta,
      );
      const nextWidths = {
        ...ref.startWidths,
        [columnKey]: nextWidth,
      };

      if (recordsEqual(ref.pendingWidths, nextWidths)) return;

      ref.pendingWidths = nextWidths;
      applyColumnWidthsToTable(ref.table, keys, nextWidths);
    };

    const onUp = () => {
      const ref = columnResizeRef.current;
      if (ref) {
        commitDimensions({
          ...dimensionsRef.current,
          columnWidths: ref.pendingWidths,
        });
      }
      columnResizeRef.current = null;
      setIsResizingColumn(false);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingColumn, commitDimensions]);

  useEffect(() => {
    if (!isResizingRow) return;

    const onMove = (e: MouseEvent) => {
      const ref = rowResizeRef.current;
      if (!ref) return;

      const delta = e.clientY - ref.startY;
      const newHeight = Math.min(
        MAX_ROW_HEIGHT,
        Math.max(MIN_ROW_HEIGHT, ref.startHeight + delta),
      );

      if (ref.pendingHeight === newHeight) return;

      ref.pendingHeight = newHeight;
      applyRowHeightToRow(ref.row, newHeight);
    };

    const onUp = () => {
      const ref = rowResizeRef.current;
      if (ref) {
        commitDimensions({
          ...dimensionsRef.current,
          rowHeights: {
            ...dimensionsRef.current.rowHeights,
            [ref.rowId]: ref.pendingHeight,
          },
        });
      }
      rowResizeRef.current = null;
      setIsResizingRow(false);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingRow, commitDimensions]);

  const hasCustomColumnWidths = Object.keys(dimensions.columnWidths).length > 0;

  const getColumnWidthPx = useCallback(
    (columnKey: string): number | undefined => dimensions.columnWidths[columnKey],
    [dimensions.columnWidths],
  );

  const getColStyle = useCallback(
    (columnKey: string): CSSProperties | undefined => {
      const width = dimensions.columnWidths[columnKey];
      if (!width) return undefined;
      const minWidth = getMinColWidth(columnKey);
      const clampedWidth = Math.max(minWidth, width);
      return {
        width: `${clampedWidth}px`,
        minWidth: `${minWidth}px`,
      };
    },
    [dimensions.columnWidths],
  );

  const getRowHeightStyle = useCallback(
    (rowId: string): CSSProperties | undefined => {
      const height = dimensions.rowHeights[rowId];
      if (!height) return undefined;
      return { '--row-height': `${height}px` } as CSSProperties;
    },
    [dimensions.rowHeights],
  );

  const hasCustomRowHeight = useCallback(
    (rowId: string): boolean => dimensions.rowHeights[rowId] !== undefined,
    [dimensions.rowHeights],
  );

  return {
    getColumnWidthPx,
    getColStyle,
    getRowHeightStyle,
    hasCustomRowHeight,
    hasCustomColumnWidths,
    startColumnResize,
    startRowResize,
    isResizingColumn,
    isResizingRow,
  };
}
