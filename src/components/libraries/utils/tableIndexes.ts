import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

export type CellCoordinates = {
  rowIndex: number;
  propertyIndex: number;
};

export type TableIndexes = {
  rows: AssetRow[];
  properties: PropertyConfig[];
  rowById: Map<string, AssetRow>;
  rowIndexById: Map<string, number>;
  propertyByKey: Map<string, PropertyConfig>;
  propertyIndexByKey: Map<string, number>;
  cellCoordinatesByKey: Map<string, CellCoordinates>;
};

export type TableSelectionBounds = {
  minRowIndex: number;
  maxRowIndex: number;
  minPropertyIndex: number;
  maxPropertyIndex: number;
};

export function buildTableIndexes(
  rows: AssetRow[],
  properties: PropertyConfig[],
): TableIndexes {
  const rowById = new Map<string, AssetRow>();
  const rowIndexById = new Map<string, number>();
  const propertyByKey = new Map<string, PropertyConfig>();
  const propertyIndexByKey = new Map<string, number>();
  const cellCoordinatesByKey = new Map<string, CellCoordinates>();

  rows.forEach((row, rowIndex) => {
    rowById.set(row.id, row);
    rowIndexById.set(row.id, rowIndex);
  });
  properties.forEach((property, propertyIndex) => {
    propertyByKey.set(property.key, property);
    propertyIndexByKey.set(property.key, propertyIndex);
  });
  rows.forEach((row, rowIndex) => {
    properties.forEach((property, propertyIndex) => {
      cellCoordinatesByKey.set(`${row.id}-${property.key}`, { rowIndex, propertyIndex });
    });
  });

  return {
    rows,
    properties,
    rowById,
    rowIndexById,
    propertyByKey,
    propertyIndexByKey,
    cellCoordinatesByKey,
  };
}

export function getSelectionBounds(
  selectedCells: ReadonlySet<string>,
  indexes: TableIndexes,
): TableSelectionBounds | null {
  let minRowIndex = Infinity;
  let maxRowIndex = -Infinity;
  let minPropertyIndex = Infinity;
  let maxPropertyIndex = -Infinity;

  selectedCells.forEach((cellKey) => {
    const coordinates = indexes.cellCoordinatesByKey.get(cellKey);
    if (!coordinates) return;
    minRowIndex = Math.min(minRowIndex, coordinates.rowIndex);
    maxRowIndex = Math.max(maxRowIndex, coordinates.rowIndex);
    minPropertyIndex = Math.min(minPropertyIndex, coordinates.propertyIndex);
    maxPropertyIndex = Math.max(maxPropertyIndex, coordinates.propertyIndex);
  });

  if (!Number.isFinite(minRowIndex) || !Number.isFinite(minPropertyIndex)) return null;
  return { minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex };
}

export function buildClipboardMatrix<T>(
  selectedCells: ReadonlySet<string>,
  indexes: TableIndexes,
  getValue: (row: AssetRow, property: PropertyConfig) => T,
): Array<Array<T | null>> {
  const bounds = getSelectionBounds(selectedCells, indexes);
  if (!bounds) return [];

  const matrix: Array<Array<T | null>> = [];
  for (let rowIndex = bounds.minRowIndex; rowIndex <= bounds.maxRowIndex; rowIndex += 1) {
    const row = indexes.rows[rowIndex];
    const values: Array<T | null> = [];
    for (
      let propertyIndex = bounds.minPropertyIndex;
      propertyIndex <= bounds.maxPropertyIndex;
      propertyIndex += 1
    ) {
      const property = indexes.properties[propertyIndex];
      values.push(
        selectedCells.has(`${row.id}-${property.key}`) ? getValue(row, property) : null,
      );
    }
    matrix.push(values);
  }
  return matrix;
}
