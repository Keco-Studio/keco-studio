/**
 * Error serialization utilities.
 * Supabase PostgrestError and some Error subclasses have non-enumerable
 * properties that show as {} when logged directly.
 */
export function serializeError(error: unknown): string {
  if (error == null) return String(error);
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const parts: string[] = [];
    if (e.message != null) parts.push(String(e.message));
    if (e.code != null) parts.push(`code: ${e.code}`);
    if (e.details != null) parts.push(`details: ${e.details}`);
    if (e.hint != null) parts.push(`hint: ${e.hint}`);
    if (parts.length > 0) return parts.join(' | ');
  }
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
