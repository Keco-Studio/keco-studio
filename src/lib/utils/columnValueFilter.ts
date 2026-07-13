import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { valueToDisplayString } from '@/lib/utils/cellValueReplace';
import {
  normalizeReferenceSelections,
  resolveReferenceSelectionLabel,
} from '@/lib/utils/referenceValue';
import {
  createPropertyByName,
  evaluateFormulaForRow,
  getCustomFormulaExpressionFromCellValue,
} from '@/components/libraries/utils/formulaEvaluation';

/** Row visibility is controlled only by hidden row ids. */
export type RowVisibilityFilterState = {
  hiddenRowIds: Set<string>;
};

/** Optional context for column filters (e.g. reference label cache). */
export type ColumnFilterOptions = {
  assetNamesCache?: Record<string, string>;
  propertyByName?: ReadonlyMap<string, PropertyConfig>;
};

export function buildPropertyById(properties: PropertyConfig[]): Map<string, PropertyConfig> {
  return new Map(properties.map((property) => [property.id, property]));
}

function referenceValueToFilterString(
  raw: unknown,
  assetNamesCache: Record<string, string>
): string {
  const selections = normalizeReferenceSelections(raw);
  if (selections.length === 0) return '';

  const labels = selections
    .map((sel) => resolveReferenceSelectionLabel(sel, assetNamesCache).trim())
    .filter((label) => label !== '');
  return labels.join(' | ');
}

/** Display string used as the filter key for a cell value. */
export function getFilterDisplayValue(
  row: AssetRow,
  property: PropertyConfig | undefined,
  allProperties: PropertyConfig[] = [],
  options: ColumnFilterOptions = {}
): string {
  if (!property) return '';

  if (property.dataType === 'formula') {
    const customExpr = getCustomFormulaExpressionFromCellValue(row.propertyValues[property.key]);
    const effectiveExpr = customExpr ?? property.formulaExpression;
    if (!effectiveExpr) return '';

    const result = evaluateFormulaForRow(
      effectiveExpr,
      row,
      allProperties,
      new Set(),
      options.propertyByName,
    );
    if (typeof result === 'boolean') return result ? 'true' : 'false';
    if (result === null || result === undefined) return '';
    return String(result);
  }

  if (property.dataType === 'reference') {
    return referenceValueToFilterString(
      row.propertyValues[property.key],
      options.assetNamesCache ?? {}
    );
  }

  return valueToDisplayString(row.propertyValues[property.key], property.dataType ?? '');
}

export function isRowVisible(row: AssetRow, hiddenRowIds: Set<string>): boolean {
  return !hiddenRowIds.has(row.id);
}

export function filterRowsByVisibility(
  rows: AssetRow[],
  hiddenRowIds: Set<string>
): AssetRow[] {
  if (hiddenRowIds.size === 0) return rows;
  return rows.filter((row) => isRowVisible(row, hiddenRowIds));
}

/**
 * Checked values for a column filter UI: value is checked when every row
 * with that value in this column is visible (not in hiddenRowIds).
 */
export function getCheckedFilterValuesForColumn(
  rows: AssetRow[],
  property: PropertyConfig,
  hiddenRowIds: Set<string>,
  properties: PropertyConfig[],
  options: ColumnFilterOptions = {}
): Set<string> {
  const evaluationOptions = {
    ...options,
    propertyByName: options.propertyByName ?? createPropertyByName(properties),
  };
  const checked = new Set<string>();
  const rowsByValue = new Map<string, AssetRow[]>();

  for (const row of rows) {
    const value = getFilterDisplayValue(row, property, properties, evaluationOptions);
    const bucket = rowsByValue.get(value);
    if (bucket) {
      bucket.push(row);
    } else {
      rowsByValue.set(value, [row]);
    }
  }

  for (const [value, rowsWithValue] of rowsByValue) {
    if (rowsWithValue.every((row) => isRowVisible(row, hiddenRowIds))) {
      checked.add(value);
    }
  }

  return checked;
}

/** Map selected values in a column to hiddenRowIds updates (row-id based). */
export function applyColumnFilterByRowIds(
  rows: AssetRow[],
  property: PropertyConfig,
  selectedValues: Set<string>,
  hiddenRowIds: Set<string>,
  properties: PropertyConfig[],
  options: ColumnFilterOptions = {}
): Set<string> {
  const next = new Set(hiddenRowIds);
  const rowIdSet = new Set(rows.map((row) => row.id));
  const evaluationOptions = {
    ...options,
    propertyByName: options.propertyByName ?? createPropertyByName(properties),
  };

  for (const row of rows) {
    const value = getFilterDisplayValue(row, property, properties, evaluationOptions);
    if (selectedValues.has(value)) {
      next.delete(row.id);
    } else {
      next.add(row.id);
    }
  }

  for (const rowId of next) {
    if (!rowIdSet.has(rowId)) next.delete(rowId);
  }

  return next;
}

export function isColumnFilterActive(
  rows: AssetRow[],
  property: PropertyConfig,
  hiddenRowIds: Set<string>,
  properties: PropertyConfig[],
  options: ColumnFilterOptions = {}
): boolean {
  const allValues = collectColumnUniqueValues(rows, property, properties, options);
  const checked = getCheckedFilterValuesForColumn(
    rows,
    property,
    hiddenRowIds,
    properties,
    options
  );
  return checked.size < allValues.length;
}

export function collectColumnUniqueValues(
  rows: AssetRow[],
  property: PropertyConfig | undefined,
  allProperties: PropertyConfig[],
  options: ColumnFilterOptions = {}
): string[] {
  if (!property) return [];

  const values = new Set<string>();
  const evaluationOptions = {
    ...options,
    propertyByName: options.propertyByName ?? createPropertyByName(allProperties),
  };
  for (const row of rows) {
    values.add(getFilterDisplayValue(row, property, allProperties, evaluationOptions));
  }

  return Array.from(values).sort((a, b) => {
    if (a === '' && b !== '') return 1;
    if (b === '' && a !== '') return -1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function formatFilterValueLabel(value: string): string {
  return value === '' ? '(Blank)' : value;
}

export function getFilterValueInitial(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
}

export function createEmptyRowVisibilityFilterState(): RowVisibilityFilterState {
  return { hiddenRowIds: new Set() };
}
