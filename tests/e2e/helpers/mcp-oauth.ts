import { createHash, randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';

type RegisterMcpClientInput = {
  supabaseUrl: string;
  redirectUri: string;
  clientName: string;
};

type AuthorizeMcpInput = {
  page: Page;
  supabaseUrl: string;
  clientId: string;
  redirectUri: string;
  resource: string;
};

type ExchangeAuthorizationCodeInput = {
  supabaseUrl: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
};

function oauthError(operation: string, status: number): Error {
  return new Error(`${operation} failed with status ${status}`);
}

export async function registerMcpClient(
  input: RegisterMcpClientInput
): Promise<{ clientId: string }> {
  const response = await fetch(`${input.supabaseUrl}/auth/v1/oauth/clients/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: input.clientName,
      redirect_uris: [input.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!response.ok) throw oauthError('OAuth client registration', response.status);

  const body = (await response.json()) as { client_id?: unknown };
  if (typeof body.client_id !== 'string' || !body.client_id) {
    throw new Error('OAuth client registration omitted client_id');
  }
  return { clientId: body.client_id };
}

export async function authorizeMcpInBrowser(
  input: AuthorizeMcpInput
): Promise<{ code: string; codeVerifier: string }> {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  const authorizeUrl = new URL(`${input.supabaseUrl}/auth/v1/oauth/authorize`);
  authorizeUrl.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    resource: input.resource,
    state,
  }).toString();

  await input.page.goto(authorizeUrl.toString());
  await input.page.waitForURL(/\/oauth\/consent\?authorization_id=/, {
    timeout: 30_000,
  });
  await input.page.getByRole('heading', { name: 'Authorize Keco MCP' }).waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  const approve = input.page.getByRole('button', { name: 'Approve' });
  await approve.waitFor({ state: 'visible', timeout: 30_000 });
  await approve.click({ timeout: 30_000 });
  await input.page.waitForURL((url) => {
    return url.origin === new URL(input.redirectUri).origin
      && url.pathname === new URL(input.redirectUri).pathname
      && url.searchParams.has('code');
  }, { timeout: 30_000 });

  const callback = new URL(input.page.url());
  if (callback.searchParams.get('state') !== state) {
    throw new Error('OAuth authorization returned an invalid state');
  }
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('OAuth authorization omitted code');
  return { code, codeVerifier };
}

export async function exchangeAuthorizationCode(
  input: ExchangeAuthorizationCodeInput
): Promise<string> {
  const response = await fetch(`${input.supabaseUrl}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      code: input.code,
      code_verifier: input.codeVerifier,
    }),
  });
  if (!response.ok) throw oauthError('OAuth code exchange', response.status);

  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error('OAuth code exchange omitted access_token');
  }
  return body.access_token;
}

export async function deleteMcpClient(
  admin: SupabaseClient,
  clientId: string
): Promise<void> {
  const { error } = await admin.auth.admin.oauth.deleteClient(clientId);
  if (error && !error.message.toLowerCase().includes('not found')) throw error;
}
