/**
 * Field name -> fieldId resolution for create_asset / update_asset.
 *
 * The LLM works with semantic field names (e.g. "type", "tags"). This module maps
 * them to the internal library_field_definitions ids, the same data source as
 * the schema/predefine page.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface FieldResolution {
  /** fieldId -> value, ready for createAsset/updateAsset propertyValues. */
  resolved: Record<string, unknown>;
  /** Semantic field names that could not be matched. */
  unresolved: string[];
  /** All available field labels for the library (for error feedback to the LLM). */
  availableFields: string[];
}

interface FieldDef {
  id: string;
  label: string;
}

async function loadFieldDefs(supabase: SupabaseClient, libraryId: string): Promise<FieldDef[]> {
  const { data, error } = await supabase
    .from('library_field_definitions')
    .select('id, label')
    .eq('library_id', libraryId);
  if (error) {
    throw new Error(`Failed to load field definitions: ${error.message}`);
  }
  return (data ?? []).map((row) => ({ id: row.id as string, label: row.label as string }));
}

const norm = (s: string) => s.trim().toLowerCase();

/** True for a non-null, non-array plain object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Unwrap a `{ item: X }` wrapper that MiniMax-M3 sometimes emits around values. */
function unwrapItem(value: unknown): unknown {
  if (isPlainObject(value) && Object.keys(value).length === 1 && 'item' in value) {
    return value.item;
  }
  return value;
}

/**
 * Normalize the LLM-provided propertyValues before field resolution.
 *
 * MiniMax-M3 occasionally wraps values (and even whole field maps) in a spurious
 * `{ "item": ... }` envelope, e.g. {"acquisition": {"item": ["a"]}} or
 * {"item": {"currencyType": "x"}}. Reference values ([{ assetId, fieldId }]) are
 * arrays and are left untouched.
 */
export function normalizeLlmPropertyValues(
  propertyValues: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!propertyValues) return propertyValues;

  // Flatten a top-level `item` envelope wrapping the whole field map.
  let entries = propertyValues;
  if (isPlainObject(entries.item) && Object.keys(entries.item).length > 0) {
    const { item, ...rest } = entries;
    entries = { ...(item as Record<string, unknown>), ...rest };
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    out[key] = unwrapItem(value);
  }
  return out;
}

/** True when the caller sent propertyValues but it resolves to no fields after normalization. */
export function isExplicitEmptyPropertyValues(params: unknown): boolean {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
  const record = params as Record<string, unknown>;
  if (!('propertyValues' in record)) return false;

  const raw = record.propertyValues;
  if (raw === undefined) return false;
  if (!isPlainObject(raw)) return true;

  const normalized = normalizeLlmPropertyValues(raw);
  return !normalized || Object.keys(normalized).length === 0;
}

/** Error text fed back to the LLM when propertyValues is empty. */
export function buildEmptyPropertyValuesError(availableFields: string[]): string {
  const fields = availableFields.join(', ') || '(none)';
  const exampleKey = availableFields[0] ?? 'fieldName';
  return (
    `propertyValues is empty — no cell data will be written. ` +
    `Re-issue the tool call with at least one field value keyed by field name. ` +
    `Available fields: ${fields}. Example: {"${exampleKey}": "value"}.`
  );
}

/**
 * Translate semantic field-name keyed values into fieldId-keyed values.
 * Matching is exact first, then case-insensitive / trimmed.
 */
export async function resolvePropertyValues(
  supabase: SupabaseClient,
  libraryId: string,
  rawPropertyValues: Record<string, unknown> | undefined
): Promise<FieldResolution> {
  const defs = await loadFieldDefs(supabase, libraryId);
  const availableFields = defs.map((d) => d.label);

  const resolved: Record<string, unknown> = {};
  const unresolved: string[] = [];

  const propertyValues = normalizeLlmPropertyValues(rawPropertyValues);
  if (!propertyValues || Object.keys(propertyValues).length === 0) {
    return { resolved, unresolved, availableFields };
  }

  const byExact = new Map<string, string>();
  const byNorm = new Map<string, string>();
  for (const def of defs) {
    byExact.set(def.label, def.id);
    byNorm.set(norm(def.label), def.id);
  }

  for (const [name, value] of Object.entries(propertyValues)) {
    // Allow the LLM to pass a fieldId directly (idempotent / advanced use).
    if (defs.some((d) => d.id === name)) {
      resolved[name] = value;
      continue;
    }
    const fieldId = byExact.get(name) ?? byNorm.get(norm(name));
    if (fieldId) {
      resolved[fieldId] = value;
    } else {
      unresolved.push(name);
    }
  }

  return { resolved, unresolved, availableFields };
}
