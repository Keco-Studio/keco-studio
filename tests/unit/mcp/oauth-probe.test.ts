import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authorizationMetadataUrl,
  parseBearerMetadata,
  parseProbeArguments,
  redactProbeEvidence,
  runProbe,
} from '../../../scripts/probe-mcp-oauth';

const mcpUrl = 'https://keco.example.com/functions/v1/mcp/project-1';
const resourceMetadataUrl = 'https://keco.example.com/.well-known/oauth-protected-resource/project-1';
const issuer = 'https://abc.supabase.co/auth/v1';
const authMetadataUrl = 'https://abc.supabase.co/.well-known/oauth-authorization-server/auth/v1';

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function successfulResponses(): Response[] {
  return [
    jsonResponse({}, 401, {
      'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`,
    }),
    jsonResponse({
      resource: mcpUrl,
      authorization_servers: [issuer],
    }),
    jsonResponse({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
    }),
    jsonResponse({
      client_id: 'probe-client',
      client_secret: 'never-record-this',
      registration_access_token: 'also-never-record-this',
    }, 201),
  ];
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('OAuth probe helpers', () => {
  it('extracts the protected resource metadata URI', () => {
    expect(parseBearerMetadata('Bearer resource_metadata="https://keco.example.com/meta?id=1"'))
      .toBe('https://keco.example.com/meta?id=1');
  });

  it('rejects a Bearer challenge without resource metadata', () => {
    expect(() => parseBearerMetadata('Bearer realm="keco"'))
      .toThrow('MCP 401 response omitted resource_metadata.');
  });

  it('rejects resource metadata outside an actual Bearer challenge', () => {
    expect(() => parseBearerMetadata(`Basic resource_metadata="${resourceMetadataUrl}"`))
      .toThrow('MCP 401 response omitted resource_metadata.');
  });

  it('extracts resource metadata from Bearer when multiple challenges are present', () => {
    expect(parseBearerMetadata(
      `Basic realm="legacy", Bearer realm="keco", resource_metadata="${resourceMetadataUrl}"`
    )).toBe(resourceMetadataUrl);
  });

  it('builds RFC 8414 metadata URLs for an issuer with a path', () => {
    expect(authorizationMetadataUrl('https://abc.supabase.co/auth/v1'))
      .toBe(authMetadataUrl);
  });

  it('removes issuer query and fragment components from the metadata URL', () => {
    expect(authorizationMetadataUrl('https://auth.example.com/tenant/?source=test#fragment'))
      .toBe('https://auth.example.com/.well-known/oauth-authorization-server/tenant');
  });

  it('redacts credential-shaped values recursively', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature';

    expect(redactProbeEvidence({
      access_token: 'secret',
      refresh_token: 'secret',
      client_secret: 'secret',
      code_verifier: 'secret',
      authorization_code: 'secret',
      code: 'secret',
      nested: {
        registration_access_token: 'secret',
        id_token: jwt,
        unlabelledJwt: jwt,
        registration_endpoint: 'https://auth/register',
      },
    })).toEqual({
      access_token: '[REDACTED]',
      refresh_token: '[REDACTED]',
      client_secret: '[REDACTED]',
      code_verifier: '[REDACTED]',
      authorization_code: '[REDACTED]',
      code: '[REDACTED]',
      nested: {
        registration_access_token: '[REDACTED]',
        id_token: '[REDACTED]',
        unlabelledJwt: '[REDACTED]',
        registration_endpoint: 'https://auth/register',
      },
    });
  });

  it('redacts a JWT embedded in an otherwise non-secret URL field', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature';

    expect(redactProbeEvidence({
      authorization_endpoint: `https://auth.example.com/authorize?request=${jwt}`,
    })).toEqual({
      authorization_endpoint: 'https://auth.example.com/authorize?request=%5BREDACTED%5D',
    });
  });

  it('redacts compact JWS and JWE values throughout nested evidence', () => {
    const jws = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
    const jwe = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4R0NNIn0..iv.ciphertext.tag';

    expect(redactProbeEvidence({
      values: [jws, { encrypted: jwe }],
    })).toEqual({
      values: ['[REDACTED]', { encrypted: '[REDACTED]' }],
    });
  });

  it('redacts credential-shaped fields without hiding endpoint metadata', () => {
    expect(redactProbeEvidence({
      apiToken: 'token-value',
      device_code: 'device-code',
      pkce_verifier: 'verifier-value',
      webhook_secret: 'secret-value',
      token_endpoint: 'https://auth.example.com/token',
      authorization_endpoint: 'https://auth.example.com/authorize',
      code_challenge_methods_supported: ['S256'],
    })).toEqual({
      apiToken: '[REDACTED]',
      device_code: '[REDACTED]',
      pkce_verifier: '[REDACTED]',
      webhook_secret: '[REDACTED]',
      token_endpoint: 'https://auth.example.com/token',
      authorization_endpoint: 'https://auth.example.com/authorize',
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('redacts URL credentials and compact tokens in path, query, and fragment components', () => {
    const jws = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
    const jwe = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4R0NNIn0..iv.ciphertext.tag';

    expect(redactProbeEvidence({
      endpoint: `https://user:password@auth.example.com/${jws}/authorize?api_token=opaque-query-secret&note=prefix-${jwe}#code=opaque-fragment-secret&request=${jws}&tab=oauth`,
    })).toEqual({
      endpoint: 'https://%5BREDACTED%5D:%5BREDACTED%5D@auth.example.com/%5BREDACTED%5D/authorize?api_token=%5BREDACTED%5D&note=prefix-%5BREDACTED%5D#code=%5BREDACTED%5D&request=%5BREDACTED%5D&tab=oauth',
    });
  });

  it('preserves ordinary endpoint metadata URLs', () => {
    const endpoint = 'https://auth.example.com/oauth/token?version=1#documentation';
    expect(redactProbeEvidence({ token_endpoint: endpoint })).toEqual({
      token_endpoint: endpoint,
    });
  });

  it('requires every CLI flag to have a non-flag value', () => {
    expect(() => parseProbeArguments([
      '--mcp-url', '--output', 'evidence.json', '--redirect-uri', 'http://127.0.0.1/callback',
    ])).toThrow('Missing --mcp-url.');
    expect(() => parseProbeArguments([
      '--mcp-url', mcpUrl, '--output', 'evidence.json', '--redirect-uri',
    ])).toThrow('Missing --redirect-uri.');
  });

  it('parses complete CLI arguments', () => {
    expect(parseProbeArguments([
      '--mcp-url', mcpUrl,
      '--output', 'evidence.json',
      '--redirect-uri', 'http://127.0.0.1/callback',
    ])).toEqual({
      mcpUrl,
      output: 'evidence.json',
      redirectUri: 'http://127.0.0.1/callback',
    });
  });
});

describe('OAuth discovery probe', () => {
  it('checks the challenge, metadata documents, and dynamic registration locally', async () => {
    const responses = successfulResponses();
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockImplementation(async () => responses.shift()!);

    const evidence = await runProbe(mcpUrl, 'http://127.0.0.1/oauth/callback');

    expect(fetchMock).toHaveBeenNthCalledWith(1, mcpUrl, expect.objectContaining({
      method: 'POST',
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, resourceMetadataUrl);
    expect(fetchMock).toHaveBeenNthCalledWith(3, authMetadataUrl);
    expect(fetchMock).toHaveBeenNthCalledWith(4, `${issuer}/register`, expect.objectContaining({
      method: 'POST',
    }));
    expect(evidence).toEqual(expect.objectContaining({
      passed: true,
      mcpUrl,
      resourceMetadataUrl,
      registration: expect.objectContaining({
        client_id: 'probe-client',
        client_secret: '[REDACTED]',
        registration_access_token: '[REDACTED]',
      }),
    }));
  });

  it('fails when authorization metadata omits dynamic registration', async () => {
    const responses = successfulResponses();
    responses[2] = jsonResponse({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
    });
    jest.spyOn(globalThis, 'fetch')
      .mockImplementation(async () => responses.shift()!);

    await expect(runProbe(mcpUrl, 'http://127.0.0.1/oauth/callback'))
      .rejects.toThrow('Authorization metadata omitted registration_endpoint.');
  });

  it.each([
    ['authorization_endpoint', ''],
    ['token_endpoint', 'ftp://auth.example.com/token'],
    ['registration_endpoint', 'not a URL'],
  ])('rejects an invalid %s', async (field, value) => {
    const responses = successfulResponses();
    const metadata = await responses[2].json() as Record<string, unknown>;
    metadata[field] = value;
    responses[2] = jsonResponse(metadata);
    jest.spyOn(globalThis, 'fetch')
      .mockImplementation(async () => responses.shift()!);

    await expect(runProbe(mcpUrl, 'http://127.0.0.1/oauth/callback'))
      .rejects.toThrow(`Authorization metadata has invalid ${field}.`);
  });

  it('rejects an empty dynamic client identifier', async () => {
    const responses = successfulResponses();
    responses[3] = jsonResponse({ client_id: '   ' }, 201);
    jest.spyOn(globalThis, 'fetch')
      .mockImplementation(async () => responses.shift()!);

    await expect(runProbe(mcpUrl, 'http://127.0.0.1/oauth/callback'))
      .rejects.toThrow('Dynamic registration omitted client_id.');
  });

  it('replaces native request and remote JSON errors with stable probe errors', async () => {
    const remoteText = 'access_token=remote-secret';
    jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error(remoteText));
    await expect(runProbe(mcpUrl, 'http://127.0.0.1/oauth/callback'))
      .rejects.toThrow('MCP challenge request failed.');

    const responses = successfulResponses();
    responses[1] = {
      ...responses[1],
      ok: true,
      json: async () => { throw new Error(remoteText); },
    } as Response;
    jest.spyOn(globalThis, 'fetch')
      .mockImplementation(async () => responses.shift()!);
    await expect(runProbe(mcpUrl, 'http://127.0.0.1/oauth/callback'))
      .rejects.toThrow('Resource metadata returned invalid JSON.');
  });
});

describe('OAuth probe CLI', () => {
  it('prints only a stable failure message and leaves no evidence file', () => {
    const tsx = join(
      process.cwd(),
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
    );
    const secret = 'access_token=must-not-appear';
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'keco-oauth-probe-'));
    const output = join(fixtureRoot, 'evidence.json');

    try {
      const result = spawnSync(tsx, [
        'scripts/probe-mcp-oauth.ts',
        '--mcp-url', `not-a-url?${secret}`,
        '--output', output,
        '--redirect-uri', 'http://127.0.0.1/callback',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr.trim()).toBe('OAuth probe failed.');
      expect(result.stderr).not.toContain(secret);
      expect(existsSync(output)).toBe(false);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
