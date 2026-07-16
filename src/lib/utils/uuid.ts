/**
 * Single source of truth for UUID validation.
 *
 * Several services and route parsers previously inlined their own
 * `8-4-4-4-12` regex. Import this helper instead of copying the pattern.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when `value` is a canonical (version 1-5) UUID string. */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
