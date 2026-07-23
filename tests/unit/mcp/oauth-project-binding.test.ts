import {
  classifyOAuthResource,
  projectIdFromOAuthResource,
} from '@/lib/mcp/oauthProjectBinding';

const projectId = '11111111-1111-4111-8111-111111111111';
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
});

afterAll(() => {
  if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
});

it('extracts a UUID from a project-bound Supabase MCP resource', () => {
  expect(projectIdFromOAuthResource(
    `https://abc.supabase.co/functions/v1/mcp/${projectId}`
  )).toBe(projectId);
});

it('classifies the exact account and legacy project MCP resources', () => {
  expect(classifyOAuthResource('https://abc.supabase.co/functions/v1/mcp')).toEqual({
    mode: 'account',
  });
  expect(classifyOAuthResource(
    `https://abc.supabase.co/functions/v1/mcp/${projectId}`
  )).toEqual({ mode: 'project', projectId });
});

it.each([
  undefined,
  null,
  '',
  'https://abc.supabase.co/functions/v1/mcp/all',
  `https://x/mcp/${projectId}/extra`,
  `https://evil.example/functions/v1/mcp/${projectId}`,
  `http://abc.supabase.co/functions/v1/mcp/${projectId}`,
  `ftp://abc.supabase.co/functions/v1/mcp/${projectId}`,
  `https://abc.supabase.co:8443/functions/v1/mcp/${projectId}`,
  `https://user:pass@abc.supabase.co/functions/v1/mcp/${projectId}`,
  `https://abc.supabase.co/functions/v1/mcp/${projectId}?project=${projectId}`,
  `https://abc.supabase.co/functions/v1/mcp/${projectId}#fragment`,
  `https://abc.supabase.co/functions/v1/mcp/${projectId}/`,
  'https://abc.supabase.co/functions/v1/mcp/',
  'https://abc.supabase.co/functions/v1/mcp/../mcp',
  `https://abc.supabase.co/auth/functions/v1/mcp/${projectId}`,
  ` https://abc.supabase.co/functions/v1/mcp/${projectId}`,
])(
  'rejects an unavailable or unbound OAuth resource: %p',
  (resource) => expect(projectIdFromOAuthResource(resource)).toBeNull()
);

it.each([
  'https://abc.supabase.co/functions/v1/mcp/',
  'https://abc.supabase.co/functions/v1/mcp/extra',
  'https://abc.supabase.co/functions/v1/mcp?resource=other',
  'https://abc.supabase.co/functions/v1/mcp#fragment',
  'https://user:pass@abc.supabase.co/functions/v1/mcp',
])('rejects a non-exact account OAuth resource: %s', (resource) => {
  expect(classifyOAuthResource(resource)).toBeNull();
});

it.each([
  'http://127.0.0.1:54321',
  'https://abc.supabase.co/',
])('accepts a resource at the normalized configured origin: %s', (configuredUrl) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = configuredUrl;
  const origin = new URL(configuredUrl).origin;

  expect(projectIdFromOAuthResource(
    `${origin}/functions/v1/mcp/${projectId}`
  )).toBe(projectId);
});

it('fails closed when the trusted Supabase origin is missing or malformed', () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  expect(projectIdFromOAuthResource(
    `https://abc.supabase.co/functions/v1/mcp/${projectId}`
  )).toBeNull();

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co/auth/v1';
  expect(projectIdFromOAuthResource(
    `https://abc.supabase.co/functions/v1/mcp/${projectId}`
  )).toBeNull();
});
