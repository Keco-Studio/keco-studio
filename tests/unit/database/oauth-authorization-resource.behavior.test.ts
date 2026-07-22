import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  RLS_DB_TESTS_ENABLED,
  TEST_PASSWORD,
  anonClient,
  buildProjectFixture,
  serviceClient,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const redirectUri = 'http://127.0.0.1:3000/oauth/callback';

interface RegisteredClient {
  client_id: string;
}

async function registerPublicClient(): Promise<RegisteredClient> {
  const response = await fetch(`${supabaseUrl}/auth/v1/oauth/clients/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: `OAuth resource RPC test ${randomUUID()}`,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!response.ok) {
    throw new Error(`OAuth client registration failed with status ${response.status}`);
  }

  const client = await response.json() as Partial<RegisteredClient>;
  if (!client.client_id) throw new Error('OAuth client registration omitted client_id');
  return { client_id: client.client_id };
}

async function sessionClient(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`OAuth fixture sign-in failed: ${error?.message ?? 'no session'}`);
  }
  return client;
}

async function createAuthorization(
  clientId: string,
  resource: string,
  userClient: SupabaseClient
): Promise<{ authorizationId: string; verifier: string }> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorizeUrl = new URL(`${supabaseUrl}/auth/v1/oauth/authorize`);
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource,
  }).toString();

  const response = await fetch(authorizeUrl, { redirect: 'manual' });
  const location = response.headers.get('location');
  if (!location) {
    throw new Error(`OAuth authorization failed with status ${response.status}`);
  }
  const authorizationId = new URL(location, supabaseUrl).searchParams.get('authorization_id');
  if (!authorizationId) throw new Error('OAuth authorization omitted authorization_id');

  const { data, error } = await userClient.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || data?.authorization_id !== authorizationId) {
    throw new Error(`OAuth authorization association failed: ${error?.message ?? 'invalid details'}`);
  }
  return { authorizationId, verifier };
}

async function exchangeAuthorizationCode(
  clientId: string,
  verifier: string,
  redirectUrl: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const code = new URL(redirectUrl).searchParams.get('code');
  if (!code) throw new Error('OAuth approval redirect omitted code');
  const response = await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
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
  const body = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };
  if (!response.ok || !body.access_token || !body.refresh_token) {
    throw new Error(`OAuth code exchange failed: ${body.error ?? response.status}`);
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

async function refreshOAuthToken(
  clientId: string,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });
  const body = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };
  if (!response.ok || !body.access_token || !body.refresh_token) {
    throw new Error(`OAuth token refresh failed: ${body.error ?? response.status}`);
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

function bearerClient(token: string): SupabaseClient {
  return createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function readResource(client: SupabaseClient, authorizationId: string): Promise<string | null> {
  const { data, error } = await client.rpc('get_oauth_authorization_resource', {
    p_authorization_id: authorizationId,
  });
  if (error) throw new Error(error.message);
  return typeof data === 'string' ? data : null;
}

async function prepareGrant(
  client: SupabaseClient,
  authorizationId: string,
  projectId: string,
  resource: string
): Promise<boolean> {
  const { data, error } = await client.rpc('prepare_oauth_project_grant', {
    p_authorization_id: authorizationId,
    p_project_id: projectId,
    p_resource: resource,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

async function hasGrant(
  client: SupabaseClient,
  clientId: string,
  projectId: string,
  resource: string
): Promise<boolean> {
  const { data, error } = await client.rpc('has_oauth_project_grant', {
    p_client_id: clientId,
    p_project_id: projectId,
    p_resource: resource,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

async function finalizeGrant(
  client: SupabaseClient,
  authorizationId: string,
  projectId: string,
  resource: string
): Promise<boolean> {
  const { data, error } = await client.rpc('finalize_oauth_project_grant', {
    p_authorization_id: authorizationId,
    p_project_id: projectId,
    p_resource: resource,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

describeDb('OAuth authorization resource RPC (live database)', () => {
  let fixture: ProjectFixture;
  let oauthClientId = '';
  let secondProjectId = '';

  beforeAll(async () => {
    fixture = await buildProjectFixture();
    const secondProject = await fixture.svc.from('projects').insert({
      owner_id: fixture.owner.id,
      name: `oauth-second-project-${fixture.suffix}`,
      description: 'OAuth cross-resource replay fixture',
    }).select('id').single();
    if (secondProject.error || !secondProject.data) {
      throw new Error(`create second OAuth project failed: ${secondProject.error?.message}`);
    }
    secondProjectId = secondProject.data.id as string;
  }, 120_000);

  afterAll(async () => {
    if (oauthClientId) {
      await serviceClient().auth.admin.oauth.deleteClient(oauthClientId);
    }
    if (secondProjectId) {
      await fixture.svc.from('projects').delete().eq('id', secondProjectId);
    }
    if (fixture) await teardownProjectFixture(fixture);
  }, 60_000);

  it('returns a pending resource only to its authenticated owner', async () => {
    const registeredClient = await registerPublicClient();
    oauthClientId = registeredClient.client_id;
    const owner = {
      ...fixture.owner,
      client: await sessionClient(fixture.owner.email),
    };
    const outsider = {
      ...fixture.outsider,
      client: await sessionClient(fixture.outsider.email),
    };
    const ownerResource = `${supabaseUrl}/functions/v1/mcp/${fixture.projectId}`;
    const secondResource = `${supabaseUrl}/functions/v1/mcp/${secondProjectId}`;
    const outsiderResource = `${supabaseUrl}/functions/v1/mcp/${randomUUID()}`;
    const ownerAuthorization = await createAuthorization(
      oauthClientId,
      ownerResource,
      owner.client
    );
    const outsiderAuthorization = await createAuthorization(
      oauthClientId,
      outsiderResource,
      outsider.client
    );
    const ownerAuthorizationId = ownerAuthorization.authorizationId;
    const outsiderAuthorizationId = outsiderAuthorization.authorizationId;

    await expect(readResource(owner.client, ownerAuthorizationId)).resolves.toBe(ownerResource);
    await expect(readResource(outsider.client, ownerAuthorizationId)).resolves.toBeNull();
    await expect(readResource(owner.client, outsiderAuthorizationId)).resolves.toBeNull();
    await expect(readResource(anonClient(), ownerAuthorizationId)).rejects.toMatchObject({
      message: expect.any(String),
    });

    await expect(
      prepareGrant(owner.client, ownerAuthorizationId, fixture.projectId, ownerResource)
    ).resolves.toBe(true);
    const secondAuthorization = await createAuthorization(
      oauthClientId,
      secondResource,
      owner.client
    );
    await expect(
      prepareGrant(
        owner.client,
        secondAuthorization.authorizationId,
        secondProjectId,
        secondResource
      )
    ).resolves.toBe(true);
    await expect(
      hasGrant(owner.client, oauthClientId, fixture.projectId, ownerResource)
    ).resolves.toBe(false);
    await expect(
      prepareGrant(outsider.client, ownerAuthorizationId, fixture.projectId, ownerResource)
    ).resolves.toBe(false);

    const directRead = await owner.client.from('oauth_project_grants').select('*');
    expect(directRead.error).not.toBeNull();
    const directWrite = await owner.client.from('oauth_project_grants').insert({
      authorization_id: 'forged-authorization',
      user_id: owner.id,
      client_id: oauthClientId,
      project_id: fixture.projectId,
      resource: ownerResource,
    });
    expect(directWrite.error).not.toBeNull();

    const approval = await owner.client.auth.oauth.approveAuthorization(ownerAuthorizationId, {
      skipBrowserRedirect: true,
    });
    expect(approval.error).toBeNull();
    expect(approval.data?.redirect_url).toEqual(expect.any(String));
    await expect(
      finalizeGrant(owner.client, ownerAuthorizationId, fixture.projectId, ownerResource)
    ).resolves.toBe(true);
    const secondApproval = await owner.client.auth.oauth.approveAuthorization(
      secondAuthorization.authorizationId,
      { skipBrowserRedirect: true }
    );
    expect(secondApproval.error).toBeNull();
    await expect(
      finalizeGrant(
        owner.client,
        secondAuthorization.authorizationId,
        secondProjectId,
        secondResource
      )
    ).resolves.toBe(true);

    const firstToken = await exchangeAuthorizationCode(
      oauthClientId,
      ownerAuthorization.verifier,
      approval.data?.redirect_url ?? ''
    );
    const secondToken = await exchangeAuthorizationCode(
      oauthClientId,
      secondAuthorization.verifier,
      secondApproval.data?.redirect_url ?? ''
    );
    const tokenPayload = JSON.parse(Buffer.from(
      firstToken.accessToken.split('.')[1] ?? '',
      'base64url'
    ).toString('utf8')) as {
      client_id?: string;
      sub?: string;
      role?: string;
      session_id?: string;
    };
    const secondTokenPayload = JSON.parse(Buffer.from(
      secondToken.accessToken.split('.')[1] ?? '',
      'base64url'
    ).toString('utf8')) as { session_id?: string };
    expect(tokenPayload.client_id).toBe(oauthClientId);
    expect(tokenPayload.sub).toBe(owner.id);
    expect(tokenPayload.role).toBe('authenticated');
    expect(tokenPayload.session_id).toEqual(expect.any(String));
    expect(secondTokenPayload.session_id).toEqual(expect.any(String));
    expect(secondTokenPayload.session_id).not.toBe(tokenPayload.session_id);
    await expect(
      hasGrant(owner.client, oauthClientId, fixture.projectId, ownerResource)
    ).resolves.toBe(false);
    const oauthClient = bearerClient(firstToken.accessToken);
    const secondOAuthClient = bearerClient(secondToken.accessToken);

    await expect(
      hasGrant(oauthClient, oauthClientId, fixture.projectId, ownerResource)
    ).resolves.toBe(true);
    await expect(
      hasGrant(oauthClient, oauthClientId, secondProjectId, secondResource)
    ).resolves.toBe(false);
    await expect(
      hasGrant(secondOAuthClient, oauthClientId, secondProjectId, secondResource)
    ).resolves.toBe(true);
    await expect(
      hasGrant(secondOAuthClient, oauthClientId, fixture.projectId, ownerResource)
    ).resolves.toBe(false);
    await expect(
      hasGrant(oauthClient, oauthClientId, fixture.projectId, `${ownerResource}?replay=1`)
    ).resolves.toBe(false);
    await expect(
      hasGrant(oauthClient, oauthClientId, randomUUID(), ownerResource)
    ).resolves.toBe(false);
    await expect(
      hasGrant(oauthClient, randomUUID(), fixture.projectId, ownerResource)
    ).resolves.toBe(false);
    await expect(
      hasGrant(outsider.client, oauthClientId, fixture.projectId, ownerResource)
    ).resolves.toBe(false);

    const refreshedFirstToken = await refreshOAuthToken(
      oauthClientId,
      firstToken.refreshToken
    );
    const refreshedPayload = JSON.parse(Buffer.from(
      refreshedFirstToken.accessToken.split('.')[1] ?? '',
      'base64url'
    ).toString('utf8')) as { session_id?: string };
    expect(refreshedPayload.session_id).toBe(tokenPayload.session_id);
    const refreshedClient = bearerClient(refreshedFirstToken.accessToken);
    await expect(
      hasGrant(refreshedClient, oauthClientId, fixture.projectId, ownerResource)
    ).resolves.toBe(true);
    await expect(
      hasGrant(refreshedClient, oauthClientId, secondProjectId, secondResource)
    ).resolves.toBe(false);
  }, 60_000);
});
