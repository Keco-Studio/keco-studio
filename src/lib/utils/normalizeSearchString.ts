/**
 * Used for global search and move-library folder filter: strip spaces/underscores
 * so queries like "ab" match names like "a b" (same behavior as Search all).
 */
export function normalizeSearchString(value: string): string {
  return value.toLowerCase().replace(/[\s_]+/g, '');
}
