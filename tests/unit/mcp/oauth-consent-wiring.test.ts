import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/components/mcp/OAuthConsentClient.tsx'),
  'utf8'
);

it('uses the supported Supabase OAuth consent APIs', () => {
  expect(source).toContain('getAuthorizationDetails');
  expect(source).toContain('approveAuthorization');
  expect(source).toContain('denyAuthorization');
});

it('blocks approval when the authorization details omit project resource binding', () => {
  expect(source).toContain('projectIdFromOAuthResource');
  expect(source).toContain('Project binding was not preserved by the authorization server.');
  expect(source).toMatch(/disabled=\{[^}]*!projectId/);
});
