/** @jest-environment jsdom */

import {
  extractTableMatrixFromElement,
  findMdxEditorTableFromElement,
  isMdxEditorTableElement,
  mdastTableToMatrix,
  writeDocumentTableClipboard,
} from '@/lib/documents/documentTableClipboard';
import type { Table } from 'mdast';

function buildEditableTableHtml(rows: string[][]): string {
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

describe('document table clipboard', () => {
  it('converts mdast tables to a plain matrix', () => {
    const table: Table = {
      type: 'table',
      children: [
        {
          type: 'tableRow',
          children: [
            {
              type: 'tableCell',
              children: [{ type: 'text', value: 'Name' }],
            },
            {
              type: 'tableCell',
              children: [{ type: 'text', value: 'Score' }],
            },
          ],
        },
        {
          type: 'tableRow',
          children: [
            {
              type: 'tableCell',
              children: [{ type: 'text', value: 'Alice' }],
            },
            {
              type: 'tableCell',
              children: [{ type: 'text', value: '10' }],
            },
          ],
        },
      ],
    };

    expect(mdastTableToMatrix(table)).toEqual([
      ['Name', 'Score'],
      ['Alice', '10'],
    ]);
  });

  it('extracts content cells and ignores MDXEditor tool cells', () => {
    document.body.innerHTML = buildEditableTableHtml([
      ['Name', 'Score'],
      ['Alice', '10'],
    ]);
    const table = document.querySelector('table');
    expect(table).toBeTruthy();
    expect(isMdxEditorTableElement(table as HTMLTableElement)).toBe(true);
    expect(extractTableMatrixFromElement(table as HTMLTableElement)).toEqual([
      ['Name', 'Score'],
      ['Alice', '10'],
    ]);
  });

  it('finds the containing MDXEditor table from a nested contenteditable cell', () => {
    document.body.innerHTML = buildEditableTableHtml([
      ['Name', 'Score'],
      ['Alice', '10'],
    ]);
    const cell = document.querySelector('[contenteditable="true"]') as HTMLElement;
    const table = findMdxEditorTableFromElement(cell);
    expect(table).not.toBeNull();
    expect(extractTableMatrixFromElement(table!)).toEqual([
      ['Name', 'Score'],
      ['Alice', '10'],
    ]);
  });

  it('writes rich clipboard payloads through the copy event clipboardData API', () => {
    const setData = jest.fn();
    const event = {
      clipboardData: { setData },
    } as unknown as ClipboardEvent;

    expect(
      writeDocumentTableClipboard(event, [
        ['Name', 'Score'],
        ['Alice', '10'],
      ]),
    ).toBe(true);

    expect(setData).toHaveBeenCalledWith('text/plain', 'Name\tScore\nAlice\t10');
    expect(setData).toHaveBeenCalledWith(
      'text/html',
      '<table><tbody><tr><td>Name</td><td>Score</td></tr><tr><td>Alice</td><td>10</td></tr></tbody></table>',
    );
  });

  it('returns false when the matrix is empty after trimming', () => {
    const setData = jest.fn();
    const event = {
      clipboardData: { setData },
    } as unknown as ClipboardEvent;

    expect(
      writeDocumentTableClipboard(event, [
        ['', ''],
        ['', ''],
      ]),
    ).toBe(false);
    expect(setData).not.toHaveBeenCalled();
  });
});
