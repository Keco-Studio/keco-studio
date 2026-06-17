/**
 * Shared emptiness checks and reference resolution for agent tools.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assetHasAnyNonEmptyDisplayValue,
  buildAllReferenceSelectionsForAsset,
  buildReferenceSelectionForAsset,
  cellDisplayString,
  getAssetDisplayLabel,
  getFilledColumnLabels,
  hasNonEmptyDisplayValue,
  isAssetEmpty,
  isAssetEmptyForDisplay,
  sortAssetsForUiRow,
  type ReferenceFieldLite,
} from '@/lib/utils/assetEmptiness';
import {
  normalizeReferenceSelections,
  looksLikeNonEmptyReferenceInput,
  referenceSelectionsToValue,
  type ReferenceSelection,
} from '@/lib/utils/referenceValue';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

export { isAssetEmpty, buildAllReferenceSelectionsForAsset } from '@/lib/utils/assetEmptiness';

/** A reference selection plus the 1-based UI row it originates from. */
export type LibraryReferenceSelection = ReferenceSelection & { rowIndex: number };

/**
 * Build one reference selection per non-empty cell across all non-empty rows of a
 * source library. Unlike buildReferenceSelectionForAsset (first cell only), this
 * yields every visible cell — matching the UI reference-picker granularity.
 */
export function buildLibraryReferenceSelections(
  assets: AssetRow[],
  fields: ReferenceFieldLite[]
): LibraryReferenceSelection[] {
  const sorted = sortAssetsForUiRow(assets);
  const selections: LibraryReferenceSelection[] = [];

  for (let index = 0; index < sorted.length; index++) {
    const asset = sorted[index];
    const propertyValues = asset.propertyValues ?? {};
    if (isAssetEmptyForDisplay(propertyValues)) continue;

    for (const selection of buildAllReferenceSelectionsForAsset(asset.id, propertyValues, fields)) {
      selections.push({ ...selection, rowIndex: index + 1 });
    }
  }

  return selections;
}

export type QueryAssetRow = {
  id: string;
  name: string;
  /** 1-based table row order in the library (matches UI row numbers). */
  rowIndex: number;
  values: Record<string, unknown>;
  /** True when the row has no visible cell data (matches UI empty rows). */
  isEmpty: boolean;
  /** First non-empty column display text; empty string when isEmpty. */
  displayLabel: string;
  /** Labels of all columns with visible values on this row (all sections). */
  filledColumns: string[];
};

export type NonEmptyCellEntry = {
  assetId: string;
  /** field_id — identifies the cell within the row (composite with assetId). */
  fieldId: string;
  rowIndex: number;
  column: string;
  value: unknown;
};

/** One reference chip = one non-empty cell (assetId + fieldId). */
export type QueryReferenceTarget = ReferenceSelection & {
  rowIndex: number;
};

export type QueryAssetSummary = {
  /** Total asset rows in the library (including empty). */
  totalAssets: number;
  /** Asset rows with at least one visible cell (all sections combined). */
  nonEmptyAssetCount: number;
  /** Count of individual non-empty cells across all non-empty assets. */
  nonEmptyCellCount: number;
  /** Rows returned after filters (includeEmpty, nameFilter, type, limit, rowIndex). */
  returnedRows: number;
  /** Empty asset rows excluded when includeEmpty=false. */
  emptyAssetsExcluded: number;
};

/** Flatten every visible cell on non-empty rows (one entry per filled column). */
export function buildNonEmptyCellEntries(
  rows: QueryAssetRow[],
  labelToFieldId: Record<string, string> = {}
): NonEmptyCellEntry[] {
  const entries: NonEmptyCellEntry[] = [];
  for (const row of rows) {
    if (row.isEmpty) continue;
    for (const [column, value] of Object.entries(row.values)) {
      if (!hasNonEmptyDisplayValue(value)) continue;
      entries.push({
        assetId: row.id,
        fieldId: labelToFieldId[column] ?? column,
        rowIndex: row.rowIndex,
        column,
        value,
      });
    }
  }
  return entries.sort(
    (a, b) =>
      a.rowIndex - b.rowIndex ||
      a.column.localeCompare(b.column) ||
      a.assetId.localeCompare(b.assetId)
  );
}

/**
 * Build reference targets for every non-empty cell (matches UI reference picker granularity).
 * Use referenceTargets — not row.id — when writing reference fields.
 */
export function buildReferenceTargetsFromAssets(
  assets: AssetRow[],
  fieldDefs: Array<{ key: string; name: string }>
): QueryReferenceTarget[] {
  const sorted = sortAssetsForUiRow(assets);
  const targets: QueryReferenceTarget[] = [];

  for (let index = 0; index < sorted.length; index++) {
    const asset = sorted[index];
    const propertyValues = asset.propertyValues ?? {};
    if (isAssetEmptyForDisplay(propertyValues)) continue;

    for (const field of fieldDefs) {
      const displayValue = cellDisplayString(propertyValues[field.key]);
      if (displayValue === '') continue;
      targets.push({
        assetId: asset.id,
        fieldId: field.key,
        fieldLabel: field.name,
        displayValue,
        rowIndex: index + 1,
      });
    }
  }

  return targets;
}

export function filterReferenceTargets(
  targets: QueryReferenceTarget[],
  options: { rowIndex?: number }
): QueryReferenceTarget[] {
  if (options.rowIndex !== undefined) {
    return targets.filter((target) => target.rowIndex === options.rowIndex);
  }
  return targets;
}

function buildReferenceSelectionForField(
  assetId: string,
  fieldId: string,
  propertyValues: Record<string, unknown>,
  fields: ReferenceFieldLite[]
): ReferenceSelection | null {
  const displayValue = cellDisplayString(propertyValues[fieldId]);
  if (displayValue === '') return null;
  const field = fields.find((f) => f.id === fieldId);
  return {
    assetId,
    fieldId,
    fieldLabel: field?.label ?? fieldId,
    displayValue,
  };
}

const normFieldKey = (s: string) => s.trim().toLowerCase();

/** Map agent-supplied fieldId (uuid or semantic label) to a library field definition id. */
export function resolveReferenceFieldId(
  fieldIdOrLabel: string,
  fields: ReferenceFieldLite[]
): string | null {
  const raw = fieldIdOrLabel.trim();
  if (!raw) return null;
  if (fields.some((f) => f.id === raw)) return raw;
  const byNorm = fields.find((f) => normFieldKey(f.label) === normFieldKey(raw));
  if (byNorm) return byNorm.id;
  const byExact = fields.find((f) => f.label === raw);
  return byExact?.id ?? null;
}

function isPlaceholderReferenceDisplay(value: string | null | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.toLowerCase() === 'untitled';
}

/** Build a persisted ReferenceSelection from agent/query input with robust fallbacks. */
function buildAgentReferenceSelection(
  sel: ReferenceSelection,
  propertyValues: Record<string, unknown>,
  fields: ReferenceFieldLite[]
): ReferenceSelection | null {
  if (sel.fieldId) {
    const resolvedFieldId = resolveReferenceFieldId(sel.fieldId, fields) ?? sel.fieldId;
    const specific = buildReferenceSelectionForField(
      sel.assetId,
      resolvedFieldId,
      propertyValues,
      fields
    );
    if (specific) return specific;

    const fallback = buildReferenceSelectionForAsset(sel.assetId, propertyValues, fields);
    if (fallback) return fallback;

    const inputDisplay = sel.displayValue?.trim();
    if (inputDisplay && !isPlaceholderReferenceDisplay(inputDisplay)) {
      const field = fields.find((f) => f.id === resolvedFieldId);
      return {
        assetId: sel.assetId,
        fieldId: resolvedFieldId,
        fieldLabel: sel.fieldLabel ?? field?.label ?? resolvedFieldId,
        displayValue: inputDisplay,
      };
    }

    return null;
  }

  return buildReferenceSelectionForAsset(sel.assetId, propertyValues, fields);
}

export function buildQueryAssetSummary(
  allRows: QueryAssetRow[],
  returnedRows: QueryAssetRow[],
  options: { includeEmpty: boolean; rowIndex?: number },
  labelToFieldId: Record<string, string> = {}
): QueryAssetSummary {
  const nonEmptyRows = allRows.filter((row) => !row.isEmpty);
  const nonEmptyCells = buildNonEmptyCellEntries(nonEmptyRows, labelToFieldId);
  const emptyAssetsExcluded =
    options.rowIndex !== undefined || options.includeEmpty
      ? 0
      : allRows.filter((row) => row.isEmpty).length;

  return {
    totalAssets: allRows.length,
    nonEmptyAssetCount: nonEmptyRows.length,
    nonEmptyCellCount: nonEmptyCells.length,
    returnedRows: returnedRows.length,
    emptyAssetsExcluded,
  };
}

export function buildQueryAssetRows(
  assets: AssetRow[],
  labelMap: Record<string, string>,
  orderedFieldIds: string[] = []
): QueryAssetRow[] {
  return sortAssetsForUiRow(assets).map((asset, index) => {
    const propertyValues = asset.propertyValues ?? {};
    const values: Record<string, unknown> = {};
    for (const [fieldId, value] of Object.entries(propertyValues)) {
      const label = labelMap[fieldId] ?? fieldId;
      values[label] = value;
    }
    const empty = isAssetEmptyForDisplay(propertyValues);
    return {
      id: asset.id,
      name: asset.name,
      rowIndex: index + 1,
      values,
      isEmpty: empty,
      displayLabel: empty ? '' : getAssetDisplayLabel(propertyValues, orderedFieldIds),
      filledColumns: getFilledColumnLabels(propertyValues, orderedFieldIds, labelMap),
    };
  });
}

export function sortQueryAssetRowsByRowIndex(rows: QueryAssetRow[]): QueryAssetRow[] {
  return [...rows].sort((a, b) => a.rowIndex - b.rowIndex || a.id.localeCompare(b.id));
}

export type QueryAssetFilterOptions = {
  includeEmpty?: boolean;
  /** When set, return only this UI row (rowIndex). Ignores empty-row exclusion. */
  rowIndex?: number;
  nameFilter?: string;
  type?: string;
  typeFieldLabel?: string;
  limit?: number;
};

export function applyQueryAssetFilters(
  rows: QueryAssetRow[],
  options: QueryAssetFilterOptions
): QueryAssetRow[] {
  if (options.rowIndex !== undefined) {
    return rows.filter((row) => row.rowIndex === options.rowIndex);
  }

  let filtered = rows;

  if (!options.includeEmpty) {
    filtered = filtered.filter((row) => !row.isEmpty);
  }

  if (options.nameFilter) {
    const needle = options.nameFilter.trim().toLowerCase();
    filtered = filtered.filter((row) => row.name.toLowerCase().includes(needle));
  }

  if (options.type && options.typeFieldLabel) {
    const needle = options.type.trim().toLowerCase();
    const typeLabel = options.typeFieldLabel;
    filtered = filtered.filter((row) =>
      String(row.values[typeLabel] ?? '')
        .toLowerCase()
        .includes(needle)
    );
  }

  if (options.limit) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
}

/** Target asset IDs with no visible field values (not referenceable). */
export async function findEmptyReferenceTargetIds(
  supabase: SupabaseClient,
  targetAssetIds: string[]
): Promise<string[]> {
  const uniqueIds = [...new Set(targetAssetIds.map((id) => id.trim()).filter((id) => id !== ''))];
  if (uniqueIds.length === 0) return [];

  const { data, error } = await supabase
    .from('library_asset_values')
    .select('asset_id, field_id, value_json')
    .in('asset_id', uniqueIds);

  if (error) {
    throw new Error(`Failed to load reference target values: ${error.message}`);
  }

  const valuesByAsset = new Map<string, Record<string, unknown>>();
  for (const row of data ?? []) {
    const assetId = row.asset_id as string;
    if (!valuesByAsset.has(assetId)) valuesByAsset.set(assetId, {});
    valuesByAsset.get(assetId)![row.field_id as string] = row.value_json;
  }

  return uniqueIds.filter((id) => {
    const propertyValues = valuesByAsset.get(id) ?? {};
    return !assetHasAnyNonEmptyDisplayValue(propertyValues);
  });
}

const EMPTY_REFERENCE_ERROR =
  'Cannot reference empty asset(s): %s. These assets have no visible field values. Please fill in the target asset first, or choose a different reference target.';

const INVALID_REFERENCE_FORMAT_ERROR =
  'Invalid reference value: expected an array of { assetId, fieldId } objects. Pass referenceTargets from query_assets directly — do not wrap selections in an "item" key.';

export async function validateReferencePropertyValues(
  supabase: SupabaseClient,
  properties: PropertyConfig[],
  resolved: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const referenceFieldIds = new Set(
    properties.filter((property) => property.dataType === 'reference').map((property) => property.key)
  );

  const bareAssetIds: string[] = [];
  const cellTargets: Array<{ assetId: string; fieldId: string }> = [];

  for (const [fieldId, value] of Object.entries(resolved)) {
    if (!referenceFieldIds.has(fieldId)) continue;
    if (value === null || value === undefined) continue;

    const selections = normalizeReferenceSelections(value);
    if (selections.length === 0 && looksLikeNonEmptyReferenceInput(value)) {
      return { ok: false, error: INVALID_REFERENCE_FORMAT_ERROR };
    }

    for (const selection of selections) {
      if (selection.fieldId) {
        cellTargets.push({ assetId: selection.assetId, fieldId: selection.fieldId });
      } else {
        bareAssetIds.push(selection.assetId);
      }
    }
  }

  if (bareAssetIds.length === 0 && cellTargets.length === 0) return { ok: true };

  const emptyBareIds =
    bareAssetIds.length > 0 ? await findEmptyReferenceTargetIds(supabase, bareAssetIds) : [];
  const emptyCells =
    cellTargets.length > 0 ? await findEmptyReferenceCells(supabase, cellTargets) : [];

  const problems = [
    ...emptyBareIds.map((id) => `asset ${id}`),
    ...emptyCells.map((c) => `cell ${c.assetId}:${c.fieldId}`),
  ];
  if (problems.length === 0) return { ok: true };

  return {
    ok: false,
    error: EMPTY_REFERENCE_ERROR.replace('%s', problems.join(', ')),
  };
}

async function findEmptyReferenceCells(
  supabase: SupabaseClient,
  targets: Array<{ assetId: string; fieldId: string }>
): Promise<Array<{ assetId: string; fieldId: string }>> {
  const assetIds = [...new Set(targets.map((t) => t.assetId))];
  const { data, error } = await supabase
    .from('library_asset_values')
    .select('asset_id, field_id, value_json')
    .in('asset_id', assetIds);

  if (error) {
    throw new Error(`Failed to load reference target values: ${error.message}`);
  }

  const valueByCell = new Map<string, unknown>();
  for (const row of data ?? []) {
    valueByCell.set(`${row.asset_id}:${row.field_id}`, row.value_json);
  }

  return targets.filter((target) => {
    const raw = valueByCell.get(`${target.assetId}:${target.fieldId}`);
    return !hasNonEmptyDisplayValue(raw);
  });
}

async function loadReferenceFieldsByLibrary(
  supabase: SupabaseClient,
  libraryIds: string[]
): Promise<Map<string, ReferenceFieldLite[]>> {
  if (libraryIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('library_field_definitions')
    .select('id, library_id, label, order_index')
    .in('library_id', libraryIds)
    .order('order_index', { ascending: true });

  if (error) {
    throw new Error(`Failed to load reference field definitions: ${error.message}`);
  }

  const byLibrary = new Map<string, ReferenceFieldLite[]>();
  for (const row of data ?? []) {
    const libraryId = row.library_id as string;
    const list = byLibrary.get(libraryId) ?? [];
    list.push({
      id: row.id as string,
      label: row.label as string,
      orderIndex: row.order_index as number,
    });
    byLibrary.set(libraryId, list);
  }
  return byLibrary;
}

/**
 * Expand bare assetId strings into full ReferenceSelection objects with displayValue,
 * so reference chips show real labels instead of "Untitled".
 */
export async function resolveAgentReferencePropertyValues(
  supabase: SupabaseClient,
  properties: PropertyConfig[],
  resolved: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const referenceFields = properties.filter((property) => property.dataType === 'reference');
  if (referenceFields.length === 0) return resolved;

  const output: Record<string, unknown> = { ...resolved };

  for (const field of referenceFields) {
    const raw = resolved[field.key];
    if (raw === null || raw === undefined) continue;

    const normalized = normalizeReferenceSelections(raw);
    if (normalized.length === 0) continue;

    const targetAssetIds = [...new Set(normalized.map((sel) => sel.assetId))];
    const [{ data: assetRows, error: assetError }, { data: valueRows, error: valueError }] =
      await Promise.all([
        supabase.from('library_assets').select('id, library_id').in('id', targetAssetIds),
        supabase
          .from('library_asset_values')
          .select('asset_id, field_id, value_json')
          .in('asset_id', targetAssetIds),
      ]);

    if (assetError) {
      throw new Error(`Failed to load reference targets: ${assetError.message}`);
    }
    if (valueError) {
      throw new Error(`Failed to load reference target values: ${valueError.message}`);
    }

    const libraryIdByAsset = new Map<string, string>();
    for (const row of assetRows ?? []) {
      libraryIdByAsset.set(row.id as string, row.library_id as string);
    }

    const valuesByAsset = new Map<string, Record<string, unknown>>();
    for (const row of valueRows ?? []) {
      const assetId = row.asset_id as string;
      if (!valuesByAsset.has(assetId)) valuesByAsset.set(assetId, {});
      valuesByAsset.get(assetId)![row.field_id as string] = row.value_json;
    }

    const libraryIds = [...new Set([...libraryIdByAsset.values()])];
    const fieldsByLibrary = await loadReferenceFieldsByLibrary(supabase, libraryIds);

    const selections: ReferenceSelection[] = [];
    for (const sel of normalized) {
      const libraryId = libraryIdByAsset.get(sel.assetId);
      if (!libraryId) {
        throw new Error(`Reference target asset not found: ${sel.assetId}`);
      }
      const fields = fieldsByLibrary.get(libraryId) ?? [];
      const propertyValues = valuesByAsset.get(sel.assetId) ?? {};

      const built = buildAgentReferenceSelection(sel, propertyValues, fields);
      if (!built) {
        throw new Error(
          `Reference target has no non-empty cell values: ${sel.assetId}. Query the source library with includeEmpty=false and use referenceTargets.`
        );
      }
      selections.push(built);
    }

    if (selections.length === 0) {
      throw new Error(
        'Failed to resolve reference target(s). Pass referenceTargets from query_assets (assetId + fieldId per cell).'
      );
    }

    output[field.key] = referenceSelectionsToValue(selections);
  }

  return output;
}
