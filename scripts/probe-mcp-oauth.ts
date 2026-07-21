import { writeFile } from 'node:fs/promises';

const SECRET_KEYS = new Set([
  'accesstoken',
  'authorizationcode',
  'clientsecret',
  'code',
  'codeverifier',
  'idtoken',
  'refreshtoken',
  'registrationaccesstoken',
]);

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase().replaceAll('_', '').replaceAll('-', ''));
}

function redactString(value: string): string {
  if (JWT_PATTERN.test(value)) return '[REDACTED]';

  try {
    const url = new URL(value);
    let changed = false;
    for (const [key, item] of [...url.searchParams.entries()]) {
      if (!isSecretKey(key) && !JWT_PATTERN.test(item)) continue;
      url.searchParams.set(key, '[REDACTED]');
      changed = true;
    }
    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

export function parseBearerMetadata(header: string | null): string {
  const match = /resource_metadata="([^"]+)"/i.exec(header ?? '');
  if (!match) throw new Error('MCP 401 response omitted resource_metadata.');
  return match[1];
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

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
  return process.argv[index + 1];
}

export async function runProbe(mcpUrl: string, redirectUri: string): Promise<unknown> {
  const challengeResponse = await fetch(mcpUrl, {
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
  const resourceResponse = await fetch(resourceMetadataUrl);
  if (!resourceResponse.ok) {
    throw new Error(`Resource metadata failed with ${resourceResponse.status}.`);
  }
  const resource = await resourceResponse.json() as {
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

  const authResponse = await fetch(authorizationMetadataUrl(authorizationServer));
  if (!authResponse.ok) {
    throw new Error(`Authorization metadata failed with ${authResponse.status}.`);
  }
  const auth = await authResponse.json() as Record<string, unknown>;
  if (typeof auth.authorization_endpoint !== 'string') {
    throw new Error('Authorization metadata omitted authorization_endpoint.');
  }
  if (typeof auth.token_endpoint !== 'string') {
    throw new Error('Authorization metadata omitted token_endpoint.');
  }
  if (typeof auth.registration_endpoint !== 'string') {
    throw new Error('Authorization metadata omitted registration_endpoint.');
  }

  const registrationResponse = await fetch(auth.registration_endpoint, {
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
  const registration = await registrationResponse.json() as Record<string, unknown>;
  if (typeof registration.client_id !== 'string') {
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
  const output = argument('--output');
  const evidence = await runProbe(
    argument('--mcp-url'),
    argument('--redirect-uri')
  );
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

if (process.argv[1]?.endsWith('probe-mcp-oauth.ts')) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'OAuth probe failed.');
    process.exitCode = 1;
  });
}
