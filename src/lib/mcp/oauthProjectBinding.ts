import { normalizeSupabaseOrigin } from './oauthMetadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MCP_PATH_PREFIX = '/functions/v1/mcp/';

/**
 * Extract a project ID only from the exact project-bound MCP URL at the
 * configured Supabase origin. Any other origin or URL shape is unbound.
 */
export function projectIdFromOAuthResource(resource: unknown): string | null {
  if (typeof resource !== 'string' || resource.trim() !== resource) return null;

  try {
    const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!configuredUrl) return null;

    const configuredOrigin = normalizeSupabaseOrigin(configuredUrl);
    const parsed = new URL(resource);
    if (
      parsed.origin !== configuredOrigin ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      !parsed.pathname.startsWith(MCP_PATH_PREFIX)
    ) {
      return null;
    }

    const projectId = parsed.pathname.slice(MCP_PATH_PREFIX.length);
    return UUID.test(projectId) ? projectId : null;
  } catch {
    return null;
  }
}
