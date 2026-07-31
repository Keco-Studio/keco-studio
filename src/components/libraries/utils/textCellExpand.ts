export type ExpandedTextCell = {
  rowId: string;
  propertyKey: string;
} | null;

/**
 * Next ephemeral expand state after a text-cell click (selection already applied).
 * - Same expanded cell → collapse (toggle)
 * - Overflowing cell → expand that cell's row
 * - Non-overflowing click on the already-expanded row → keep expand
 * - Otherwise → collapse
 */
export function nextExpandedTextCell(
  current: ExpandedTextCell,
  click: { rowId: string; propertyKey: string; isOverflowing: boolean },
): ExpandedTextCell {
  const isSameCell =
    current?.rowId === click.rowId && current?.propertyKey === click.propertyKey;
  if (isSameCell) {
    return null;
  }
  if (click.isOverflowing) {
    return { rowId: click.rowId, propertyKey: click.propertyKey };
  }
  if (current?.rowId === click.rowId) {
    return current;
  }
  return null;
}

/** True when any selected cell belongs to the expanded row. */
export function selectionIncludesExpandedRow(
  selectedCells: Iterable<string>,
  expandedRowId: string | null,
): boolean {
  if (!expandedRowId) {
    return false;
  }
  const prefix = `${expandedRowId}-`;
  for (const cellKey of selectedCells) {
    if (cellKey.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}
