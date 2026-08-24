import { Cell } from '@mdxeditor/gurx';

export type DocumentTableCellRange = {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
};

export type DocumentTableSelection = {
  table: HTMLTableElement;
  range: DocumentTableCellRange;
};

export const documentTableSelection$ = Cell<DocumentTableSelection | null>(null);
