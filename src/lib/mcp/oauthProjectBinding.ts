const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Extract a project ID only from the final segment of a project-bound MCP
 * resource URL. Any other shape is intentionally treated as unbound.
 */
export function projectIdFromOAuthResource(resource: unknown): string | null {
  if (typeof resource !== 'string') return null;

  try {
    const parts = new URL(resource).pathname.split('/').filter(Boolean);
    const index = parts.lastIndexOf('mcp');
    if (index < 0 || index !== parts.length - 2) return null;
    return UUID.test(parts[index + 1]) ? parts[index + 1] : null;
  } catch {
    return null;
  }
}
