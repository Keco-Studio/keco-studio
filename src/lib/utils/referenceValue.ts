/**
 * Normalize reference property values.
 *
 * Historical behavior: `reference` value stored as a single assetId string (or null/empty).
 * New behavior: allow multi-select, store as `string[]` (or null when empty).
 */
export function normalizeReferenceValueToAssetIds(value: unknown): string[] {
  if (value === null || value === undefined) return [];

  // New format: string[]
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === 'string' && v.trim() !== '').map((v) => v);
  }

  // Old format: single string
  if (typeof value === 'string') {
    const s = value.trim();
    return s ? [s] : [];
  }

  return [];
}

/** null when empty (product requirement) */
export function assetIdsToReferenceValue(assetIds: string[]): string[] | null {
  if (!assetIds || assetIds.length === 0) return null;
  return assetIds;
}

