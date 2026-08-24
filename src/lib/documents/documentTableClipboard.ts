import type { Nodes, Table } from 'mdast';
import {
  serializeLibraryClipboardMatrix,
  writeLibraryClipboard,
  type SerializedLibraryClipboard,
} from '@/components/libraries/hooks/libraryRichClipboard';

import type { DocumentTableCellRange } from '@/lib/documents/documentTableSelectionState';

export type DocumentTableMatrix = string[][];

function mdastNodeToText(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') {
    return node.value;
  }
  if ('children' in node && Array.isArray(node.children)) {
    return node.children
      .map((child) => mdastNodeToText(child as Nodes))
      .join('');
  }
  return '';
}

export function mdastTableToMatrix(table: Table): DocumentTableMatrix {
  return table.children.map((row) =>
    row.children.map((cell) => mdastNodeToText(cell).trim()),
  );
}

function isContentTableCell(cell: Element): boolean {
  return cell.getAttribute('data-tool-cell') !== 'true';
}

export function extractTableMatrixFromElement(
  table: HTMLTableElement,
): DocumentTableMatrix {
  const rows = Array.from(table.querySelectorAll('tbody tr'));
  return rows.map((row) =>
    Array.from(row.querySelectorAll('th, td'))
      .filter(isContentTableCell)
      .map((cell) => {
        const editable = cell.querySelector('[contenteditable="true"]');
        return (editable?.textContent ?? cell.textContent ?? '').trim();
      }),
  );
}

export function isMdxEditorTableElement(table: HTMLTableElement): boolean {
  if (table.querySelector('[data-tool-cell="true"]') !== null) return true;
  const tbodyRows = table.querySelectorAll('tbody tr');
  if (tbodyRows.length === 0) return false;
  return Array.from(tbodyRows).every((row) =>
    Array.from(row.querySelectorAll('th, td')).some(isContentTableCell),
  );
}

export function findMdxEditorTableFromElement(
  element: HTMLElement | null,
): HTMLTableElement | null {
  if (!element) return null;
  const table = element.closest('table');
  if (!(table instanceof HTMLTableElement)) return null;
  if (!isMdxEditorTableElement(table)) return null;
  return table;
}

export function isDocumentTableCopyContext(
  editorRoot: HTMLElement,
  tableSelection: { table: HTMLTableElement } | null,
): boolean {
  if (tableSelection?.table.isConnected && editorRoot.contains(tableSelection.table)) {
    return true;
  }
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !editorRoot.contains(active)) {
    return false;
  }
  return findMdxEditorTableFromElement(active) !== null;
}

export function resolveMatrixFromTableElement(
  table: HTMLTableElement,
  range?: DocumentTableCellRange,
): DocumentTableMatrix | null {
  const matrix = extractTableMatrixFromElement(table);
  if (matrix.length === 0) return null;
  return range ? sliceTableMatrix(matrix, range) : matrix;
}

export function sliceTableMatrix(
  matrix: DocumentTableMatrix,
  range: {
    minRow: number;
    maxRow: number;
    minCol: number;
    maxCol: number;
  },
): DocumentTableMatrix {
  return matrix
    .slice(range.minRow, range.maxRow + 1)
    .map((row) => row.slice(range.minCol, range.maxCol + 1));
}

export function trimTableMatrix(matrix: DocumentTableMatrix): DocumentTableMatrix {
  if (matrix.length === 0) return matrix;

  let trimmed = matrix.map((row) => [...row]);
  while (
    trimmed.length > 0 &&
    trimmed[trimmed.length - 1].every((cell) => cell.trim() === '')
  ) {
    trimmed.pop();
  }
  if (trimmed.length === 0) return [];

  const maxCols = Math.max(...trimmed.map((row) => row.length));
  let colCount = maxCols;
  while (
    colCount > 0 &&
    trimmed.every((row) => (row[colCount - 1] ?? '').trim() === '')
  ) {
    colCount -= 1;
    trimmed = trimmed.map((row) => row.slice(0, colCount));
  }

  return trimmed;
}

export function parseTsvMatrix(text: string): DocumentTableMatrix {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.trim()) return [];
  return normalized.split('\n').map((line) => line.split('\t'));
}

export function isTabularClipboardText(text: string): boolean {
  if (!text.trim()) return false;
  return text.includes('\t') || text.includes('\n');
}

export function isTabularClipboardPayload(
  clipboardData: Pick<DataTransfer, 'getData'>,
): boolean {
  if (isTabularClipboardText(clipboardData.getData('text/plain'))) return true;
  return /<table[\s>]/i.test(clipboardData.getData('text/html'));
}

export function writeDocumentTableClipboard(
  event: ClipboardEvent | KeyboardEvent | null,
  matrix: DocumentTableMatrix,
): boolean {
  const trimmed = trimTableMatrix(matrix);
  if (trimmed.length === 0) return false;

  const payload = serializeLibraryClipboardMatrix(trimmed);
  if (
    event &&
    'clipboardData' in event &&
    event.clipboardData &&
    writeRichTableClipboardSync(event.clipboardData, payload)
  ) {
    return true;
  }
  void writeLibraryClipboard(payload);
  return Boolean(event && 'clipboardData' in event && event.clipboardData);
}

function writeRichTableClipboardSync(
  clipboardData: DataTransfer,
  payload: SerializedLibraryClipboard,
): boolean {
  try {
    clipboardData.setData('text/plain', payload.plainText);
    clipboardData.setData('text/html', payload.html);
    return true;
  } catch {
    try {
      clipboardData.setData('text/plain', payload.plainText);
      return payload.plainText.length > 0;
    } catch {
      return false;
    }
  }
}
