import {
  applyColumnFilterByRowIds,
  collectColumnUniqueValues,
  filterRowsByVisibility,
  getCheckedFilterValuesForColumn,
  isColumnFilterActive,
} from '@/lib/utils/columnValueFilter';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

const category = {
  id: 'category-field',
  key: 'category-field',
  name: 'Category',
  dataType: 'string',
  sectionId: 'main',
  orderIndex: 0,
} as PropertyConfig;

const rows = [
  { id: 'row-alpha', name: 'Alpha', propertyValues: { [category.key]: 'Alpha' } },
  { id: 'row-beta', name: 'Beta', propertyValues: { [category.key]: 'Beta' } },
  { id: 'row-blank', name: 'Blank', propertyValues: { [category.key]: null } },
] as AssetRow[];

describe('column value filtering', () => {
  it('sorts unique values and keeps blank last', () => {
    expect(collectColumnUniqueValues(rows, category, [category])).toEqual([
      'Alpha',
      'Beta',
      '',
    ]);
  });

  it('hides rows whose values are not selected without mutating source rows', () => {
    const hidden = applyColumnFilterByRowIds(
      rows,
      category,
      new Set(['Beta']),
      new Set(),
      [category]
    );

    expect(hidden).toEqual(new Set(['row-alpha', 'row-blank']));
    expect(filterRowsByVisibility(rows, hidden).map((row) => row.id)).toEqual(['row-beta']);
    expect(rows).toHaveLength(3);
  });

  it('reports checked values and active state from row visibility', () => {
    const hidden = new Set(['row-beta']);

    expect(getCheckedFilterValuesForColumn(rows, category, hidden, [category])).toEqual(
      new Set(['Alpha', ''])
    );
    expect(isColumnFilterActive(rows, category, hidden, [category])).toBe(true);
    expect(isColumnFilterActive(rows, category, new Set(), [category])).toBe(false);
  });

  it('removes hidden row ids that no longer belong to the table', () => {
    const hidden = applyColumnFilterByRowIds(
      rows,
      category,
      new Set(['Alpha', 'Beta', '']),
      new Set(['deleted-row']),
      [category]
    );

    expect(hidden).toEqual(new Set());
  });
});
