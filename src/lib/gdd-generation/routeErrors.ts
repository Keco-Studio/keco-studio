const SCHEMA_UNAVAILABLE_CODES = new Set(['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205']);

export function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function isGddSchemaUnavailable(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return code !== null && SCHEMA_UNAVAILABLE_CODES.has(code);
}

export function safeGddRouteErrorIdentity(error: unknown): { name: string; code: string | null } {
  return {
    name: error instanceof Error ? error.name : 'DatabaseSchemaUnavailable',
    code: databaseErrorCode(error),
  };
}
