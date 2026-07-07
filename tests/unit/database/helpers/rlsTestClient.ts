/**
 * Helpers for real-Postgres RLS behavior tests (issue #4).
 *
 * These connect to the LOCAL Supabase instance only (127.0.0.1:54321) using the
 * well-known local development anon / service_role keys — those are fixed public
 * constants shared by every local Supabase stack, NOT secrets. We deliberately
 * never read process.env.*_KEY here so a misconfigured env pointing at a remote
 * project can never cause these tests to write against production data.
 *
 * Gated by RLS_DB_TESTS=1 (set only in CI, where a local Postgres with all
 * migrations applied is running). Locally the flag is unset and the suites skip.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/**
 * Safety gate: these tests create users/projects, so they must ONLY ever run
 * against a local Supabase. We refuse to touch a non-local URL even if the flag
 * is set, so a misconfigured CI secret pointing at a remote project can never
 * cause writes against production data.
 */
function isLocalSupabase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

/**
 * True only when: the flag is set (CI), keys are present, and the URL is local.
 * When the flag is set but the URL is non-local, throw at import-affecting
 * gate time is avoided — instead suites skip (see behavior tests) and the CI
 * step is responsible for pointing env at the local instance.
 */
export const RLS_DB_TESTS_ENABLED =
  process.env.RLS_DB_TESTS === '1' &&
  isLocalSupabase(SUPABASE_URL) &&
  ANON_KEY.length > 0 &&
  SERVICE_ROLE_KEY.length > 0;

/** service_role client: bypasses RLS. Used to build/tear down fixtures only. */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** anon client with no session (RLS applies as the anonymous role). */
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Sign in as a seeded/created user and return a client carrying that JWT. */
export async function signInAs(email: string, password: string): Promise<SupabaseClient> {
  const auth = anonClient();
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`signInAs(${email}) failed: ${error?.message ?? 'no session'}`);
  }
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

export const TEST_PASSWORD = 'Password123!';

/** Unique suffix so fixtures never collide with seed data or parallel workers. */
export function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

export interface RlsUser {
  id: string;
  email: string;
  /** anon client carrying this user's JWT (RLS applies as this user). */
  client: SupabaseClient;
}

export interface ProjectFixture {
  suffix: string;
  projectId: string;
  /** A library owned by the project, for field-definition RLS tests. */
  libraryId: string;
  owner: RlsUser;
  admin: RlsUser;
  editor: RlsUser;
  viewer: RlsUser;
  /** A confirmed user who is NOT a member of the project. */
  outsider: RlsUser;
  /** service_role client for setup/teardown. */
  svc: SupabaseClient;
  /** All auth user ids created for this fixture, for teardown. */
  createdUserIds: string[];
}

async function createConfirmedUser(
  svc: SupabaseClient,
  email: string,
  createdUserIds: string[]
): Promise<RlsUser> {
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createUser(${email}) failed: ${error?.message ?? 'no user'}`);
  }
  createdUserIds.push(data.user.id);
  const client = await signInAs(email, TEST_PASSWORD);
  return { id: data.user.id, email, client };
}

/**
 * Build an isolated project with owner + admin/editor/viewer collaborators and
 * one outsider. All collaborator rows are accepted. Uses service_role to bypass
 * RLS during setup. Every project row carries `owner` as the projects.owner_id,
 * and the owner is also an accepted admin collaborator (mirrors app + seed).
 */
export async function buildProjectFixture(): Promise<ProjectFixture> {
  const svc = serviceClient();
  const suffix = uniqueSuffix();
  const createdUserIds: string[] = [];
  const mk = (label: string) =>
    createConfirmedUser(svc, `rls-${label}-${suffix}@mailinator.com`, createdUserIds);

  const owner = await mk('owner');
  const admin = await mk('admin');
  const editor = await mk('editor');
  const viewer = await mk('viewer');
  const outsider = await mk('outsider');

  const { data: project, error: pErr } = await svc
    .from('projects')
    .insert({ owner_id: owner.id, name: `rls-project-${suffix}`, description: 'rls fixture' })
    .select('id')
    .single();
  if (pErr || !project) throw new Error(`create project failed: ${pErr?.message}`);
  const projectId = project.id as string;

  const now = new Date().toISOString();
  const rows = [
    { user_id: owner.id, role: 'admin' },
    { user_id: admin.id, role: 'admin' },
    { user_id: editor.id, role: 'editor' },
    { user_id: viewer.id, role: 'viewer' },
  ].map((r) => ({
    ...r,
    project_id: projectId,
    // project_collaborators has CHECK (user_id != invited_by) — the owner's own
    // row cannot be self-invited, so leave invited_by null for it.
    invited_by: r.user_id === owner.id ? null : owner.id,
    invited_at: now,
    accepted_at: now,
  }));
  const { error: cErr } = await svc.from('project_collaborators').insert(rows);
  if (cErr) throw new Error(`create collaborators failed: ${cErr.message}`);

  const { data: library, error: lErr } = await svc
    .from('libraries')
    .insert({ project_id: projectId, name: `rls-library-${suffix}` })
    .select('id')
    .single();
  if (lErr || !library) throw new Error(`create library failed: ${lErr?.message}`);
  const libraryId = library.id as string;

  return { suffix, projectId, libraryId, owner, admin, editor, viewer, outsider, svc, createdUserIds };
}

/**
 * Create an extra confirmed user (not attached to the project) registered for
 * teardown with the given fixture. Handy as an invitation target.
 */
export async function createConfirmedOutsider(fx: ProjectFixture, label: string): Promise<RlsUser> {
  return createConfirmedUser(fx.svc, `rls-${label}-${fx.suffix}-${uniqueSuffix()}@mailinator.com`, fx.createdUserIds);
}

/** Remove a fixture's rows and auth users. Safe to call in afterAll. */
export async function teardownProjectFixture(fx: ProjectFixture): Promise<void> {
  const { svc, projectId, createdUserIds } = fx;
  // Child rows first, then project, then auth users.
  await svc.from('project_collaborators').delete().eq('project_id', projectId);
  await svc.from('projects').delete().eq('id', projectId);
  for (const id of createdUserIds.splice(0)) {
    await svc.auth.admin.deleteUser(id).catch(() => undefined);
  }
}
