import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RLS_DB_TESTS_ENABLED,
  TEST_PASSWORD,
  anonClient,
  buildProjectFixture,
  serviceClient,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

jest.setTimeout(120_000);

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const redirectUri = 'http://127.0.0.1:3000/oauth/callback';
const accountResource = 'https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp';

interface RegisteredClient {
  client_id: string;
}

interface OAuthTokens {
  authorizationId: string;
  accessToken: string;
  refreshToken: string;
}

async function registerClient(clientName: string): Promise<RegisteredClient> {
  const response = await fetch(supabaseUrl + '/auth/v1/oauth/clients/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const body = await response.json() as Partial<RegisteredClient>;
  if (!response.ok || !body.client_id) {
    throw new Error('OAuth client registration failed');
  }
  return { client_id: body.client_id };
}

async function sessionClient(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error || !data.session) throw new Error('OAuth fixture sign-in failed');
  return client;
}

async function exchangeAuthorization(
  clientId: string,
  userClient: SupabaseClient
): Promise<OAuthTokens> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorizeUrl = new URL(supabaseUrl + '/auth/v1/oauth/authorize');
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: accountResource,
  }).toString();

  const authorizeResponse = await fetch(authorizeUrl, { redirect: 'manual' });
  const location = authorizeResponse.headers.get('location');
  if (!location) throw new Error('OAuth authorization did not redirect');
  const authorizationId = new URL(location, supabaseUrl).searchParams.get('authorization_id');
  if (!authorizationId) throw new Error('OAuth authorization ID is missing');

  const details = await userClient.auth.oauth.getAuthorizationDetails(authorizationId);
  const autoApprovedRedirect = typeof details.data?.redirect_url === 'string'
    ? details.data.redirect_url
    : null;
  if (
    details.error ||
    (!autoApprovedRedirect && details.data?.authorization_id !== authorizationId)
  ) {
    throw new Error('OAuth authorization association failed');
  }
  let redirectUrl = autoApprovedRedirect;
  if (!redirectUrl) {
    const approval = await userClient.auth.oauth.approveAuthorization(authorizationId, {
      skipBrowserRedirect: true,
    });
    if (approval.error || !approval.data?.redirect_url) {
      throw new Error('OAuth authorization approval failed');
    }
    redirectUrl = approval.data.redirect_url;
  }

  const code = new URL(redirectUrl).searchParams.get('code');
  if (!code) throw new Error('OAuth authorization code is missing');
  const tokenResponse = await fetch(supabaseUrl + '/auth/v1/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  const tokenBody = await tokenResponse.json() as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!tokenResponse.ok || !tokenBody.access_token || !tokenBody.refresh_token) {
    throw new Error('OAuth code exchange failed');
  }
  return {
    authorizationId,
    accessToken: tokenBody.access_token,
    refreshToken: tokenBody.refresh_token,
  };
}

async function refreshToken(clientId: string, token: string): Promise<Response> {
  return fetch(supabaseUrl + '/auth/v1/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: token,
    }),
  });
}

describeDb('MCP account connection management database behavior', () => {
  let fixture: ProjectFixture;
  let oauthClient: RegisteredClient;

  beforeAll(async () => {
    fixture = await buildProjectFixture();
    oauthClient = await registerClient('Codex database connection test ' + randomUUID());
  });

  afterAll(async () => {
    if (oauthClient) {
      await serviceClient().auth.admin.oauth.deleteClient(oauthClient.client_id);
    }
    if (fixture) await teardownProjectFixture(fixture);
  });

  it('lists only one user and revokes one exact session without affecting siblings or consent', async () => {
    const ownerClient = await sessionClient(fixture.owner.email);
    const outsiderClient = await sessionClient(fixture.outsider.email);
    const ownerFirst = await exchangeAuthorization(oauthClient.client_id, ownerClient);
    const ownerSecond = await exchangeAuthorization(oauthClient.client_id, ownerClient);
    const outsiderConnection = await exchangeAuthorization(oauthClient.client_id, outsiderClient);

    const ownerList = await serviceClient().rpc('list_oauth_mcp_account_connections', {
      p_user_id: fixture.owner.id,
    });
    expect(ownerList.error).toBeNull();
    expect(ownerList.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ authorization_id: ownerFirst.authorizationId }),
      expect.objectContaining({ authorization_id: ownerSecond.authorizationId }),
    ]));
    expect(ownerList.data).toHaveLength(2);
    expect(JSON.stringify(ownerList.data)).not.toContain(outsiderConnection.authorizationId);

    const outsiderCannotRevoke = await serviceClient().rpc(
      'revoke_oauth_mcp_account_connection',
      { p_user_id: fixture.outsider.id, p_authorization_id: ownerFirst.authorizationId }
    );
    expect(outsiderCannotRevoke).toEqual(expect.objectContaining({ data: false, error: null }));

    const revocation = await serviceClient().rpc('revoke_oauth_mcp_account_connection', {
      p_user_id: fixture.owner.id,
      p_authorization_id: ownerFirst.authorizationId,
    });
    expect(revocation).toEqual(expect.objectContaining({ data: true, error: null }));

    const afterList = await serviceClient().rpc('list_oauth_mcp_account_connections', {
      p_user_id: fixture.owner.id,
    });
    expect(afterList.error).toBeNull();
    expect(afterList.data).toEqual([
      expect.objectContaining({ authorization_id: ownerSecond.authorizationId }),
    ]);

    const revokedAccess = await anonClient().auth.getUser(ownerFirst.accessToken);
    expect(revokedAccess.data.user).toBeNull();
    expect(revokedAccess.error).not.toBeNull();
    expect((await refreshToken(oauthClient.client_id, ownerFirst.refreshToken)).ok).toBe(false);

    const siblingAccess = await anonClient().auth.getUser(ownerSecond.accessToken);
    expect(siblingAccess.error).toBeNull();
    expect(siblingAccess.data.user?.id).toBe(fixture.owner.id);
    expect((await refreshToken(oauthClient.client_id, ownerSecond.refreshToken)).ok).toBe(true);

    const outsiderAccess = await anonClient().auth.getUser(outsiderConnection.accessToken);
    expect(outsiderAccess.error).toBeNull();
    expect(outsiderAccess.data.user?.id).toBe(fixture.outsider.id);

    // A sibling refresh proves the client consent remained active after the exact
    // session deletion. Revoking consent would invalidate every client session.
  });

  it('keeps both RPCs unavailable to authenticated browser roles', async () => {
    const list = await fixture.owner.client.rpc('list_oauth_mcp_account_connections', {
      p_user_id: fixture.owner.id,
    });
    const revoke = await fixture.owner.client.rpc('revoke_oauth_mcp_account_connection', {
      p_user_id: fixture.owner.id,
      p_authorization_id: 'not-visible',
    });
    expect(list.error).not.toBeNull();
    expect(revoke.error).not.toBeNull();
  });
});
