import {
  resolveArrowKeyCellSelection,
  shouldIgnoreCellNavigationTarget,
} from '../../src/components/libraries/hooks/cellNavigation';
import type { CellKey } from '../../src/components/libraries/hooks/useCellSelection';
import type { AssetRow, PropertyConfig } from '../../src/lib/types/libraryAssets';

const rows = [
  { id: 'row-1', name: 'Row 1', propertyValues: {} },
  { id: 'row-2', name: 'Row 2', propertyValues: {} },
  { id: 'row-3', name: 'Row 3', propertyValues: {} },
] as AssetRow[];

const properties = [
  { key: 'col-a', id: 'prop-a', name: 'A', dataType: 'string' },
  { key: 'col-b', id: 'prop-b', name: 'B', dataType: 'string' },
  { key: 'col-c', id: 'prop-c', name: 'C', dataType: 'string' },
] as PropertyConfig[];

function selected(...keys: string[]): Set<CellKey> {
  return new Set(keys as CellKey[]);
}

describe('resolveArrowKeyCellSelection', () => {
  it('moves a single selected cell in the arrow direction', () => {
    const result = resolveArrowKeyCellSelection({
      key: 'ArrowRight',
      selectedCells: selected('row-2-col-b'),
      rows,
      properties,
    });

    expect(result).toEqual(selected('row-2-col-c'));
  });

  it('clamps movement at table boundaries', () => {
    const result = resolveArrowKeyCellSelection({
      key: 'ArrowUp',
      selectedCells: selected('row-1-col-a'),
      rows,
      properties,
    });

    expect(result).toEqual(selected('row-1-col-a'));
  });

  it('uses the top-left cell as the anchor for multi-cell selections', () => {
    const result = resolveArrowKeyCellSelection({
      key: 'ArrowDown',
      selectedCells: selected('row-2-col-b', 'row-2-col-c', 'row-3-col-b', 'row-3-col-c'),
      rows,
      properties,
    });

    expect(result).toEqual(selected('row-3-col-b'));
  });

  it('returns null for unsupported keys or no selected cells', () => {
    expect(resolveArrowKeyCellSelection({
      key: 'Enter',
      selectedCells: selected('row-2-col-b'),
      rows,
      properties,
    })).toBeNull();

    expect(resolveArrowKeyCellSelection({
      key: 'ArrowDown',
      selectedCells: selected(),
      rows,
      properties,
    })).toBeNull();
  });
});

describe('shouldIgnoreCellNavigationTarget', () => {
  it('ignores text inputs and contenteditable elements', () => {
    const input = {
      tagName: 'INPUT',
      closest: () => null,
    } as unknown as EventTarget;
    expect(shouldIgnoreCellNavigationTarget(input)).toBe(true);

    const editable = {
      tagName: 'DIV',
      isContentEditable: true,
      closest: () => null,
    } as unknown as EventTarget;
    expect(shouldIgnoreCellNavigationTarget(editable)).toBe(true);
  });

  it('does not ignore a plain table cell target', () => {
    const cell = {
      tagName: 'TD',
      isContentEditable: false,
      closest: () => null,
    } as unknown as EventTarget;
    expect(shouldIgnoreCellNavigationTarget(cell)).toBe(false);
  });
});
