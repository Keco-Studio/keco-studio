import { createHash, randomBytes } from 'node:crypto';
import { replaceEvidenceAtomically } from './lib/atomic-evidence';

type McpMode = 'account' | 'legacy';

export interface ProbeArguments {
  mcpUrl: string;
  output: string;
  redirectUri: string;
  exerciseCodeExchange: boolean;
}

function argument(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}.`);
  return value;
}

export function parseProbeArguments(args: readonly string[]): ProbeArguments {
  return {
    mcpUrl: argument(args, '--mcp-url'),
    output: argument(args, '--output'),
    redirectUri: argument(args, '--redirect-uri'),
    exerciseCodeExchange: args.includes('--exercise-code-exchange'),
  };
}

export function parseBearerMetadata(header: string | null): string {
  const value = header ?? '';
  const challengePattern = /(?:^|,\s*)([A-Za-z][A-Za-z0-9_-]*)\s+/g;
  const challenges = [...value.matchAll(challengePattern)];
  for (const [index, challenge] of challenges.entries()) {
    if (challenge[1].toLowerCase() !== 'bearer') continue;
    const start = (challenge.index ?? 0) + challenge[0].length;
    const end = challenges[index + 1]?.index ?? value.length;
    const match = /(?:^|,\s*)resource_metadata\s*=\s*"([^"]+)"/i.exec(value.slice(start, end));
    if (match) return match[1];
  }
  throw new Error('MCP 401 response omitted resource_metadata.');
}

export function authorizationMetadataUrl(issuer: string): string {
  const url = new URL(issuer);
  const issuerPath = url.pathname.replace(/^\/+|\/+$/g, '');
  url.pathname = `/.well-known/oauth-authorization-server${issuerPath ? `/${issuerPath}` : ''}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function mcpMode(mcpUrl: string): McpMode {
  const url = new URL(mcpUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error('MCP URL is invalid.');
  if (/^\/(?:functions\/v1\/)?mcp$/.test(url.pathname)) return 'account';
  if (/^\/(?:functions\/v1\/)?mcp\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url.pathname)) return 'legacy';
  throw new Error('MCP URL is not an account or legacy endpoint.');
}

async function request(input: string, failure: string, init?: RequestInit, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    return init ? await fetchImpl(input, init) : await fetchImpl(input);
  } catch {
    throw new Error(`${failure} request failed.`);
  }
}

async function responseJson(response: Response, failure: string): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error(`${failure} returned invalid JSON.`);
  }
}

function httpEndpoint(metadata: Record<string, unknown>, field: string): string {
  const value = metadata[field];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Authorization metadata omitted ${field}.`);
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
  } catch {
    throw new Error(`Authorization metadata has invalid ${field}.`);
  }
  return value;
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function runProbe(mcpUrl: string, redirectUri: string, options: {
  exerciseCodeExchange?: boolean;
  fetchImpl?: typeof fetch;
} = {}): Promise<unknown> {
  const mode = mcpMode(mcpUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const challengeResponse = await request(mcpUrl, 'MCP challenge', {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  }, fetchImpl);
  if (challengeResponse.status !== 401) throw new Error(`Expected MCP 401, received ${challengeResponse.status}.`);

  const resourceMetadataUrl = parseBearerMetadata(challengeResponse.headers.get('www-authenticate'));
  const resourceResponse = await request(resourceMetadataUrl, 'Resource metadata', undefined, fetchImpl);
  if (!resourceResponse.ok) throw new Error(`Resource metadata failed with ${resourceResponse.status}.`);
  const resource = await responseJson(resourceResponse, 'Resource metadata') as {
    resource?: string; authorization_servers?: string[];
  };
  if (resource.resource !== mcpUrl) throw new Error('Resource metadata does not match the MCP URL.');
  const authorizationServer = resource.authorization_servers?.[0];
  if (!authorizationServer) throw new Error('Resource metadata omitted authorization_servers.');

  let authMetadataUrl: string;
  try { authMetadataUrl = authorizationMetadataUrl(authorizationServer); } catch {
    throw new Error('Resource metadata has invalid authorization server.');
  }
  const authResponse = await request(authMetadataUrl, 'Authorization metadata', undefined, fetchImpl);
  if (!authResponse.ok) throw new Error(`Authorization metadata failed with ${authResponse.status}.`);
  const auth = await responseJson(authResponse, 'Authorization metadata');
  const authorizationEndpoint = httpEndpoint(auth, 'authorization_endpoint');
  const tokenEndpoint = httpEndpoint(auth, 'token_endpoint');
  const registrationEndpoint = httpEndpoint(auth, 'registration_endpoint');

  const registrationResponse = await request(registrationEndpoint, 'Dynamic registration', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Keco MCP account probe', redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  }, fetchImpl);
  if (!registrationResponse.ok) throw new Error(`Dynamic registration failed with ${registrationResponse.status}.`);
  const registration = await responseJson(registrationResponse, 'Dynamic registration');
  if (typeof registration.client_id !== 'string' || !registration.client_id.trim()) {
    throw new Error('Dynamic registration omitted client_id.');
  }

  const transientVerifier = randomBytes(32).toString('base64url');
  const authorizationRequest = new URL(authorizationEndpoint);
  authorizationRequest.searchParams.set('client_id', registration.client_id);
  authorizationRequest.searchParams.set('redirect_uri', redirectUri);
  authorizationRequest.searchParams.set('response_type', 'code');
  authorizationRequest.searchParams.set('resource', mcpUrl);
  authorizationRequest.searchParams.set('code_challenge', pkceChallenge(transientVerifier));
  authorizationRequest.searchParams.set('code_challenge_method', 'S256');
  const authorizationResponse = await request(authorizationRequest.toString(), 'Authorization', {
    redirect: 'manual',
  }, fetchImpl);
  if (authorizationResponse.status >= 400) {
    throw new Error(`Authorization failed with HTTP ${authorizationResponse.status}.`);
  }

  let codeExchange: 'not_exercised' | 'succeeded' = 'not_exercised';
  if (options.exerciseCodeExchange) {
    const location = authorizationResponse.headers.get('location');
    let authorizationCode: string | null = null;
    try { authorizationCode = location ? new URL(location, redirectUri).searchParams.get('code') : null; } catch { authorizationCode = null; }
    if (!authorizationCode) throw new Error('Authorization endpoint did not return an authorization code.');
    const exchangeResponse = await request(tokenEndpoint, 'Authorization-code exchange', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: registration.client_id,
        code: authorizationCode, redirect_uri: redirectUri, code_verifier: transientVerifier }),
    }, fetchImpl);
    if (!exchangeResponse.ok) throw new Error(`Authorization-code exchange failed with ${exchangeResponse.status}.`);
    const exchange = await responseJson(exchangeResponse, 'Authorization-code exchange');
    if (typeof exchange.access_token !== 'string' || !exchange.access_token) {
      throw new Error('Authorization-code exchange omitted access_token.');
    }
    codeExchange = 'succeeded';
  }

  return {
    checkedAt: new Date().toISOString(), passed: true, mode,
    discovery: { protectedResource: 'succeeded', authorizationServerCount: resource.authorization_servers.length },
    oauth: { dynamicRegistration: 'succeeded', authorization: 'succeeded', codeExchange },
  };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const output = argument(rawArgs, '--output');
  await replaceEvidenceAtomically(output, () => {
    const args = parseProbeArguments(rawArgs);
    return runProbe(args.mcpUrl, args.redirectUri, {
      exerciseCodeExchange: args.exerciseCodeExchange,
    });
  });
}

if (process.argv[1]?.endsWith('probe-mcp-oauth.ts')) {
  void main().catch(() => { console.error('OAuth probe failed.'); process.exitCode = 1; });
}
