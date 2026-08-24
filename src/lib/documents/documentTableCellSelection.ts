import { isMdxEditorTableElement } from '@/lib/documents/documentTableClipboard';
import type { DocumentTableCellRange } from '@/lib/documents/documentTableSelectionState';

export type TableContentCellCoordinate = {
  row: number;
  col: number;
  table: HTMLTableElement;
  cell: HTMLTableCellElement;
};

const SELECTED_ATTR = 'data-document-table-selected';
const SELECTED_TOP = 'data-document-table-selected-top';
const SELECTED_BOTTOM = 'data-document-table-selected-bottom';
const SELECTED_LEFT = 'data-document-table-selected-left';
const SELECTED_RIGHT = 'data-document-table-selected-right';

export function resolveDocumentTableContentCell(
  element: Element | null,
): HTMLTableCellElement | null {
  const cell =
    element instanceof HTMLTableCellElement
      ? element
      : element?.closest('th, td');
  if (!(cell instanceof HTMLTableCellElement)) return null;
  if (cell.getAttribute('data-tool-cell') === 'true') return null;
  const table = cell.closest('table');
  if (!(table instanceof HTMLTableElement)) return null;
  if (!cell.closest('tbody')) return null;
  if (!isMdxEditorTableElement(table)) return null;
  return cell;
}

export function isDocumentTableContentCell(
  element: Element | null,
): element is HTMLTableCellElement {
  return resolveDocumentTableContentCell(element) !== null;
}

export function getTableContentCellCoordinate(
  element: Element | null,
): TableContentCellCoordinate | null {
  const cell = resolveDocumentTableContentCell(element);
  if (!cell) return null;

  const row = cell.closest('tr');
  const table = cell.closest('table');
  if (!(row instanceof HTMLTableRowElement) || !(table instanceof HTMLTableElement)) {
    return null;
  }

  const tbody = row.parentElement;
  if (!tbody || tbody.tagName !== 'TBODY') return null;

  const rowIndex = Array.from(tbody.children).indexOf(row);
  const contentCells = getRowContentCells(row);
  const colIndex = contentCells.indexOf(cell);
  if (rowIndex < 0 || colIndex < 0) return null;

  return { row: rowIndex, col: colIndex, table, cell };
}

export function getRowContentCells(row: HTMLTableRowElement): HTMLTableCellElement[] {
  return Array.from(row.querySelectorAll('th, td')).filter(
    (cell) => cell.getAttribute('data-tool-cell') !== 'true',
  ) as HTMLTableCellElement[];
}

export function normalizeTableCellRange(
  anchor: Pick<TableContentCellCoordinate, 'row' | 'col'>,
  focus: Pick<TableContentCellCoordinate, 'row' | 'col'>,
): DocumentTableCellRange {
  return {
    minRow: Math.min(anchor.row, focus.row),
    maxRow: Math.max(anchor.row, focus.row),
    minCol: Math.min(anchor.col, focus.col),
    maxCol: Math.max(anchor.col, focus.col),
  };
}

export function clearTableCellRangeHighlights(root: ParentNode): void {
  root.querySelectorAll(`[${SELECTED_ATTR}]`).forEach((cell) => {
    cell.removeAttribute(SELECTED_ATTR);
    cell.removeAttribute(SELECTED_TOP);
    cell.removeAttribute(SELECTED_BOTTOM);
    cell.removeAttribute(SELECTED_LEFT);
    cell.removeAttribute(SELECTED_RIGHT);
  });
}

export function applyTableCellRangeHighlight(
  table: HTMLTableElement,
  range: DocumentTableCellRange,
): void {
  clearTableCellRangeHighlights(table);
  const rows = Array.from(table.querySelectorAll('tbody tr'));
  for (let rowIndex = range.minRow; rowIndex <= range.maxRow; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) continue;
    const cells = getRowContentCells(row);
    for (let colIndex = range.minCol; colIndex <= range.maxCol; colIndex += 1) {
      const cell = cells[colIndex];
      if (!cell) continue;
      cell.setAttribute(SELECTED_ATTR, 'true');
      if (rowIndex === range.minRow) cell.setAttribute(SELECTED_TOP, 'true');
      if (rowIndex === range.maxRow) cell.setAttribute(SELECTED_BOTTOM, 'true');
      if (colIndex === range.minCol) cell.setAttribute(SELECTED_LEFT, 'true');
      if (colIndex === range.maxCol) cell.setAttribute(SELECTED_RIGHT, 'true');
    }
  }
}
