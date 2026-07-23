import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorizationMetadataUrl, mcpMode, parseBearerMetadata, parseProbeArguments, runProbe } from '../../../scripts/probe-mcp-oauth';

const mcpUrl = 'https://keco.example.com/functions/v1/mcp';
const resourceMetadataUrl = 'https://keco.example.com/.well-known/oauth-protected-resource';
const issuer = 'https://abc.supabase.co/auth/v1';
const authMetadataUrl = 'https://abc.supabase.co/.well-known/oauth-authorization-server/auth/v1';

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function successfulResponses(): Response[] {
  return [
    jsonResponse({}, 401, { 'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"` }),
    jsonResponse({ resource: mcpUrl, authorization_servers: [issuer] }),
    jsonResponse({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register` }),
    jsonResponse({ client_id: 'probe-client', client_secret: 'never-record-this' }, 201),
    new Response('', { status: 200 }),
  ];
}

afterEach(() => jest.restoreAllMocks());

describe('OAuth probe helpers', () => {
  it('extracts the protected resource metadata URI', () => {
    expect(parseBearerMetadata('Bearer resource_metadata="https://keco.example.com/meta?id=1"')).toBe('https://keco.example.com/meta?id=1');
  });

  it('rejects a Bearer challenge without resource metadata', () => {
    expect(() => parseBearerMetadata('Bearer realm="keco"')).toThrow('MCP 401 response omitted resource_metadata.');
  });

  it('builds RFC 8414 metadata URLs for an issuer with a path', () => {
    expect(authorizationMetadataUrl(issuer)).toBe(authMetadataUrl);
  });

  it('distinguishes the root account URL from a UUID legacy URL', () => {
    expect(mcpMode(mcpUrl)).toBe('account');
    expect(mcpMode('https://keco.example.com/functions/v1/mcp/11111111-1111-4111-8111-111111111111')).toBe('legacy');
    expect(() => mcpMode('https://keco.example.com/functions/v1/mcp/not-a-project')).toThrow('MCP URL is not an account or legacy endpoint.');
  });

  it('parses exchange opt-in without accepting credential CLI arguments', () => {
    expect(parseProbeArguments(['--mcp-url', mcpUrl, '--output', 'evidence.json', '--redirect-uri', 'http://127.0.0.1/callback', '--exercise-code-exchange'])).toEqual({
      mcpUrl, output: 'evidence.json', redirectUri: 'http://127.0.0.1/callback', exerciseCodeExchange: true,
    });
  });
});

describe('OAuth account discovery probe', () => {
  it('records root discovery, DCR, and authorization without client credentials or endpoints', async () => {
    const responses = successfulResponses();
    const fetchMock = jest.fn(async () => responses.shift()!);
    const evidence = await runProbe(mcpUrl, 'http://127.0.0.1/oauth/callback', { fetchImpl: fetchMock as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const authorizationUrl = String(fetchMock.mock.calls[4][0]);
    expect(authorizationUrl).toContain(`resource=${encodeURIComponent(mcpUrl)}`);
    expect(evidence).toEqual(expect.objectContaining({ passed: true, mode: 'account',
      discovery: { protectedResource: 'succeeded', authorizationServerCount: 1 },
      oauth: { dynamicRegistration: 'succeeded', authorization: 'succeeded', codeExchange: 'not_exercised' },
    }));
    expect(JSON.stringify(evidence)).not.toContain('probe-client');
    expect(JSON.stringify(evidence)).not.toContain('never-record-this');
    expect(JSON.stringify(evidence)).not.toContain(mcpUrl);
  });

  it('binds the code exchange to this run\'s DCR client and PKCE verifier', async () => {
    const responses = [...successfulResponses(), jsonResponse({ access_token: 'must-not-appear' })];
    responses[4] = new Response('', { status: 302, headers: {
      location: 'http://127.0.0.1/oauth/callback?code=authorization-code-secret',
    } });
    const evidence = await runProbe(mcpUrl, 'http://127.0.0.1/oauth/callback', {
      fetchImpl: jest.fn(async () => responses.shift()!) as typeof fetch,
      exerciseCodeExchange: true,
    });
    expect(evidence).toEqual(expect.objectContaining({ oauth: expect.objectContaining({ codeExchange: 'succeeded' }) }));
    expect(JSON.stringify(evidence)).not.toContain('must-not-appear');
    expect(JSON.stringify(evidence)).not.toContain('authorization-code-secret');
  });

  it('fails exchange checks when authorization does not redirect with a code', async () => {
    const responses = successfulResponses();
    await expect(runProbe(mcpUrl, 'http://127.0.0.1/oauth/callback', {
      fetchImpl: jest.fn(async () => responses.shift()!) as typeof fetch,
      exerciseCodeExchange: true,
    })).rejects.toThrow('Authorization endpoint did not return an authorization code.');
  });

  it('fails closed when authorization metadata omits dynamic registration', async () => {
    const responses = successfulResponses();
    responses[2] = jsonResponse({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` });
    await expect(runProbe(mcpUrl, 'http://127.0.0.1/oauth/callback', { fetchImpl: jest.fn(async () => responses.shift()!) as typeof fetch }))
      .rejects.toThrow('Authorization metadata omitted registration_endpoint.');
  });
});

describe('OAuth probe CLI', () => {
  it('removes stale PASS evidence and prints a stable error when arguments are incomplete', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'keco-oauth-probe-'));
    const output = join(fixtureRoot, 'evidence.json');
    try {
      writeFileSync(output, '{"passed":true,"stale":true}\n', 'utf8');
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/probe-mcp-oauth.ts', '--output', output], { cwd: process.cwd(), encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr.trim()).toBe('OAuth probe failed.');
      expect(existsSync(output)).toBe(false);
      expect(readdirSync(fixtureRoot)).toEqual([]);
    } finally { rmSync(fixtureRoot, { recursive: true, force: true }); }
  });
});
