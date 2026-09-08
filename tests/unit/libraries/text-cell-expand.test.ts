/** @jest-environment jsdom */

import {
  editorContentOverflows,
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

describe('editorContentOverflows', () => {
  function mockEditor(partial: {
    scrollHeight: number;
    clientHeight: number;
    scrollWidth?: number;
    clientWidth?: number;
    lineHeight?: string;
    fontSize?: string;
    paddingTop?: string;
    paddingBottom?: string;
  }): HTMLElement {
    const el = {
      scrollHeight: partial.scrollHeight,
      clientHeight: partial.clientHeight,
      scrollWidth: partial.scrollWidth ?? 100,
      clientWidth: partial.clientWidth ?? 100,
    } as HTMLElement;
    const styleMap: Record<string, string> = {
      lineHeight: partial.lineHeight ?? '18.9px',
      fontSize: partial.fontSize ?? '14px',
      paddingTop: partial.paddingTop ?? '5.6px',
      paddingBottom: partial.paddingBottom ?? '5.6px',
    };
    jest.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '',
      ...styleMap,
      lineHeight: styleMap.lineHeight,
      fontSize: styleMap.fontSize,
      paddingTop: styleMap.paddingTop,
      paddingBottom: styleMap.paddingBottom,
    } as CSSStyleDeclaration);
    return el;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns false for null', () => {
    expect(editorContentOverflows(null)).toBe(false);
  });

  it('returns true when text wraps to more than one line', () => {
    // one line ≈ 18.9 + 11.2 padding = 30.1; multi-line taller
    const el = mockEditor({ scrollHeight: 48, clientHeight: 48 });
    expect(editorContentOverflows(el)).toBe(true);
  });

  it('returns false for single-line editor height', () => {
    const el = mockEditor({ scrollHeight: 30, clientHeight: 30 });
    expect(editorContentOverflows(el)).toBe(false);
  });

  it('returns true when horizontal overflow exists', () => {
    const el = mockEditor({
      scrollHeight: 30,
      clientHeight: 30,
      scrollWidth: 200,
      clientWidth: 100,
    });
    expect(editorContentOverflows(el)).toBe(true);
  });
});
