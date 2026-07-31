import {
  assetHasAnyNonEmptyDisplayValue,
  cellDisplayString,
  compareAssetsForUiRow,
  getNextAppendRowIndex,
  getReferencePickerDisplayValue,
  hasNonEmptyDisplayValue,
  isAssetEmpty,
  isAssetEmptyForDisplay,
  rowsNeedRowIndexNormalize,
  sortAssetsForUiRow,
} from '../../src/lib/utils/assetEmptiness';

describe('assetEmptiness utils', () => {
  it('cellDisplayString treats null and blank as empty', () => {
    expect(cellDisplayString(null)).toBe('');
    expect(cellDisplayString('')).toBe('');
    expect(cellDisplayString('  ')).toBe('');
  });

  it('cellDisplayString preserves booleans and trimmed strings', () => {
    expect(cellDisplayString(false)).toBe('false');
    expect(cellDisplayString(true)).toBe('true');
    expect(cellDisplayString(' hello ')).toBe('hello');
  });

  it('cellDisplayString serializes JSON objects from jsonb cells', () => {
    expect(cellDisplayString({ damageRatio: 0.1, levelBonus: 5 })).toBe(
      '{"damageRatio":0.1,"levelBonus":5}'
    );
  });

  it('isAssetEmpty uses propertyValues keys only', () => {
    expect(isAssetEmpty({})).toBe(true);
    expect(isAssetEmpty({ f1: '' })).toBe(false);
  });

  it('assetHasAnyNonEmptyDisplayValue ignores blank values', () => {
    expect(assetHasAnyNonEmptyDisplayValue({ a: '', b: null })).toBe(false);
    expect(assetHasAnyNonEmptyDisplayValue({ a: '', b: 'x' })).toBe(true);
  });

  it('getReferencePickerDisplayValue reads a specific field', () => {
    expect(getReferencePickerDisplayValue({ f1: 'ID-1', f2: '' }, 'f1')).toBe('ID-1');
    expect(getReferencePickerDisplayValue({ f1: 'ID-1', f2: '' }, 'f2')).toBe('');
  });

  it('isAssetEmptyForDisplay ignores blank stored values', () => {
    expect(isAssetEmptyForDisplay({ a: '', b: null })).toBe(true);
    expect(isAssetEmptyForDisplay({ a: 'x' })).toBe(false);
  });

  it('sortAssetsForUiRow breaks row_index ties with created_at', () => {
    const sorted = sortAssetsForUiRow([
      {
        id: 'b-id',
        libraryId: 'lib',
        name: 'Untitled',
        propertyValues: {},
        rowIndex: 1,
        created_at: '2026-04-09T12:52:47.602Z',
      },
      {
        id: 'a-id',
        libraryId: 'lib',
        name: 'Untitled',
        propertyValues: {},
        rowIndex: 1,
        created_at: '2026-04-09T12:52:47.601Z',
      },
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['a-id', 'b-id']);
    expect(compareAssetsForUiRow(sorted[0], sorted[1])).toBeLessThan(0);
  });

  it('getNextAppendRowIndex uses length+1 when any rowIndex is missing', () => {
    const rows = [
      { id: 'a', libraryId: 'lib', name: 'A', propertyValues: {} },
      { id: 'b', libraryId: 'lib', name: 'B', propertyValues: {} },
      { id: 'c', libraryId: 'lib', name: 'C', propertyValues: {} },
    ];
    expect(rowsNeedRowIndexNormalize(rows)).toBe(true);
    expect(getNextAppendRowIndex(rows)).toBe(4);

    const numbered = rows.map((row, i) => ({ ...row, rowIndex: i + 1 }));
    expect(rowsNeedRowIndexNormalize(numbered)).toBe(false);
    expect(getNextAppendRowIndex(numbered)).toBe(4);
  });

  it('numbered row among null peers sorts first (why append must normalize)', () => {
    const sorted = sortAssetsForUiRow([
      {
        id: 'old-1',
        libraryId: 'lib',
        name: 'Level 1',
        propertyValues: {},
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'new',
        libraryId: 'lib',
        name: 'Untitled',
        propertyValues: {},
        rowIndex: 1,
        created_at: '2026-07-31T00:00:00.000Z',
      },
      {
        id: 'old-2',
        libraryId: 'lib',
        name: 'Level 2',
        propertyValues: {},
        created_at: '2026-01-02T00:00:00.000Z',
      },
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['new', 'old-1', 'old-2']);
  });
});
