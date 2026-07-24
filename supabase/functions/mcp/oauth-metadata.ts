const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METADATA_PATH = /^(?:\/functions\/v1)?\/mcp\/oauth-protected-resource$/;

export class InvalidMcpMetadataConfigError extends Error {
  constructor() {
    super("Invalid MCP metadata configuration.");
    this.name = "InvalidMcpMetadataConfigError";
  }
}

export class InvalidMcpMetadataRequestError extends Error {
  constructor() {
    super("Invalid MCP metadata request.");
    this.name = "InvalidMcpMetadataRequestError";
  }
}

function normalizeSupabaseOrigin(value: string | undefined): string {
  if (!value || value.trim() !== value) throw new InvalidMcpMetadataConfigError();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidMcpMetadataConfigError();
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username || parsed.password ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search || parsed.hash
  ) throw new InvalidMcpMetadataConfigError();
  return parsed.origin;
}

function validateProjectId(projectId: string | null | undefined): string | null {
  if (projectId === null || projectId === undefined) return null;
  if (!UUID.test(projectId)) throw new InvalidMcpMetadataRequestError();
  return projectId;
}

export function isProtectedResourceMetadataPath(url: URL): boolean {
  return !url.username && !url.password && !url.hash && METADATA_PATH.test(url.pathname);
}

export function parseProtectedResourceMetadataProjectId(url: URL): string | null {
  if (!isProtectedResourceMetadataPath(url)) throw new InvalidMcpMetadataRequestError();
  const entries = [...url.searchParams.entries()];
  if (entries.length === 0) {
    if (url.href.includes("?")) throw new InvalidMcpMetadataRequestError();
    return null;
  }
  if (entries.length !== 1 || entries[0][0] !== "project_id") {
    throw new InvalidMcpMetadataRequestError();
  }
  return validateProjectId(entries[0][1]);
}

export function buildProtectedResourceMetadata(
  supabaseUrl: string | undefined,
  projectId?: string | null,
) {
  const origin = normalizeSupabaseOrigin(supabaseUrl);
  const validProjectId = validateProjectId(projectId);
  const resource = validProjectId
    ? `${origin}/functions/v1/mcp/${validProjectId}`
    : `${origin}/functions/v1/mcp`;
  return {
    resource,
    authorization_servers: [`${origin}/auth/v1`],
    bearer_methods_supported: ["header"],
  } as const;
}

export function buildProtectedResourceMetadataUrl(
  supabaseUrl: string | undefined,
  projectId?: string | null,
): string {
  const origin = normalizeSupabaseOrigin(supabaseUrl);
  const validProjectId = validateProjectId(projectId);
  const base = `${origin}/functions/v1/mcp/oauth-protected-resource`;
  return validProjectId
    ? `${base}?project_id=${encodeURIComponent(validProjectId)}`
    : base;
}
