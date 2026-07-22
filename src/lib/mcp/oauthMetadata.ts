const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidMcpProjectIdError extends Error {
  constructor() {
    super('Invalid MCP project ID.');
    this.name = 'InvalidMcpProjectIdError';
  }
}

export class InvalidMcpMetadataConfigError extends Error {
  constructor() {
    super('Invalid MCP metadata configuration.');
    this.name = 'InvalidMcpMetadataConfigError';
  }
}

/**
 * Return the configured Supabase origin after rejecting path-bearing or
 * non-HTTP(S) values. URL#origin also removes an optional trailing slash.
 */
export function normalizeSupabaseOrigin(supabaseUrl: string): string {
  if (typeof supabaseUrl !== 'string' || supabaseUrl.length === 0 || supabaseUrl.trim() !== supabaseUrl) {
    throw new InvalidMcpMetadataConfigError();
  }

  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    throw new InvalidMcpMetadataConfigError();
  }

  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new InvalidMcpMetadataConfigError();
  }

  return parsed.origin;
}

export function buildProjectResourceUrl(supabaseUrl: string, projectId: string): string {
  if (!UUID.test(projectId)) throw new InvalidMcpProjectIdError();
  return `${normalizeSupabaseOrigin(supabaseUrl)}/functions/v1/mcp/${projectId}`;
}

export function buildProtectedResourceMetadata(input: {
  resource: string;
  authorizationServer: string;
}) {
  return {
    resource: input.resource,
    authorization_servers: [input.authorizationServer],
    bearer_methods_supported: ['header'],
  } as const;
}
