import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PRODUCTION_APP_URL = 'https://keco-studio-main.vercel.app';
const PRODUCTION_SUPABASE_URL = 'https://lulrcirmwwvvnupmwqcq.supabase.co';
const MCP_URL = PRODUCTION_SUPABASE_URL + '/functions/v1/mcp';
const REDIRECT_URI = 'http://127.0.0.1:8765/';
const PASSWORD = 'Keco-MCP-Acceptance-2026!';
const CODEX_ADD = 'codex mcp add keco-account --url "' + MCP_URL
  + '" --oauth-resource "' + MCP_URL + '"';
const CODEX_LOGIN = 'codex mcp login keco-account';
const CLAUDE_ADD = 'claude mcp add --transport http keco-account "' + MCP_URL + '"';

interface RegisteredClient {
  client_id: string;
}

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface ConnectionView {
  id: string;
  client: 'codex' | 'claude' | 'unknown';
  clientName: 'Codex' | 'Claude Code' | 'MCP Client';
  connectedAt: string;
}

interface ConnectionResponse {
  response: Response;
  connections: ConnectionView[];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('Required production acceptance environment is missing');
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function anonClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function registerClient(url: string, clientName: string): Promise<RegisteredClient> {
  const response = await fetch(url + '/auth/v1/oauth/clients/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const body = await response.json() as Partial<RegisteredClient>;
  assert(response.ok && typeof body.client_id === 'string', 'OAuth client registration failed');
  return { client_id: body.client_id };
}

async function signIn(
  url: string,
  anonKey: string,
  email: string
): Promise<{ client: SupabaseClient; accessToken: string }> {
  const client = anonClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  assert(!error && data.session, 'Production acceptance sign-in failed');
  return { client, accessToken: data.session.access_token };
}

async function exchangeAuthorization(
  url: string,
  clientId: string,
  userClient: SupabaseClient
): Promise<OAuthTokens> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorizeUrl = new URL(url + '/auth/v1/oauth/authorize');
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP_URL,
  }).toString();

  const authorizeResponse = await fetch(authorizeUrl, { redirect: 'manual' });
  const location = authorizeResponse.headers.get('location');
  assert(location, 'OAuth authorization did not redirect');
  const authorizationId = new URL(location, url).searchParams.get('authorization_id');
  assert(authorizationId, 'OAuth authorization did not start');

  const details = await userClient.auth.oauth.getAuthorizationDetails(authorizationId);
  assert(!details.error && details.data, 'OAuth authorization association failed');
  let redirectUrl = typeof details.data.redirect_url === 'string'
    ? details.data.redirect_url
    : null;
  if (!redirectUrl) {
    assert(details.data.authorization_id === authorizationId, 'OAuth authorization changed unexpectedly');
    const approval = await userClient.auth.oauth.approveAuthorization(authorizationId, {
      skipBrowserRedirect: true,
    });
    assert(!approval.error && approval.data?.redirect_url, 'OAuth authorization approval failed');
    redirectUrl = approval.data.redirect_url;
  }

  const code = new URL(redirectUrl).searchParams.get('code');
  assert(code, 'OAuth authorization code is missing');
  const tokenResponse = await fetch(url + '/auth/v1/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: verifier,
    }),
  });
  const tokenBody = await tokenResponse.json() as {
    access_token?: string;
    refresh_token?: string;
  };
  assert(
    tokenResponse.ok && tokenBody.access_token && tokenBody.refresh_token,
    'OAuth code exchange failed'
  );
  return { accessToken: tokenBody.access_token, refreshToken: tokenBody.refresh_token };
}

async function listConnections(accessToken: string): Promise<ConnectionResponse> {
  const response = await fetch(PRODUCTION_APP_URL + '/api/mcp/connections', {
    headers: { authorization: 'Bearer ' + accessToken },
  });
  const body = await response.json() as { connections?: ConnectionView[] };
  assert(response.ok && Array.isArray(body.connections), 'Connection list request failed');
  assert(
    response.headers.get('cache-control')?.includes('private')
      && response.headers.get('cache-control')?.includes('no-store'),
    'Connection list cache policy is unsafe'
  );
  for (const connection of body.connections) {
    assert(
      Object.keys(connection).sort().join(',') === 'client,clientName,connectedAt,id',
      'Connection API exposed an unexpected field'
    );
  }
  return { response, connections: body.connections };
}

async function deleteConnection(accessToken: string, connectionId: string): Promise<Response> {
  return fetch(
    PRODUCTION_APP_URL + '/api/mcp/connections/' + encodeURIComponent(connectionId),
    {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer ' + accessToken,
        origin: PRODUCTION_APP_URL,
        'sec-fetch-site': 'same-origin',
      },
    }
  );
}

async function refreshToken(
  url: string,
  clientId: string,
  token: string
): Promise<Response> {
  return fetch(url + '/auth/v1/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: token,
    }),
  });
}

async function callMcp(accessToken: string): Promise<Response> {
  return fetch(MCP_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer ' + accessToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'keco-production-acceptance', version: '1.0.0' },
      },
    }),
  });
}

async function loginBrowser(page: Page, email: string) {
  await page.goto(PRODUCTION_APP_URL);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.getByTestId('user-menu').waitFor({ state: 'visible', timeout: 60_000 });
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    commands: Array.from(document.querySelectorAll('code')).map(
      (node) => node.scrollWidth - node.clientWidth
    ),
  }));
  assert(overflow.document <= 0, 'MCP page has horizontal document overflow');
  assert(overflow.commands.every((value) => value <= 0), 'MCP command has horizontal overflow');
}

async function runBrowserAcceptance(
  browser: Browser,
  ownerEmail: string,
  targetConnectionId: string
) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: PRODUCTION_APP_URL,
  });
  const page = await context.newPage();
  try {
    await loginBrowser(page, ownerEmail);
    await page.goto(PRODUCTION_APP_URL + '/mcp');
    await page.getByRole('heading', { name: 'MCP', exact: true }).waitFor();
    assert(await page.getByTestId('mcp-connection-row').count() === 3, 'Production UI lost connections');
    assert(
      await page.getByRole('button', { name: 'Disconnect Codex' }).count() === 2,
      'Duplicate Codex connections are not separately visible'
    );
    assert(
      await page.getByRole('button', { name: 'Disconnect Claude Code' }).count() === 1,
      'Claude Code connection classification is missing'
    );

    const firstCode = page.locator('code').first();
    const metrics = await firstCode.evaluate((node) => {
      const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
      return { height: node.getBoundingClientRect().height, lineHeight };
    });
    assert(metrics.height > metrics.lineHeight * 1.5, 'Long Codex command did not wrap visually');
    await assertNoHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Copy Add Keco MCP command' }).click();
    assert(
      await page.evaluate(() => navigator.clipboard.readText()) === CODEX_ADD,
      'Codex command clipboard content changed'
    );
    await page.getByRole('button', { name: 'Copy Sign in to Keco command' }).click();
    assert(
      await page.evaluate(() => navigator.clipboard.readText()) === CODEX_LOGIN,
      'Codex login clipboard content changed'
    );
    await page.getByRole('tab', { name: 'Claude Code' }).click();
    await page.getByRole('button', { name: 'Copy Add Keco MCP command' }).click();
    assert(
      await page.evaluate(() => navigator.clipboard.readText()) === CLAUDE_ADD,
      'Claude Code clipboard content changed'
    );

    await page.screenshot({ path: 'artifacts/mcp-account-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    assert(
      !(await page.getByText('CONNECTED', { exact: true }).isVisible()),
      'Connected time column remained visible on mobile'
    );
    await page.screenshot({ path: 'artifacts/mcp-account-mobile.png', fullPage: true });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('tab', { name: 'Codex' }).click();
    const deleteResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'DELETE'
      && response.url().includes('/api/mcp/connections/')
    );
    await page.getByRole('button', { name: 'Disconnect Codex' }).first().click();
    const modal = page.locator('.ant-modal');
    await modal.getByText('Disconnect Codex?').waitFor();
    await modal.getByText('This client will no longer be able to access Keco.').waitFor();
    await modal.getByRole('button', { name: 'Disconnect', exact: true }).click();
    const deleteResponse = await deleteResponsePromise;
    assert(deleteResponse.ok(), 'Production UI disconnect request failed');
    assert(
      deleteResponse.headers()['cache-control']?.includes('private')
        && deleteResponse.headers()['cache-control']?.includes('no-store'),
      'Disconnect cache policy is unsafe'
    );
    await page.getByText('Codex disconnected', { exact: true }).waitFor();
    await page.getByTestId('mcp-connection-row').nth(1).waitFor();
    assert(await page.getByTestId('mcp-connection-row').count() === 2, 'UI did not remove one row');

    const deletedPath = new URL(deleteResponse.url()).pathname;
    assert(
      deletedPath.endsWith('/' + encodeURIComponent(targetConnectionId)),
      'UI disconnected a different connection than the selected row'
    );
  } finally {
    await context.close();
  }
}

async function main() {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  assert(supabaseUrl === PRODUCTION_SUPABASE_URL, 'Acceptance refused a non-production Supabase URL');

  const runTag = randomUUID();
  const ownerEmail = 'mcp-accept-owner-' + runTag + '@example.com';
  const outsiderEmail = 'mcp-accept-outsider-' + runTag + '@example.com';
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userIds: string[] = [];
  const clientIds: string[] = [];
  let browser: Browser | null = null;

  await mkdir('artifacts', { recursive: true });
  try {
    for (const email of [ownerEmail, outsiderEmail]) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      assert(!error && data.user, 'Production acceptance user creation failed');
      userIds.push(data.user.id);
    }

    const codexClient = await registerClient(supabaseUrl, 'Codex production acceptance ' + runTag);
    const claudeClient = await registerClient(supabaseUrl, 'Claude production acceptance ' + runTag);
    clientIds.push(codexClient.client_id, claudeClient.client_id);

    const owner = await signIn(supabaseUrl, anonKey, ownerEmail);
    const outsider = await signIn(supabaseUrl, anonKey, outsiderEmail);
    assert((await listConnections(owner.accessToken)).connections.length === 0, 'Owner was not isolated');
    assert((await listConnections(outsider.accessToken)).connections.length === 0, 'Outsider was not isolated');

    const firstCodex = await exchangeAuthorization(supabaseUrl, codexClient.client_id, owner.client);
    const afterFirst = await listConnections(owner.accessToken);
    assert(afterFirst.connections.length === 1, 'First Codex connection was not listed');
    assert(afterFirst.connections[0].clientName === 'Codex', 'Codex connection was misclassified');

    const claude = await exchangeAuthorization(supabaseUrl, claudeClient.client_id, owner.client);
    const afterClaude = await listConnections(owner.accessToken);
    assert(afterClaude.connections.length === 2, 'Claude Code connection was not listed');
    assert(
      afterClaude.connections.some((connection) => connection.clientName === 'Claude Code'),
      'Claude Code connection was misclassified'
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    const secondCodex = await exchangeAuthorization(supabaseUrl, codexClient.client_id, owner.client);
    const ownerBefore = await listConnections(owner.accessToken);
    assert(ownerBefore.connections.length === 3, 'Duplicate Codex connections were collapsed');
    assert(
      ownerBefore.connections.filter((connection) => connection.clientName === 'Codex').length === 2,
      'Duplicate Codex connections were not separately classified'
    );
    const targetConnectionId = ownerBefore.connections[0].id;
    assert(ownerBefore.connections[0].clientName === 'Codex', 'Newest connection order is incorrect');

    await exchangeAuthorization(supabaseUrl, codexClient.client_id, outsider.client);
    const outsiderBefore = await listConnections(outsider.accessToken);
    assert(outsiderBefore.connections.length === 1, 'Outsider connection was not listed');
    assert(
      !outsiderBefore.connections.some((connection) =>
        ownerBefore.connections.some((ownerConnection) => ownerConnection.id === connection.id)
      ),
      'Opaque connection IDs were not user-bound'
    );

    const outsiderDelete = await deleteConnection(outsider.accessToken, targetConnectionId);
    assert(outsiderDelete.status === 404, 'Another user could disconnect the owner connection');
    assert(
      outsiderDelete.headers.get('cache-control')?.includes('no-store'),
      'Foreign disconnect response was cacheable'
    );
    assert(
      (await listConnections(owner.accessToken)).connections.length === 3,
      'Foreign disconnect changed owner connections'
    );

    browser = await chromium.launch();
    await runBrowserAcceptance(browser, ownerEmail, targetConnectionId);

    const ownerAfter = await listConnections(owner.accessToken);
    assert(ownerAfter.connections.length === 2, 'Exact disconnect removed the wrong number of rows');
    assert(
      ownerAfter.connections.some((connection) => connection.id === afterFirst.connections[0].id),
      'Sibling Codex connection was removed'
    );
    assert(
      ownerAfter.connections.some((connection) => connection.clientName === 'Claude Code'),
      'Claude Code sibling connection was removed'
    );
    assert(
      !(await anonClient(supabaseUrl, anonKey).auth.getUser(secondCodex.accessToken)).data.user,
      'Disconnected access token remained valid'
    );
    assert(
      !(await refreshToken(supabaseUrl, codexClient.client_id, secondCodex.refreshToken)).ok,
      'Disconnected refresh token remained valid'
    );
    const siblingUser = await anonClient(supabaseUrl, anonKey).auth.getUser(firstCodex.accessToken);
    assert(!siblingUser.error && siblingUser.data.user?.id === userIds[0], 'Sibling access token was revoked');
    assert(
      (await refreshToken(supabaseUrl, codexClient.client_id, firstCodex.refreshToken)).ok,
      'Sibling refresh token was revoked'
    );
    assert((await callMcp(firstCodex.accessToken)).ok, 'Sibling MCP connection stopped working');
    assert((await callMcp(secondCodex.accessToken)).status === 401, 'Revoked MCP token still worked');
    assert((await listConnections(outsider.accessToken)).connections.length === 1, 'Outsider changed unexpectedly');

    const evidence = {
      productionApp: true,
      productionSupabase: true,
      authenticatedPage: true,
      currentUserIsolation: true,
      duplicateCodexConnections: true,
      claudeClassification: true,
      opaqueUserBoundIds: true,
      foreignDisconnectDenied: true,
      exactDisconnect: true,
      siblingConnectionsRetained: true,
      disconnectedAccessTokenInvalidated: true,
      disconnectedRefreshTokenInvalidated: true,
      siblingAccessAndRefreshValid: true,
      siblingMcpOperational: true,
      revokedMcpDenied: true,
      cacheControlNoStore: true,
      responseShapeSanitized: true,
      commandCopySingleLine: true,
      longCommandWrapped: true,
      desktopNoOverflow: true,
      mobileNoOverflow: true,
      mobileTimeHidden: true,
      screenshotsCaptured: 2,
    };
    await writeFile('artifacts/mcp-account-connections-production.json', JSON.stringify(evidence, null, 2));
  } finally {
    await browser?.close();
    for (const clientId of clientIds) {
      await admin.auth.admin.oauth.deleteClient(clientId).catch(() => undefined);
    }
    for (const userId of userIds) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  }
}

void main().catch(() => {
  console.error('MCP account connections production acceptance failed');
  process.exitCode = 1;
});
