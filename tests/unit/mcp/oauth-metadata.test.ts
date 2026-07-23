import {
  buildAccountResourceUrl,
  buildProjectResourceUrl,
  buildProtectedResourceMetadata,
  InvalidMcpMetadataConfigError,
  normalizeSupabaseOrigin,
} from '@/lib/mcp/oauthMetadata';
import { GET } from '@/app/api/mcp/oauth-protected-resource/route';

const projectId = '11111111-1111-4111-8111-111111111111';

it('builds project-bound resource metadata without unsupported scopes', () => {
  const resource = buildProjectResourceUrl('https://abc.supabase.co/', projectId);
  expect(resource).toBe(`https://abc.supabase.co/functions/v1/mcp/${projectId}`);
  const metadata = buildProtectedResourceMetadata({
    resource,
    authorizationServer: 'https://abc.supabase.co/auth/v1',
  });
  expect(metadata).toEqual({
    resource,
    authorization_servers: ['https://abc.supabase.co/auth/v1'],
    bearer_methods_supported: ['header'],
  });
  expect(metadata).not.toHaveProperty('scopes_supported');
});

it('builds account-scoped resource metadata without unsupported scopes', () => {
  const resource = buildAccountResourceUrl('https://abc.supabase.co/');

  expect(resource).toBe('https://abc.supabase.co/functions/v1/mcp');
  expect(buildProtectedResourceMetadata({
    resource,
    authorizationServer: 'https://abc.supabase.co/auth/v1',
  })).toEqual({
    resource,
    authorization_servers: ['https://abc.supabase.co/auth/v1'],
    bearer_methods_supported: ['header'],
  });
});

it('rejects malformed project IDs', () => {
  expect(() => buildProjectResourceUrl('https://abc.supabase.co', '../other')).toThrow(
    'Invalid MCP project ID.'
  );
});

it.each([
  '',
  'not a url',
  'ftp://abc.supabase.co',
  'https://abc.supabase.co/auth/v1',
  'https://abc.supabase.co?query=1',
  'https://abc.supabase.co#fragment',
  'https://user:pass@abc.supabase.co',
])('rejects malformed Supabase origins: %s', (supabaseUrl) => {
  expect(() => normalizeSupabaseOrigin(supabaseUrl)).toThrow(InvalidMcpMetadataConfigError);
});

describe('protected resource metadata route', () => {
  const accountRequest = () =>
    new Request('https://keco.example/api/mcp/oauth-protected-resource');
  const projectRequest = (project = projectId) =>
    new Request(`https://keco.example/api/mcp/oauth-protected-resource?project_id=${project}`);

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it('returns account metadata without a project ID', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co/';

    const response = GET(accountRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    await expect(response.json()).resolves.toEqual({
      resource: 'https://abc.supabase.co/functions/v1/mcp',
      authorization_servers: ['https://abc.supabase.co/auth/v1'],
      bearer_methods_supported: ['header'],
    });
  });

  it('returns legacy project metadata when a project ID is supplied', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co/';

    const response = GET(projectRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      resource: `https://abc.supabase.co/functions/v1/mcp/${projectId}`,
      authorization_servers: ['https://abc.supabase.co/auth/v1'],
      bearer_methods_supported: ['header'],
    });
  });

  it('returns 400 for an invalid project ID', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';

    const response = GET(projectRequest('not-a-project'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid MCP project metadata request.',
    });
  });

  it('fails closed with 500 when the Supabase URL is not configured', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = GET(accountRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'MCP metadata is not configured.',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      '[GET /api/mcp/oauth-protected-resource] Invalid metadata configuration'
    );
    errorSpy.mockRestore();
  });
});
