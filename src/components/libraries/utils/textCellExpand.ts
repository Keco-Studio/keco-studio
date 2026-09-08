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

/**
 * While editing, long text wraps and the editor grows with content
 * (`height: auto`), so scrollHeight ≈ clientHeight. Detect multi-line wrap
 * (or horizontal overflow) to decide whether display should stay expanded.
 */
export function editorContentOverflows(editorEl: HTMLElement | null | undefined): boolean {
  if (!editorEl) return false;
  if (editorEl.scrollWidth > editorEl.clientWidth + 1) return true;

  const styles = getComputedStyle(editorEl);
  let lineHeight = parseFloat(styles.lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    const fontSize = parseFloat(styles.fontSize) || 14;
    lineHeight = fontSize * 1.35;
  }
  const paddingY =
    (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
  // Taller than one line → was wrapping in the editor
  return editorEl.scrollHeight > lineHeight + paddingY + 2;
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
