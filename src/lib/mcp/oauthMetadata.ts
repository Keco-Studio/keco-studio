const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildProjectResourceUrl(supabaseUrl: string, projectId: string): string {
  if (!UUID.test(projectId)) throw new Error('Invalid MCP project ID.');
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/mcp/${projectId}`;
}

export function buildProtectedResourceMetadata(input: {
  resource: string;
  authorizationServer: string;
}) {
  return {
    resource: input.resource,
    authorization_servers: [input.authorizationServer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
  } as const;
}
