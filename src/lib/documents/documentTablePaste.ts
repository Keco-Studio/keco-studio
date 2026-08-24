import { $isTableNode } from '@mdxeditor/editor';
import type { TableNode } from '@mdxeditor/editor';
import { $getRoot, type LexicalEditor } from 'lexical';

import type { DocumentTableMatrix } from '@/lib/documents/documentTableClipboard';

type MdastTextChild = { type: 'text'; value: string };

/** MDXEditor implements this on TableNode but omits it from public typings. */
type TableNodeWithCellUpdate = TableNode & {
  updateCellContents(
    colIndex: number,
    rowIndex: number,
    children: MdastTextChild[],
  ): void;
};

function textToMdastCellChildren(value: string): MdastTextChild[] {
  return value ? [{ type: 'text' as const, value }] : [];
}

/** Call only inside rootEditor.update() or rootEditor.read(). */
export function locateTableNodeFromTableElement(
  table: HTMLTableElement,
  editor: LexicalEditor,
): TableNode | null {
  const root = $getRoot();
  for (const child of root.getChildren()) {
    if (!$isTableNode(child)) continue;
    const element = editor.getElementByKey(child.getKey());
    if (element?.contains(table)) return child;
  }
  return null;
}

export function applyMatrixToTableNode(
  tableNode: TableNode,
  startRow: number,
  startCol: number,
  matrix: DocumentTableMatrix,
): void {
  if (matrix.length === 0) return;

  const requiredRows = startRow + matrix.length;
  const requiredCols =
    startCol + Math.max(0, ...matrix.map((row) => row.length));

  while (tableNode.getColCount() < requiredCols) {
    tableNode.addColumnToRight();
  }
  while (tableNode.getRowCount() < requiredRows) {
    tableNode.addRowToBottom();
  }

  matrix.forEach((row, rowOffset) => {
    row.forEach((value, colOffset) => {
      (tableNode as TableNodeWithCellUpdate).updateCellContents(
        startCol + colOffset,
        startRow + rowOffset,
        textToMdastCellChildren(String(value ?? '')),
      );
    });
  });
}
