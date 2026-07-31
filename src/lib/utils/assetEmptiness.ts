/**
 * Shared asset emptiness helpers for UI reference pickers and agent tools.
 *
 * An asset is empty when it has no rows in library_asset_values (propertyValues {}).
 * The library_assets.name field (often "Untitled") is not part of this determination.
 */

import type { AssetRow } from '@/lib/types/libraryAssets';

/** Normalize a cell value to a display string; empty when null/blank. */
export function cellDisplayString(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (typeof raw === 'object') {
    return JSON.stringify(raw);
  }
  const s = String(raw).trim();
  if (s === '' || s === 'null' || s === 'undefined') return '';
  return s;
}

export function hasNonEmptyDisplayValue(raw: unknown): boolean {
  return cellDisplayString(raw) !== '';
}

export function isAssetEmpty(propertyValues: Record<string, unknown>): boolean {
  return Object.keys(propertyValues).length === 0;
}

/** True when at least one field has a non-empty display value. */
export function assetHasAnyNonEmptyDisplayValue(propertyValues: Record<string, unknown>): boolean {
  return Object.values(propertyValues).some(hasNonEmptyDisplayValue);
}

export function getReferencePickerDisplayValue(
  propertyValues: Record<string, unknown>,
  fieldId: string
): string {
  return cellDisplayString(propertyValues[fieldId]);
}

/** Used by query_assets / agent: row has no visible cell data. */
export function isAssetEmptyForDisplay(propertyValues: Record<string, unknown>): boolean {
  return !assetHasAnyNonEmptyDisplayValue(propertyValues);
}

export type ReferenceFieldLite = {
  id: string;
  label: string;
  orderIndex: number;
};

/** First non-empty column (by order_index) for reference chip display. */
export function buildReferenceSelectionForAsset(
  assetId: string,
  propertyValues: Record<string, unknown>,
  fields: ReferenceFieldLite[]
): {
  assetId: string;
  fieldId: string;
  fieldLabel: string;
  displayValue: string;
} | null {
  const sorted = [...fields].sort((a, b) => a.orderIndex - b.orderIndex);
  for (const field of sorted) {
    const displayValue = cellDisplayString(propertyValues[field.id]);
    if (displayValue !== '') {
      return {
        assetId,
        fieldId: field.id,
        fieldLabel: field.label,
        displayValue,
      };
    }
  }
  return null;
}

/** All non-empty columns (by order_index) for agent reference resolution. */
export function buildAllReferenceSelectionsForAsset(
  assetId: string,
  propertyValues: Record<string, unknown>,
  fields: ReferenceFieldLite[]
): Array<{
  assetId: string;
  fieldId: string;
  fieldLabel: string;
  displayValue: string;
}> {
  const sorted = [...fields].sort((a, b) => a.orderIndex - b.orderIndex);
  const selections: Array<{
    assetId: string;
    fieldId: string;
    fieldLabel: string;
    displayValue: string;
  }> = [];
  for (const field of sorted) {
    const displayValue = cellDisplayString(propertyValues[field.id]);
    if (displayValue !== '') {
      selections.push({
        assetId,
        fieldId: field.id,
        fieldLabel: field.label,
        displayValue,
      });
    }
  }
  return selections;
}

export function getAssetDisplayLabel(
  propertyValues: Record<string, unknown>,
  orderedFieldIds: string[]
): string {
  for (const fieldId of orderedFieldIds) {
    const display = cellDisplayString(propertyValues[fieldId]);
    if (display !== '') return display;
  }
  for (const value of Object.values(propertyValues)) {
    const display = cellDisplayString(value);
    if (display !== '') return display;
  }
  return '';
}

/** Column labels that have visible values on this asset row. */
export function getFilledColumnLabels(
  propertyValues: Record<string, unknown>,
  orderedFieldIds: string[],
  labelByFieldId: Record<string, string>
): string[] {
  return orderedFieldIds
    .filter((fieldId) => hasNonEmptyDisplayValue(propertyValues[fieldId]))
    .map((fieldId) => labelByFieldId[fieldId] ?? fieldId);
}

/**
 * Compare two assets in the same order as LibraryDataContext.allAssets / table row numbers.
 * row_index asc → created_at asc → id asc when row_index ties.
 *
 * Numbered rows sort before missing rowIndex (nulls last). Appending a new numbered
 * row among null-indexed peers therefore jumps to the top unless callers normalize
 * missing indices first — see rowsNeedRowIndexNormalize / getNextAppendRowIndex.
 */
export function compareAssetsForUiRow(a: AssetRow, b: AssetRow): number {
  if (typeof a.rowIndex === 'number' && typeof b.rowIndex === 'number') {
    if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
  } else if (typeof a.rowIndex === 'number') {
    return -1;
  } else if (typeof b.rowIndex === 'number') {
    return 1;
  }

  if (!a.created_at && !b.created_at) return a.id.localeCompare(b.id);
  if (!a.created_at) return 1;
  if (!b.created_at) return -1;
  const timeDiff = getAssetCreatedAtTime(a) - getAssetCreatedAtTime(b);
  return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
}

/** True when any row is missing a numeric rowIndex (needs normalize before append). */
export function rowsNeedRowIndexNormalize(
  rows: Array<{ rowIndex?: number | null }>
): boolean {
  return rows.some((row) => typeof row.rowIndex !== 'number');
}

/**
 * Next 1-based rowIndex for appending at the bottom of the current display order.
 * When any row lacks rowIndex, treat the list as about-to-be-normalized to 1..N
 * and return N + 1 (do not treat missing as 0 — that yields 1 and sorts to the top).
 */
export function getNextAppendRowIndex(
  rows: Array<{ rowIndex?: number | null }>
): number {
  if (rows.length === 0) return 1;
  if (rowsNeedRowIndexNormalize(rows)) return rows.length + 1;
  let max = 0;
  for (const row of rows) {
    if (typeof row.rowIndex === 'number' && row.rowIndex > max) max = row.rowIndex;
  }
  return max + 1;
}

const createdAtTimeByAsset = new WeakMap<AssetRow, { source: string | undefined; time: number }>();

function getAssetCreatedAtTime(asset: AssetRow): number {
  const cached = createdAtTimeByAsset.get(asset);
  if (cached && cached.source === asset.created_at) return cached.time;
  const time = asset.created_at ? Date.parse(asset.created_at) : Number.POSITIVE_INFINITY;
  createdAtTimeByAsset.set(asset, { source: asset.created_at, time });
  return time;
}

/** Same ordering as the library table UI (matches left-side row numbers). */
export function sortAssetsForUiRow(assets: AssetRow[]): AssetRow[] {
  return [...assets].sort(compareAssetsForUiRow);
}
