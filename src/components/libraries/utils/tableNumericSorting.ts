import type { AssetRow } from '@/lib/types/libraryAssets';

export type NumericSortDirection = 'asc' | 'desc';

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function sortRowsByNumericColumn(
  rows: AssetRow[],
  fieldId: string,
  direction: NumericSortDirection,
): AssetRow[] {
  return rows
    .map((row, index) => ({ row, index, value: toFiniteNumber(row.propertyValues[fieldId]) }))
    .sort((left, right) => {
      const leftValid = left.value !== null;
      const rightValid = right.value !== null;
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      if (leftValid && rightValid && left.value !== right.value) {
        return direction === 'asc' ? left.value - right.value : right.value - left.value;
      }
      return left.index - right.index;
    })
    .map(({ row }) => row);
}
