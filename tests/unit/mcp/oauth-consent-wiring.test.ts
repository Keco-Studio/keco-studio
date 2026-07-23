import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/components/mcp/OAuthConsentClient.tsx'),
  'utf8'
);

it('uses the supported Supabase OAuth consent APIs', () => {
  expect(source).toContain('getAuthorizationDetails');
  expect(source).toContain('getOAuthAuthorizationResource');
  expect(source).toContain('approveAuthorization');
  expect(source).toContain('denyAuthorization');
});

it('completes an auto-approved authorization without any project grant', () => {
  expect(source).not.toContain("from '@/lib/mcp/oauthProjectGrant'");
  expect(source).not.toContain('prepareOAuthProjectGrant(');
  expect(source).not.toContain('finalizeOAuthProjectGrant(');
  expect(source).toContain('window.location.assign(next.redirect_url)');
});

it('loads the account or project binding independently from public authorization details', () => {
  expect(source).toContain("from '@/lib/mcp/oauthAuthorizationResource'");
  expect(source).toContain('classifyOAuthResource');
  expect(source).toContain('details: { ...next, resource }');
  expect(source).toContain('latestResource');
});

it('blocks approval when the authorization details omit a recognized resource binding', () => {
  expect(source).toContain('if (!binding)');
  expect(source).toContain('Project binding was not preserved by the authorization server.');
  expect(source).toContain('!currentVerifiedBinding');
  expect(source).toContain("action === 'approve' && !binding");
});

it('renders account consent without a project lookup while retaining legacy project checks', () => {
  expect(source).toContain("mode: 'account'");
  expect(source).toContain("binding.mode === 'project'");
  expect(source).toContain("'the Keco account'");
});
