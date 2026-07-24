import type { FieldMapping, LibraryRole, StudioColumnDefinition } from './types';

const mappingCache = new Map<string, FieldMapping>();
const MAX_CACHE_ENTRIES = 100;

function mappingCacheKey(
  role: LibraryRole,
  columns: readonly StudioColumnDefinition[],
): string {
  return JSON.stringify([role, columns.map(({ id, label, valueType }) => [id, label, valueType ?? null])]);
}

function cacheMapping(key: string, mappings: FieldMapping): void {
  if (Object.keys(mappings).length === 0) return;
  if (mappingCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = mappingCache.keys().next().value;
    if (oldest) mappingCache.delete(oldest);
  }
  mappingCache.set(key, mappings);
}

function parseMappings(value: unknown): FieldMapping {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI field mapping response is invalid.');
  }

  const mappings: Record<string, string> = {};
  for (const [fieldId, columnId] of Object.entries(value)) {
    if (typeof columnId === 'string') mappings[fieldId] = columnId;
  }
  return mappings;
}

export async function requestAiFieldMappings(
  role: LibraryRole,
  columns: readonly StudioColumnDefinition[],
  accessToken: string,
  signal?: AbortSignal,
): Promise<FieldMapping> {
  const cacheKey = mappingCacheKey(role, columns);
  const cached = mappingCache.get(cacheKey);
  if (cached) return cached;

  const response = await fetch('/api/simulation/field-mapping', {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role, columns }),
    signal,
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload && typeof payload === 'object'
      ? (payload as { code?: unknown }).code
      : undefined;
    throw new Error(typeof code === 'string' ? `AI field mapping failed: ${code}` : 'AI field mapping failed.');
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('AI field mapping response is invalid.');
  }
  const mappings = parseMappings((payload as { mappings?: unknown }).mappings);
  cacheMapping(cacheKey, mappings);
  return mappings;
}
