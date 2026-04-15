/**
 * Normalize reference property values.
 *
 * Historical behavior: `reference` value stored as a single assetId string (or null/empty).
 * New behavior: allow multi-select, store as `string[]` (or null when empty).
 */
export function normalizeReferenceValueToAssetIds(value: unknown): string[] {
  if (value === null || value === undefined) return [];

  // New format: string[] or ReferenceSelection[]
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === 'string') return v.trim();
        if (v && typeof v === 'object') {
          const anyV = v as { assetId?: unknown; id?: unknown };
          const raw = typeof anyV.assetId === 'string' ? anyV.assetId : typeof anyV.id === 'string' ? anyV.id : '';
          return raw.trim();
        }
        return '';
      })
      .filter((v) => v !== '');
  }

  // Old format: single string
  if (typeof value === 'string') {
    const s = value.trim();
    return s ? [s] : [];
  }

  return [];
}

export type ReferenceSelection = {
  assetId: string;
  fieldId?: string | null;
  fieldLabel?: string | null;
  displayValue?: string | null;
};

export function normalizeReferenceSelections(value: unknown): ReferenceSelection[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    if (typeof value === 'string' && value.trim() !== '') {
      return [{ assetId: value.trim() }];
    }
    return [];
  }

  const normalized = value
    .map((v) => {
      if (typeof v === 'string') {
        const assetId = v.trim();
        return assetId ? ({ assetId } as ReferenceSelection) : null;
      }
      if (v && typeof v === 'object') {
        const anyV = v as {
          assetId?: unknown;
          id?: unknown;
          fieldId?: unknown;
          fieldLabel?: unknown;
          displayValue?: unknown;
        };
        const assetIdRaw =
          typeof anyV.assetId === 'string'
            ? anyV.assetId
            : typeof anyV.id === 'string'
              ? anyV.id
              : '';
        const assetId = assetIdRaw.trim();
        if (!assetId) return null;
        return {
          assetId,
          fieldId: typeof anyV.fieldId === 'string' ? anyV.fieldId : null,
          fieldLabel: typeof anyV.fieldLabel === 'string' ? anyV.fieldLabel : null,
          displayValue: typeof anyV.displayValue === 'string' ? anyV.displayValue : null,
        } as ReferenceSelection;
      }
      return null;
    })
    .filter((v): v is ReferenceSelection => Boolean(v));

  // De-duplicate stable tuples to avoid runaway repeats after multiple edits.
  const seen = new Set<string>();
  const deduped: ReferenceSelection[] = [];
  for (const item of normalized) {
    const key = `${item.assetId}::${item.fieldId || ''}::${item.displayValue || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

/** null when empty (product requirement) */
export function assetIdsToReferenceValue(assetIds: string[]): string[] | null {
  if (!assetIds || assetIds.length === 0) return null;
  return assetIds;
}

export function referenceSelectionsToValue(
  selections: ReferenceSelection[]
): ReferenceSelection[] | null {
  if (!selections || selections.length === 0) return null;
  return selections;
}

