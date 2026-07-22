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
): Promise<string> {
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
  return authorizationId;
}

async function readResource(client: SupabaseClient, authorizationId: string): Promise<string | null> {
  const { data, error } = await client.rpc('get_oauth_authorization_resource', {
    p_authorization_id: authorizationId,
  });
  if (error) throw new Error(error.message);
  return typeof data === 'string' ? data : null;
}

describeDb('OAuth authorization resource RPC (live database)', () => {
  let fixture: ProjectFixture;
  let oauthClientId = '';

  beforeAll(async () => {
    fixture = await buildProjectFixture();
  }, 120_000);

  afterAll(async () => {
    if (oauthClientId) {
      await serviceClient().auth.admin.oauth.deleteClient(oauthClientId);
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
    const ownerResource = `${supabaseUrl}/functions/v1/mcp/${randomUUID()}`;
    const outsiderResource = `${supabaseUrl}/functions/v1/mcp/${randomUUID()}`;
    const ownerAuthorizationId = await createAuthorization(
      oauthClientId,
      ownerResource,
      owner.client
    );
    const outsiderAuthorizationId = await createAuthorization(
      oauthClientId,
      outsiderResource,
      outsider.client
    );

    await expect(readResource(owner.client, ownerAuthorizationId)).resolves.toBe(ownerResource);
    await expect(readResource(outsider.client, ownerAuthorizationId)).resolves.toBeNull();
    await expect(readResource(owner.client, outsiderAuthorizationId)).resolves.toBeNull();
    await expect(readResource(anonClient(), ownerAuthorizationId)).rejects.toMatchObject({
      message: expect.any(String),
    });
  }, 60_000);
});
