import { projectIdFromOAuthResource } from '@/lib/mcp/oauthProjectBinding';

const projectId = '11111111-1111-4111-8111-111111111111';

it('extracts a UUID from a project-bound Supabase MCP resource', () => {
  expect(projectIdFromOAuthResource(
    `https://abc.supabase.co/functions/v1/mcp/${projectId}`
  )).toBe(projectId);
});

it.each([undefined, null, '', 'https://abc.supabase.co/functions/v1/mcp/all', `https://x/mcp/${projectId}/extra`])(
  'rejects an unavailable or unbound OAuth resource: %p',
  (resource) => expect(projectIdFromOAuthResource(resource)).toBeNull()
);
