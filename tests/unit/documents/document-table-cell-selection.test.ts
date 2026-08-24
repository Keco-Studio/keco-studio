/** @jest-environment jsdom */

import {
  applyTableCellRangeHighlight,
  clearTableCellRangeHighlights,
  getTableContentCellCoordinate,
  isDocumentTableContentCell,
  normalizeTableCellRange,
} from '@/lib/documents/documentTableCellSelection';
import { sliceTableMatrix } from '@/lib/documents/documentTableClipboard';

function buildTableHtml(rows: string[][]): string {
  const body = rows
    .map((row, rowIndex) => {
      const tag = rowIndex === 0 ? 'th' : 'td';
      const toolCell =
        rowIndex === 0
          ? ''
          : '<td data-tool-cell="true"><button type="button">row</button></td>';
      const cells = row
        .map(
          (value) =>
            `<${tag}><div contenteditable="true"><p>${value}</p></div></${tag}>`,
        )
        .join('');
      return `<tr>${toolCell}${cells}</tr>`;
    })
    .join('');
  return `<table><tbody>${body}</tbody></table>`;
}

describe('document table cell selection', () => {
  beforeEach(() => {
    document.body.innerHTML = buildTableHtml([
      ['Name', 'Score'],
      ['Alice', '10'],
      ['Bob', '20'],
    ]);
  });

  it('detects content cells and ignores tool cells', () => {
    const cell = document.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(isDocumentTableContentCell(cell)).toBe(true);
    expect(isDocumentTableContentCell(document.querySelector('[data-tool-cell="true"]'))).toBe(false);
  });

  it('normalizes rectangular ranges', () => {
    expect(
      normalizeTableCellRange({ row: 2, col: 1 }, { row: 0, col: 0 }),
    ).toEqual({
      minRow: 0,
      maxRow: 2,
      minCol: 0,
      maxCol: 1,
    });
  });

  it('highlights a selected cell range', () => {
    const table = document.querySelector('table') as HTMLTableElement;
    applyTableCellRangeHighlight(table, {
      minRow: 0,
      maxRow: 1,
      minCol: 0,
      maxCol: 1,
    });

    expect(table.querySelectorAll('[data-document-table-selected="true"]')).toHaveLength(4);
    expect(table.querySelector('[data-document-table-selected-top="true"]')).toBeTruthy();
    expect(table.querySelector('[data-document-table-selected-right="true"]')).toBeTruthy();

    clearTableCellRangeHighlights(table);
    expect(table.querySelector('[data-document-table-selected="true"]')).toBeNull();
  });

  it('resolves coordinates from nested contenteditable cells', () => {
    const cell = document.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(getTableContentCellCoordinate(cell)).toEqual({
      row: 0,
      col: 0,
      table: expect.any(HTMLTableElement),
      cell: expect.any(HTMLTableCellElement),
    });
  });

  it('slices a matrix to the selected range', () => {
    const matrix = [
      ['Name', 'Score'],
      ['Alice', '10'],
      ['Bob', '20'],
    ];
    expect(
      sliceTableMatrix(matrix, {
        minRow: 1,
        maxRow: 2,
        minCol: 0,
        maxCol: 0,
      }),
    ).toEqual([['Alice'], ['Bob']]);
    expect(
      sliceTableMatrix(matrix, {
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 1,
      }),
    ).toEqual([['Name', 'Score']]);
  });
});
