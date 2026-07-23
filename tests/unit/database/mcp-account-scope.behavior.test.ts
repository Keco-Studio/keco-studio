import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  RLS_DB_TESTS_ENABLED,
  TEST_PASSWORD,
  anonClient,
  buildProjectFixture,
  createConfirmedOutsider,
  serviceClient,
  teardownProjectFixture,
  type ProjectFixture,
  type RlsUser,
} from './helpers/rlsTestClient';

jest.setTimeout(120_000);

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const redirectUri = 'http://127.0.0.1:3000/oauth/callback';
const postgresUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

interface RegisteredClient {
  client_id: string;
}

interface AuthorizationFixture {
  authorizationId: string;
  verifier: string;
  redirectUrl: string | null;
}

function assertUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Expected UUID, received ${value}`);
  }
  return value;
}

function queryJson(sql: string): Record<string, unknown> | null {
  const result = spawnSync('psql', [
    postgresUrl,
    '-v',
    'ON_ERROR_STOP=1',
    '-At',
    '-c',
    sql,
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr.trim()}`);
  }
  const output = result.stdout.trim();
  return output ? JSON.parse(output) as Record<string, unknown> : null;
}

async function registerPublicClient(): Promise<RegisteredClient> {
  const response = await fetch(`${supabaseUrl}/auth/v1/oauth/clients/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: `MCP account scope test ${randomUUID()}`,
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
): Promise<AuthorizationFixture> {
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
  if (!location) throw new Error(`OAuth authorization failed with status ${response.status}`);
  const authorizationId = new URL(location, supabaseUrl).searchParams.get('authorization_id');
  if (!authorizationId) throw new Error('OAuth authorization omitted authorization_id');

  const { data, error } = await userClient.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || data?.authorization_id !== authorizationId) {
    throw new Error(`OAuth authorization association failed: ${error?.message ?? 'invalid details'}`);
  }
  return {
    authorizationId,
    verifier,
    redirectUrl: typeof data.redirect_url === 'string' ? data.redirect_url : null,
  };
}

async function exchangeAuthorization(
  clientId: string,
  resource: string,
  userClient: SupabaseClient
): Promise<{ authorizationId: string; accessToken: string }> {
  const authorization = await createAuthorization(clientId, resource, userClient);
  let redirectUrl = authorization.redirectUrl;
  if (!redirectUrl) {
    const approval = await userClient.auth.oauth.approveAuthorization(
      authorization.authorizationId,
      { skipBrowserRedirect: true }
    );
    if (approval.error || !approval.data?.redirect_url) {
      throw new Error(`OAuth approval failed: ${approval.error?.message ?? 'no redirect'}`);
    }
    redirectUrl = approval.data.redirect_url;
  }

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
      code_verifier: authorization.verifier,
    }),
  });
  const body = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(`OAuth code exchange failed: ${body.error ?? response.status}`);
  }
  return { authorizationId: authorization.authorizationId, accessToken: body.access_token };
}

function bearerClient(token: string): SupabaseClient {
  return createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function tokenPayload(token: string): { session_id?: string; sub?: string; client_id?: string } {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
    session_id?: string;
    sub?: string;
    client_id?: string;
  };
}

async function hasServiceGrant(
  client: SupabaseClient,
  clientId: string,
  resource: string
): Promise<boolean> {
  const { data, error } = await client.rpc('has_oauth_mcp_service_grant', {
    p_client_id: clientId,
    p_resource: resource,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

async function hasProjectGrant(
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

describeDb('MCP account scope database behavior', () => {
  let fixture: ProjectFixture;
  let zeroProjectUser: RlsUser;
  const accessibleProjectIds: string[] = [];
  const excludedProjectIds: string[] = [];
  const writableDiscoveryProjectIds: string[] = [];

  beforeAll(async () => {
    fixture = await buildProjectFixture();
    zeroProjectUser = await createConfirmedOutsider(fixture, 'account-zero-project');

    const projectRows = [
      {
        owner_id: fixture.admin.id,
        name: `duplicate-account-project-${fixture.suffix}`,
        description: 'accepted admin project',
        created_at: '2030-01-04T00:00:00.000Z',
        role: 'admin',
      },
      {
        owner_id: fixture.editor.id,
        name: `editor-account-project-${fixture.suffix}`,
        description: 'accepted editor project',
        created_at: '2030-01-03T00:00:00.000Z',
        role: 'editor',
      },
      {
        owner_id: fixture.viewer.id,
        name: `duplicate-account-project-${fixture.suffix}`,
        description: 'accepted viewer project',
        created_at: '2030-01-03T00:00:00.000Z',
        role: 'viewer',
      },
    ];

    for (const row of projectRows) {
      const { role, ...projectInput } = row;
      const project = await fixture.svc.from('projects').insert(projectInput).select('id').single();
      if (project.error || !project.data) {
        throw new Error(`create account project failed: ${project.error?.message}`);
      }
      const projectId = project.data.id as string;
      accessibleProjectIds.push(projectId);
      const collaborator = await fixture.svc.from('project_collaborators').insert({
        user_id: fixture.owner.id,
        project_id: projectId,
        role,
        invited_by: row.owner_id,
        invited_at: '2030-01-01T00:00:00.000Z',
        accepted_at: '2030-01-01T00:00:00.000Z',
      });
      if (collaborator.error) {
        throw new Error(`create account collaborator failed: ${collaborator.error.message}`);
      }
    }

    for (const accepted of [false, null] as const) {
      const project = await fixture.svc.from('projects').insert({
        owner_id: fixture.outsider.id,
        name: `${accepted === false ? 'pending' : 'inaccessible'}-account-${fixture.suffix}`,
        description: accepted === false ? 'pending collaborator project' : 'inaccessible project',
        created_at: '2030-01-05T00:00:00.000Z',
      }).select('id').single();
      if (project.error || !project.data) {
        throw new Error(`create excluded account project failed: ${project.error?.message}`);
      }
      const projectId = project.data.id as string;
      excludedProjectIds.push(projectId);
      if (accepted === false) {
        const pending = await fixture.svc.from('project_collaborators').insert({
          user_id: fixture.owner.id,
          project_id: projectId,
          role: 'viewer',
          invited_by: fixture.outsider.id,
          invited_at: '2030-01-01T00:00:00.000Z',
          accepted_at: null,
        });
        if (pending.error) throw new Error(`create pending collaborator failed: ${pending.error.message}`);
      }
    }

    const lookaheadRows = Array.from({ length: 97 }, (_, index) => ({
      owner_id: fixture.owner.id,
      name: `owned-account-lookahead-${String(index + 1).padStart(3, '0')}-${fixture.suffix}`,
      description: 'owned lookahead project',
      created_at: new Date(Date.UTC(2029, 0, 1, 0, 0, 0) - index * 60_000).toISOString(),
    }));
    const lookaheadProjects = await fixture.svc.from('projects')
      .insert(lookaheadRows)
      .select('id');
    if (lookaheadProjects.error || !lookaheadProjects.data) {
      throw new Error(`create account lookahead projects failed: ${lookaheadProjects.error?.message}`);
    }
    accessibleProjectIds.push(...lookaheadProjects.data.map((project) => project.id as string));
  });

  afterAll(async () => {
    if (fixture) {
      for (const projectId of [
        ...accessibleProjectIds,
        ...excludedProjectIds,
        ...writableDiscoveryProjectIds,
      ]) {
        await fixture.svc.from('projects').delete().eq('id', projectId);
      }
      await teardownProjectFixture(fixture);
    }
  });

  it('authorizes a zero-project account with an exact root session grant and no project grant', async () => {
    const registered = await registerPublicClient();
    const userClient = await sessionClient(zeroProjectUser.email);
    const resource = `${supabaseUrl}/functions/v1/mcp`;

    try {
      const token = await exchangeAuthorization(registered.client_id, resource, userClient);
      const payload = tokenPayload(token.accessToken);
      const sessionId = assertUuid(payload.session_id ?? '');
      expect(payload.sub).toBe(zeroProjectUser.id);
      expect(payload.client_id).toBe(registered.client_id);

      const grant = queryJson(`
        SELECT jsonb_build_object(
          'authorization_id', authorization_id,
          'user_id', user_id,
          'client_id', client_id,
          'resource', resource,
          'session_id', session_id
        )::TEXT
        FROM public.oauth_mcp_service_grants
        WHERE session_id = '${sessionId}'::UUID
      `);
      expect(grant).toMatchObject({
        authorization_id: token.authorizationId,
        user_id: zeroProjectUser.id,
        client_id: registered.client_id,
        resource,
        session_id: sessionId,
      });

      const oauthClient = bearerClient(token.accessToken);
      await expect(hasServiceGrant(oauthClient, registered.client_id, resource)).resolves.toBe(true);
      await expect(
        hasProjectGrant(oauthClient, registered.client_id, fixture.projectId, resource)
      ).resolves.toBe(false);
      expect(queryJson(`
        SELECT jsonb_build_object('count', count(*))::TEXT
        FROM public.oauth_project_grants
        WHERE session_id = '${sessionId}'::UUID
      `)).toEqual({ count: 0 });

      const directRead = await oauthClient.from('oauth_mcp_service_grants').select('*');
      expect(directRead.error).not.toBeNull();

      const admission = await oauthClient.rpc('mcp_begin_account_operation', {
        p_operation: 'list_projects',
        p_operation_class: 'read',
        p_request_id: randomUUID(),
        p_client_id: registered.client_id,
        p_request_bytes: 0,
      });
      expect(admission.error).toBeNull();
      expect(admission.data).toEqual([
        expect.objectContaining({ remaining: 119, reset_at: expect.any(String) }),
      ]);
      const operationId = admission.data?.[0]?.operation_id as string;
      const completion = await oauthClient.rpc('mcp_complete_operation', {
        p_operation_id: operationId,
        p_outcome: 'succeeded',
        p_error_code: null,
        p_response_bytes: 2,
        p_total_ms: 1,
        p_database_ms: 1,
        p_embedding_ms: null,
        p_serialization_ms: 0,
        p_metadata: { returnedCount: 0 },
      });
      expect(completion.error).toBeNull();

      const revocation = await userClient.auth.oauth.revokeGrant({
        clientId: registered.client_id,
      });
      expect(revocation.error).toBeNull();
      const denied = await oauthClient.rpc('has_oauth_mcp_service_grant', {
        p_client_id: registered.client_id,
        p_resource: resource,
      });
      expect(denied.data).not.toBe(true);
    } finally {
      await serviceClient().auth.admin.oauth.deleteClient(registered.client_id);
    }
  });

  it('keeps project and root exchange triggers disjoint', async () => {
    const registered = await registerPublicClient();
    const ownerClient = await sessionClient(fixture.owner.email);
    const projectResource = `${supabaseUrl}/functions/v1/mcp/${fixture.projectId}`;
    const rootResource = `${supabaseUrl}/functions/v1/mcp`;

    try {
      const token = await exchangeAuthorization(registered.client_id, projectResource, ownerClient);
      const sessionId = assertUuid(tokenPayload(token.accessToken).session_id ?? '');
      const oauthClient = bearerClient(token.accessToken);

      await expect(
        hasProjectGrant(oauthClient, registered.client_id, fixture.projectId, projectResource)
      ).resolves.toBe(true);
      await expect(
        hasServiceGrant(oauthClient, registered.client_id, rootResource)
      ).resolves.toBe(false);
      expect(queryJson(`
        SELECT jsonb_build_object('count', count(*))::TEXT
        FROM public.oauth_mcp_service_grants
        WHERE session_id = '${sessionId}'::UUID
      `)).toEqual({ count: 0 });
    } finally {
      await serviceClient().auth.admin.oauth.deleteClient(registered.client_id);
    }
  });

  it('keeps legacy and account telemetry cleanup responsibilities separate', async () => {
    const oldWindow = '2000-01-01T00:00:00.000Z';
    expect(queryJson(`
      WITH project_bucket AS (
        INSERT INTO public.mcp_rate_limit_buckets (
          actor_id,
          project_id,
          operation_class,
          window_started_at,
          request_count
        ) VALUES (
          '${fixture.owner.id}'::UUID,
          '${fixture.projectId}'::UUID,
          'static',
          '${oldWindow}'::TIMESTAMPTZ,
          1
        )
        ON CONFLICT (actor_id, project_id, operation_class, window_started_at)
        DO UPDATE SET request_count = EXCLUDED.request_count
        RETURNING 1
      ), account_bucket AS (
        INSERT INTO public.mcp_account_rate_limit_buckets (
          actor_id,
          operation_class,
          window_started_at,
          request_count
        ) VALUES (
          '${zeroProjectUser.id}'::UUID,
          'static',
          '${oldWindow}'::TIMESTAMPTZ,
          1
        )
        ON CONFLICT (actor_id, operation_class, window_started_at)
        DO UPDATE SET request_count = EXCLUDED.request_count
        RETURNING 1
      )
      SELECT jsonb_build_object(
        'project', (SELECT count(*) FROM project_bucket),
        'account', (SELECT count(*) FROM account_bucket)
      )::TEXT
    `)).toEqual({ project: 1, account: 1 });

    const legacyCleanup = await serviceClient().rpc('mcp_cleanup_telemetry');
    expect(legacyCleanup.error).toBeNull();
    expect(queryJson(`
      SELECT jsonb_build_object(
        'project', (
          SELECT count(*) FROM public.mcp_rate_limit_buckets
          WHERE actor_id = '${fixture.owner.id}'::UUID
            AND project_id = '${fixture.projectId}'::UUID
            AND operation_class = 'static'
            AND window_started_at = '${oldWindow}'::TIMESTAMPTZ
        ),
        'account', (
          SELECT count(*) FROM public.mcp_account_rate_limit_buckets
          WHERE actor_id = '${zeroProjectUser.id}'::UUID
            AND operation_class = 'static'
            AND window_started_at = '${oldWindow}'::TIMESTAMPTZ
        )
      )::TEXT
    `)).toEqual({ project: 0, account: 1 });

    const denied = await zeroProjectUser.client.rpc('mcp_cleanup_account_telemetry');
    expect(denied.error).not.toBeNull();

    const accountCleanup = await serviceClient().rpc('mcp_cleanup_account_telemetry');
    expect(accountCleanup.error).toBeNull();
    expect(queryJson(`
      SELECT jsonb_build_object('count', count(*))::TEXT
      FROM public.mcp_account_rate_limit_buckets
      WHERE actor_id = '${zeroProjectUser.id}'::UUID
        AND operation_class = 'static'
        AND window_started_at = '${oldWindow}'::TIMESTAMPTZ
    `)).toEqual({ count: 0 });
  });

  it('resolves live roles and lists only accepted access with deterministic pagination', async () => {
    const roleCases: Array<[SupabaseClient, string | null]> = [
      [fixture.owner.client, 'admin'],
      [fixture.admin.client, 'admin'],
      [fixture.editor.client, 'editor'],
      [fixture.viewer.client, 'viewer'],
      [fixture.outsider.client, null],
    ];
    for (const [client, expectedRole] of roleCases) {
      const result = await client.rpc('mcp_resolve_project_role', {
        p_project_id: fixture.projectId,
      });
      expect(result.error).toBeNull();
      expect(result.data).toBe(expectedRole);
    }

    const fullPage = await fixture.owner.client.rpc('mcp_list_accessible_projects', {
      p_limit: 101,
      p_before_created_at: null,
      p_after_project_id: null,
    });
    expect(fullPage.error).toBeNull();
    const rows = fullPage.data ?? [];
    expect(rows).toHaveLength(101);
    const expectedAccessible = new Set([fixture.projectId, ...accessibleProjectIds]);
    expect(new Set(rows.map((row) => row.project_id))).toEqual(expectedAccessible);
    expect(rows.filter((row) => row.name === `duplicate-account-project-${fixture.suffix}`))
      .toHaveLength(2);
    expect(rows.some((row) => row.description === 'pending collaborator project')).toBe(false);
    expect(rows.some((row) => row.description === 'inaccessible project')).toBe(false);

    const roles = Object.fromEntries(rows.map((row) => [row.description, row.role]));
    expect(roles).toMatchObject({
      'accepted admin project': 'admin',
      'accepted editor project': 'editor',
      'accepted viewer project': 'viewer',
    });

    const publicBoundary = await fixture.owner.client.rpc('mcp_list_accessible_projects', {
      p_limit: 100,
      p_before_created_at: null,
      p_after_project_id: null,
    });
    expect(publicBoundary.error).toBeNull();
    expect(publicBoundary.data).toHaveLength(100);
    expect(publicBoundary.data).toEqual(rows.slice(0, 100));

    const internalClamp = await fixture.owner.client.rpc('mcp_list_accessible_projects', {
      p_limit: 102,
      p_before_created_at: null,
      p_after_project_id: null,
    });
    expect(internalClamp.error).toBeNull();
    expect(internalClamp.data).toEqual(rows);

    const firstPage = await fixture.owner.client.rpc('mcp_list_accessible_projects', {
      p_limit: 2,
      p_before_created_at: null,
      p_after_project_id: null,
    });
    expect(firstPage.error).toBeNull();
    expect(firstPage.data).toHaveLength(2);
    const cursor = firstPage.data?.[1];
    const nextPage = await fixture.owner.client.rpc('mcp_list_accessible_projects', {
      p_limit: 100,
      p_before_created_at: null,
      p_after_project_id: cursor?.project_id,
    });
    expect(nextPage.error).toBeNull();
    expect([...(firstPage.data ?? []), ...(nextPage.data ?? [])]).toEqual(rows);

    const clamped = await fixture.owner.client.rpc('mcp_list_accessible_projects', {
      p_limit: 0,
      p_before_created_at: null,
      p_after_project_id: null,
    });
    expect(clamped.error).toBeNull();
    expect(clamped.data).toHaveLength(1);

    const viewerProjectId = accessibleProjectIds[2];
    const changed = await fixture.svc.from('project_collaborators').update({ role: 'editor' })
      .eq('project_id', viewerProjectId)
      .eq('user_id', fixture.owner.id);
    expect(changed.error).toBeNull();
    const changedRole = await fixture.owner.client.rpc('mcp_resolve_project_role', {
      p_project_id: viewerProjectId,
    });
    expect(changedRole.error).toBeNull();
    expect(changedRole.data).toBe('editor');

    const removed = await fixture.svc.from('project_collaborators').delete()
      .eq('project_id', viewerProjectId)
      .eq('user_id', fixture.owner.id);
    expect(removed.error).toBeNull();
    const removedRole = await fixture.owner.client.rpc('mcp_resolve_project_role', {
      p_project_id: viewerProjectId,
    });
    expect(removedRole.error).toBeNull();
    expect(removedRole.data).toBeNull();
  });

  it('discovers only current owner or accepted admin/editor access', async () => {
    const owner = await fixture.owner.client.rpc('mcp_has_writable_project');
    const editor = await fixture.editor.client.rpc('mcp_has_writable_project');
    const zeroProject = await zeroProjectUser.client.rpc('mcp_has_writable_project');
    expect(owner.error).toBeNull();
    expect(editor.error).toBeNull();
    expect(zeroProject.error).toBeNull();
    expect(owner.data).toBe(true);
    expect(editor.data).toBe(true);
    expect(zeroProject.data).toBe(false);

    const created = await fixture.svc.from('projects').insert({
      owner_id: fixture.outsider.id,
      name: `writable-discovery-${fixture.suffix}`,
      description: 'writable discovery role mutation project',
    }).select('id').single();
    if (created.error || !created.data) {
      throw new Error(`create writable discovery project failed: ${created.error?.message}`);
    }
    const projectId = created.data.id as string;
    writableDiscoveryProjectIds.push(projectId);

    const pending = await fixture.svc.from('project_collaborators').insert({
      user_id: zeroProjectUser.id,
      project_id: projectId,
      role: 'editor',
      invited_by: fixture.outsider.id,
      accepted_at: null,
    });
    expect(pending.error).toBeNull();
    const pendingResult = await zeroProjectUser.client.rpc('mcp_has_writable_project');
    expect(pendingResult.error).toBeNull();
    expect(pendingResult.data).toBe(false);

    const acceptedViewer = await fixture.svc.from('project_collaborators').update({
      role: 'viewer',
      accepted_at: new Date().toISOString(),
    }).eq('project_id', projectId).eq('user_id', zeroProjectUser.id);
    expect(acceptedViewer.error).toBeNull();
    const viewerResult = await zeroProjectUser.client.rpc('mcp_has_writable_project');
    expect(viewerResult.error).toBeNull();
    expect(viewerResult.data).toBe(false);

    const editorMutation = await fixture.svc.from('project_collaborators').update({ role: 'editor' })
      .eq('project_id', projectId).eq('user_id', zeroProjectUser.id);
    expect(editorMutation.error).toBeNull();
    const editorResult = await zeroProjectUser.client.rpc('mcp_has_writable_project');
    expect(editorResult.error).toBeNull();
    expect(editorResult.data).toBe(true);

    const removal = await fixture.svc.from('project_collaborators').delete()
      .eq('project_id', projectId).eq('user_id', zeroProjectUser.id);
    expect(removal.error).toBeNull();
    const removedResult = await zeroProjectUser.client.rpc('mcp_has_writable_project');
    expect(removedResult.error).toBeNull();
    expect(removedResult.data).toBe(false);
  });
});
