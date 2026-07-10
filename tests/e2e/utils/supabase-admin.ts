import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const E2E_PASSWORD = 'Password123!';

export type TemporaryUser = {
  id: string;
  email: string;
  password: string;
};

export function getE2EAdminClient(): SupabaseClient {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('E2E Supabase service-role environment is not configured');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getUserIdByEmail(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .single();

  if (error || !data) throw error ?? new Error(`Profile not found for ${email}`);
  return data.id as string;
}

export async function createTemporaryUser(
  admin: SupabaseClient,
  prefix: string
): Promise<TemporaryUser> {
  const email = `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@mailinator.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: E2E_PASSWORD,
    email_confirm: true,
    user_metadata: { username: prefix },
  });

  if (error || !data.user) throw error ?? new Error('Failed to create E2E user');
  return { id: data.user.id, email, password: E2E_PASSWORD };
}

export async function deleteTemporaryUser(admin: SupabaseClient, user: Pick<User, 'id'>): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error && !error.message.toLowerCase().includes('not found')) throw error;
}

export async function createProjectFixture(
  admin: SupabaseClient,
  ownerId: string,
  options: { addOwnerMembership?: boolean } = {}
): Promise<string> {
  const { data, error } = await admin
    .from('projects')
    .insert({
      owner_id: ownerId,
      name: `E2E Collaboration ${Date.now()} ${crypto.randomUUID().slice(0, 6)}`,
      description: 'Isolated Playwright collaboration fixture',
    })
    .select('id')
    .single();

  if (error || !data) throw error ?? new Error('Failed to create E2E project');
  const projectId = data.id as string;

  if (options.addOwnerMembership) {
    await addProjectCollaborator(admin, projectId, ownerId, 'admin', null);
  }

  return projectId;
}

export async function addProjectCollaborator(
  admin: SupabaseClient,
  projectId: string,
  userId: string,
  role: 'admin' | 'editor' | 'viewer',
  invitedBy: string | null
): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('project_collaborators')
    .upsert(
      {
        project_id: projectId,
        user_id: userId,
        role,
        invited_by: invitedBy,
        invited_at: now,
        accepted_at: now,
        updated_at: now,
      },
      { onConflict: 'user_id,project_id' }
    )
    .select('id')
    .single();

  if (error || !data) throw error ?? new Error('Failed to add E2E collaborator');
  return data.id as string;
}

export async function removeProjectFixture(admin: SupabaseClient, projectId: string): Promise<void> {
  const { error } = await admin.from('projects').delete().eq('id', projectId);
  if (error) throw error;
}

export async function getBrowserAccessToken(page: Page): Promise<string> {
  const authCookies = (await page.context().cookies())
    .filter((cookie) => cookie.name.includes('sb-') && cookie.name.includes('auth-token'))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (authCookies.length === 0) throw new Error('Supabase auth cookie was not found');

  let encoded = authCookies.map((cookie) => cookie.value).join('');
  if (encoded.startsWith('base64-')) {
    encoded = Buffer.from(encoded.slice('base64-'.length), 'base64url').toString('utf8');
  }

  const session = JSON.parse(encoded) as { access_token?: string };
  if (!session.access_token) throw new Error('Supabase auth cookie did not contain an access token');
  return session.access_token;
}
