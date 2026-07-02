import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { CellKey } from './useCellSelection';

type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

type ResolveArrowKeyCellSelectionArgs = {
  key: string;
  selectedCells: Set<CellKey>;
  rows: AssetRow[];
  properties: PropertyConfig[];
};

type CellPosition = {
  rowIndex: number;
  propertyIndex: number;
};

function isArrowKey(key: string): key is ArrowKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveCellPosition(
  cellKey: CellKey,
  rows: AssetRow[],
  properties: PropertyConfig[]
): CellPosition | null {
  for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex++) {
    const property = properties[propertyIndex];
    const suffix = `-${property.key}`;
    if (!cellKey.endsWith(suffix)) continue;

    const rowId = cellKey.slice(0, cellKey.length - suffix.length);
    const rowIndex = rows.findIndex((row) => row.id === rowId);
    if (rowIndex === -1) return null;
    return { rowIndex, propertyIndex };
  }
  return null;
}

function resolveSelectionAnchor(
  selectedCells: Set<CellKey>,
  rows: AssetRow[],
  properties: PropertyConfig[]
): CellPosition | null {
  let anchor: CellPosition | null = null;

  for (const cellKey of selectedCells) {
    const position = resolveCellPosition(cellKey, rows, properties);
    if (!position) continue;
    if (
      !anchor ||
      position.rowIndex < anchor.rowIndex ||
      (position.rowIndex === anchor.rowIndex && position.propertyIndex < anchor.propertyIndex)
    ) {
      anchor = position;
    }
  }

  return anchor;
}

export function resolveArrowKeyCellSelection({
  key,
  selectedCells,
  rows,
  properties,
}: ResolveArrowKeyCellSelectionArgs): Set<CellKey> | null {
  if (!isArrowKey(key) || selectedCells.size === 0 || rows.length === 0 || properties.length === 0) {
    return null;
  }

  const anchor = resolveSelectionAnchor(selectedCells, rows, properties);
  if (!anchor) return null;

  const rowDelta = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
  const propertyDelta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
  const nextRowIndex = clamp(anchor.rowIndex + rowDelta, 0, rows.length - 1);
  const nextPropertyIndex = clamp(anchor.propertyIndex + propertyDelta, 0, properties.length - 1);
  const nextCellKey = `${rows[nextRowIndex].id}-${properties[nextPropertyIndex].key}` as CellKey;

  return new Set<CellKey>([nextCellKey]);
}

export function shouldIgnoreCellNavigationTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;

  const element = target as {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
    getAttribute?: (name: string) => string | null;
  };
  const tagName = element.tagName?.toLowerCase();

  if (tagName && ['input', 'textarea', 'select', 'button'].includes(tagName)) {
    return true;
  }
  if (element.isContentEditable || element.getAttribute?.('contenteditable') === 'true') {
    return true;
  }

  return Boolean(
    element.closest?.(
      [
        'input',
        'textarea',
        'select',
        'button',
        '[contenteditable="true"]',
        '[role="dialog"]',
        '[role="alertdialog"]',
        '[role="combobox"]',
        '.ant-modal',
        '.ant-modal-root',
        '.ant-select-dropdown',
        '.ant-picker-dropdown',
      ].join(',')
    )
  );
}
