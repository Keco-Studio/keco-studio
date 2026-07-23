import { normalizeSupabaseOrigin } from './oauthMetadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MCP_ACCOUNT_PATH = '/functions/v1/mcp';
const MCP_PATH_PREFIX = '/functions/v1/mcp/';

/**
 * Classify only the exact account or legacy project MCP resource URL at the
 * configured Supabase origin. Any other origin or URL shape is unbound.
 */
export function classifyOAuthResource(
  resource: unknown
): { mode: 'account' } | { mode: 'project'; projectId: string } | null {
  if (typeof resource !== 'string' || resource.trim() !== resource) return null;

  try {
    const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!configuredUrl) return null;

    const configuredOrigin = normalizeSupabaseOrigin(configuredUrl);
    const parsed = new URL(resource);
    if (
      parsed.href !== resource ||
      parsed.origin !== configuredOrigin ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return null;
    }

    if (parsed.pathname === MCP_ACCOUNT_PATH) return { mode: 'account' };
    if (!parsed.pathname.startsWith(MCP_PATH_PREFIX)) return null;

    const projectId = parsed.pathname.slice(MCP_PATH_PREFIX.length);
    return UUID.test(projectId) ? { mode: 'project', projectId } : null;
  } catch {
    return null;
  }
}

/**
 * Retain the project-only helper for legacy callers while resource consumers
 * migrate to explicit account/project classification.
 */
export function projectIdFromOAuthResource(resource: unknown): string | null {
  const binding = classifyOAuthResource(resource);
  return binding?.mode === 'project' ? binding.projectId : null;
}
