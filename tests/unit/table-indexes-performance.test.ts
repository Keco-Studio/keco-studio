import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import {
  buildClipboardMatrix,
  buildTableIndexes,
  getSelectionBounds,
} from '@/components/libraries/utils/tableIndexes';

describe('large library table indexes', () => {
  it('indexes and copies a 1000 by 20 selection in table order', () => {
    const properties = Array.from({ length: 20 }, (_, columnIndex) => ({
      id: `property-${columnIndex}`,
      key: `property-${columnIndex}`,
      name: `Column ${columnIndex}`,
      dataType: 'string',
    })) as PropertyConfig[];
    const rows = Array.from({ length: 1000 }, (_, rowIndex) => ({
      id: `row-${rowIndex}`,
      name: `Row ${rowIndex}`,
      propertyValues: Object.fromEntries(
        properties.map((property, columnIndex) => [
          property.key,
          `${rowIndex}:${columnIndex}`,
        ]),
      ),
    })) as AssetRow[];

    const indexes = buildTableIndexes(rows, properties);
    const selectedCells = new Set(
      rows.flatMap((row) => properties.map((property) => `${row.id}-${property.key}`)),
    );

    expect(indexes.rowIndexById.get('row-999')).toBe(999);
    expect(indexes.propertyIndexByKey.get('property-19')).toBe(19);
    expect(indexes.cellCoordinatesByKey.size).toBe(20_000);
    expect(getSelectionBounds(selectedCells, indexes)).toEqual({
      minRowIndex: 0,
      maxRowIndex: 999,
      minPropertyIndex: 0,
      maxPropertyIndex: 19,
    });

    const matrix = buildClipboardMatrix(selectedCells, indexes, (row, property) =>
      String(row.propertyValues[property.key]),
    );
    expect(matrix).toHaveLength(1000);
    expect(matrix[0]).toHaveLength(20);
    expect(matrix[0][0]).toBe('0:0');
    expect(matrix[999][19]).toBe('999:19');
  });
});
