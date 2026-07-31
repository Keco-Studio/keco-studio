import {
  nextExpandedTextCell,
  selectionIncludesExpandedRow,
  type ExpandedTextCell,
} from '@/components/libraries/utils/textCellExpand';

describe('nextExpandedTextCell', () => {
  it('expands when clicking an overflowing cell', () => {
    expect(
      nextExpandedTextCell(null, {
        rowId: 'row-1',
        propertyKey: 'name',
        isOverflowing: true,
      }),
    ).toEqual({ rowId: 'row-1', propertyKey: 'name' });
  });

  it('does not expand when clicking a non-overflowing cell', () => {
    expect(
      nextExpandedTextCell(null, {
        rowId: 'row-1',
        propertyKey: 'name',
        isOverflowing: false,
      }),
    ).toBeNull();
  });

  it('toggles collapse when clicking the same expanded cell', () => {
    const current: ExpandedTextCell = { rowId: 'row-1', propertyKey: 'name' };
    expect(
      nextExpandedTextCell(current, {
        rowId: 'row-1',
        propertyKey: 'name',
        isOverflowing: false,
      }),
    ).toBeNull();
  });

  it('keeps expand when clicking another non-overflowing cell in the same row', () => {
    const current: ExpandedTextCell = { rowId: 'row-1', propertyKey: 'name' };
    expect(
      nextExpandedTextCell(current, {
        rowId: 'row-1',
        propertyKey: 'desc',
        isOverflowing: false,
      }),
    ).toEqual(current);
  });

  it('moves expand when clicking an overflowing cell in another row', () => {
    const current: ExpandedTextCell = { rowId: 'row-1', propertyKey: 'name' };
    expect(
      nextExpandedTextCell(current, {
        rowId: 'row-2',
        propertyKey: 'name',
        isOverflowing: true,
      }),
    ).toEqual({ rowId: 'row-2', propertyKey: 'name' });
  });

  it('collapses when clicking a non-overflowing cell in another row', () => {
    const current: ExpandedTextCell = { rowId: 'row-1', propertyKey: 'name' };
    expect(
      nextExpandedTextCell(current, {
        rowId: 'row-2',
        propertyKey: 'name',
        isOverflowing: false,
      }),
    ).toBeNull();
  });
});

describe('selectionIncludesExpandedRow', () => {
  it('detects selection in the expanded row', () => {
    expect(
      selectionIncludesExpandedRow(new Set(['row-1-name', 'row-1-desc']), 'row-1'),
    ).toBe(true);
    expect(selectionIncludesExpandedRow(new Set(['row-2-name']), 'row-1')).toBe(false);
    expect(selectionIncludesExpandedRow(new Set(['row-1-name']), null)).toBe(false);
  });
});
