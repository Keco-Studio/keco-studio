import { buildProjectResourceUrl, buildProtectedResourceMetadata } from '@/lib/mcp/oauthMetadata';

const projectId = '11111111-1111-4111-8111-111111111111';

it('builds project-bound resource metadata for Supabase Auth', () => {
  const resource = buildProjectResourceUrl('https://abc.supabase.co/', projectId);
  expect(resource).toBe(`https://abc.supabase.co/functions/v1/mcp/${projectId}`);
  expect(buildProtectedResourceMetadata({
    resource,
    authorizationServer: 'https://abc.supabase.co/auth/v1',
  })).toEqual({
    resource,
    authorization_servers: ['https://abc.supabase.co/auth/v1'],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
  });
});

it('rejects malformed project IDs', () => {
  expect(() => buildProjectResourceUrl('https://abc.supabase.co', '../other')).toThrow(
    'Invalid MCP project ID.'
  );
});
