import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  authorizationMetadataUrl,
  parseBearerMetadata,
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
});
