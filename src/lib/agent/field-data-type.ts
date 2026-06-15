/**
 * Field data type normalization. Both the canonical type list and the alias map
 * are derived from the single source of truth in `field-type-catalog.ts`, so the
 * two never drift apart.
 */

import type { PropertyConfig } from '@/lib/types/libraryAssets';
import { FIELD_TYPE_CATALOG, type FieldDataType } from './field-type-catalog';

export const SUPPORTED_FIELD_DATA_TYPES: readonly FieldDataType[] = FIELD_TYPE_CATALOG.map(
  (spec) => spec.dataType
);

const CANONICAL_SET = new Set<string>(SUPPORTED_FIELD_DATA_TYPES);

/** Alias -> canonical type, built from each catalog entry's `aliases`. */
const ALIASES: Record<string, FieldDataType> = (() => {
  const map: Record<string, FieldDataType> = {};
  for (const spec of FIELD_TYPE_CATALOG) {
    for (const alias of spec.aliases ?? []) {
      map[alias] = spec.dataType;
    }
  }
  return map;
})();

export function normalizeFieldDataType(input: string): PropertyConfig['dataType'] | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase().replace(/\s+/g, '_');
  if (CANONICAL_SET.has(lower)) {
    return lower as FieldDataType;
  }

  const alias = ALIASES[trimmed] ?? ALIASES[lower];
  return alias ?? null;
}
