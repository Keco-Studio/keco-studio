import { replaceEvidenceAtomically } from './lib/atomic-evidence';

const SECRET_FIELD_SUFFIXES = new Set(['code', 'secret', 'token', 'verifier']);
const COMPACT_TOKEN_CANDIDATE = /[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*){2,4}/g;

function isSecretKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return SECRET_FIELD_SUFFIXES.has(words.at(-1) ?? '');
}

function isJoseHeader(value: string): boolean {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    return !!decoded && typeof decoded === 'object' && !Array.isArray(decoded);
  } catch {
    return false;
  }
}

function redactCompactTokens(value: string): string {
  return value.replace(COMPACT_TOKEN_CANDIDATE, (candidate) => {
    const parts = candidate.split('.');
    if (parts.length !== 3 && parts.length !== 5) return candidate;

    for (let offset = 0; offset < parts[0].length; offset += 1) {
      if (isJoseHeader(parts[0].slice(offset))) {
        return `${parts[0].slice(0, offset)}[REDACTED]`;
      }
    }
    return candidate;
  });
}

function redactString(value: string): string {
  const redactedValue = redactCompactTokens(value);
  if (redactedValue === '[REDACTED]') return redactedValue;

  try {
    const url = new URL(value);
    let changed = false;

    if (url.username) {
      url.username = '[REDACTED]';
      changed = true;
    }
    if (url.password) {
      url.password = '[REDACTED]';
      changed = true;
    }

    const pathname = redactCompactTokens(url.pathname);
    if (pathname !== url.pathname) {
      url.pathname = pathname.replaceAll('[REDACTED]', '%5BREDACTED%5D');
      changed = true;
    }

    for (const [key, item] of [...url.searchParams.entries()]) {
      const redactedItem = isSecretKey(key) ? '[REDACTED]' : redactCompactTokens(item);
      if (redactedItem === item) continue;
      url.searchParams.set(key, redactedItem);
      changed = true;
    }

    const fragment = url.hash.slice(1);
    if (fragment.includes('=')) {
      const fragmentParams = new URLSearchParams(fragment);
      let fragmentChanged = false;
      for (const [key, item] of [...fragmentParams.entries()]) {
        const redactedItem = isSecretKey(key) ? '[REDACTED]' : redactCompactTokens(item);
        if (redactedItem === item) continue;
        fragmentParams.set(key, redactedItem);
        fragmentChanged = true;
        changed = true;
      }
      if (fragmentChanged) url.hash = fragmentParams.toString();
    } else {
      const redactedFragment = redactCompactTokens(fragment);
      if (redactedFragment !== fragment) {
        url.hash = redactedFragment;
        changed = true;
      }
    }
    return changed ? url.toString() : value;
  } catch {
    return redactedValue;
  }
}

export function parseBearerMetadata(header: string | null): string {
  const value = header ?? '';
  const challengePattern = /(?:^|,\s*)([A-Za-z][A-Za-z0-9_-]*)\s+/g;
  const challenges = [...value.matchAll(challengePattern)];

  for (const [index, challenge] of challenges.entries()) {
    if (challenge[1].toLowerCase() !== 'bearer') continue;
    const start = (challenge.index ?? 0) + challenge[0].length;
    const end = challenges[index + 1]?.index ?? value.length;
    const match = /(?:^|,\s*)resource_metadata\s*=\s*"([^"]+)"/i
      .exec(value.slice(start, end));
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

export function redactProbeEvidence(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactProbeEvidence);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isSecretKey(key) ? '[REDACTED]' : redactProbeEvidence(item),
    ])
  );
}

export interface ProbeArguments {
  mcpUrl: string;
  output: string;
  redirectUri: string;
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
  };
}

async function request(
  input: string,
  failure: string,
  init?: RequestInit
): Promise<Response> {
  try {
    return init ? await fetch(input, init) : await fetch(input);
  } catch {
    throw new Error(`${failure} request failed.`);
  }
}

async function responseJson(
  response: Response,
  failure: string
): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    throw new Error(`${failure} returned invalid JSON.`);
  }
}

function httpEndpoint(metadata: Record<string, unknown>, field: string): string {
  const value = metadata[field];
  if (typeof value !== 'string') {
    throw new Error(`Authorization metadata omitted ${field}.`);
  }
  if (!value.trim()) {
    throw new Error(`Authorization metadata has invalid ${field}.`);
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
  } catch {
    throw new Error(`Authorization metadata has invalid ${field}.`);
  }
  return value;
}

export async function runProbe(mcpUrl: string, redirectUri: string): Promise<unknown> {
  const challengeResponse = await request(mcpUrl, 'MCP challenge', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  });
  if (challengeResponse.status !== 401) {
    throw new Error(`Expected MCP 401, received ${challengeResponse.status}.`);
  }

  const resourceMetadataUrl = parseBearerMetadata(
    challengeResponse.headers.get('www-authenticate')
  );
  const resourceResponse = await request(resourceMetadataUrl, 'Resource metadata');
  if (!resourceResponse.ok) {
    throw new Error(`Resource metadata failed with ${resourceResponse.status}.`);
  }
  const resource = await responseJson(resourceResponse, 'Resource metadata') as {
    resource?: string;
    authorization_servers?: string[];
  };
  if (resource.resource !== mcpUrl) {
    throw new Error('Resource metadata does not match the MCP URL.');
  }

  const authorizationServer = resource.authorization_servers?.[0];
  if (!authorizationServer) {
    throw new Error('Resource metadata omitted authorization_servers.');
  }

  let authMetadataUrl: string;
  try {
    authMetadataUrl = authorizationMetadataUrl(authorizationServer);
  } catch {
    throw new Error('Resource metadata has invalid authorization server.');
  }
  const authResponse = await request(authMetadataUrl, 'Authorization metadata');
  if (!authResponse.ok) {
    throw new Error(`Authorization metadata failed with ${authResponse.status}.`);
  }
  const auth = await responseJson(authResponse, 'Authorization metadata');
  httpEndpoint(auth, 'authorization_endpoint');
  httpEndpoint(auth, 'token_endpoint');
  const registrationEndpoint = httpEndpoint(auth, 'registration_endpoint');

  const registrationResponse = await request(registrationEndpoint, 'Dynamic registration', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Keco MCP Phase 1 Probe',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!registrationResponse.ok) {
    throw new Error(`Dynamic registration failed with ${registrationResponse.status}.`);
  }
  const registration = await responseJson(registrationResponse, 'Dynamic registration');
  if (typeof registration.client_id !== 'string' || !registration.client_id.trim()) {
    throw new Error('Dynamic registration omitted client_id.');
  }

  return redactProbeEvidence({
    checkedAt: new Date().toISOString(),
    passed: true,
    mcpUrl,
    resourceMetadataUrl,
    resource,
    authorizationMetadata: auth,
    registration,
  });
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const output = argument(rawArgs, '--output');
  await replaceEvidenceAtomically(
    output,
    () => {
      const args = parseProbeArguments(rawArgs);
      return runProbe(args.mcpUrl, args.redirectUri);
    }
  );
}

if (process.argv[1]?.endsWith('probe-mcp-oauth.ts')) {
  void main().catch(() => {
    console.error('OAuth probe failed.');
    process.exitCode = 1;
  });
}
