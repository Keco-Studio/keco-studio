import { describe, expect, it } from '@jest/globals';
import { sortRowsByNumericColumn } from '@/components/libraries/utils/tableNumericSorting';

describe('sortRowsByNumericColumn', () => {
  const rows = [
    { id: 'empty', propertyValues: { score: null } },
    { id: 'high', propertyValues: { score: 12 } },
    { id: 'invalid', propertyValues: { score: 'n/a' } },
    { id: 'negative', propertyValues: { score: '-3.5' } },
    { id: 'low', propertyValues: { score: 2 } },
    { id: 'same-as-low', propertyValues: { score: '2' } },
  ];

  it('sorts finite numeric values ascending while keeping invalid values last and stable', () => {
    expect(sortRowsByNumericColumn(rows as any, 'score', 'asc').map((row) => row.id))
      .toEqual(['negative', 'low', 'same-as-low', 'high', 'empty', 'invalid']);
  });

  it('sorts finite numeric values descending while keeping invalid values last and stable', () => {
    expect(sortRowsByNumericColumn(rows as any, 'score', 'desc').map((row) => row.id))
      .toEqual(['high', 'low', 'same-as-low', 'negative', 'empty', 'invalid']);
  });
});
