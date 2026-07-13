import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authSelectors } from './selectors';

const SEED_EMPTY_EMAIL = 'seed-empty@example.com';
const SEED_PROJECT_EMAIL = 'seed-project@example.com';
const SEED_LIBRARY_EMAIL = 'seed-library@example.com';
const SEED_PASSWORD = 'Password123!';

export async function gotoAuth(page: Page) {
  await page.goto('/');
  const { headingLogin } = authSelectors(page);
  await expect(headingLogin).toBeVisible();
}

export async function loginWithCredentials(page: Page, email: string, password: string) {
  const { emailInput, passwordInput, loginButton } = authSelectors(page);

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await loginButton.click();
}

export async function loginAsSeedEmpty(page: Page) {
  await gotoAuth(page);
  await loginWithCredentials(page, SEED_EMPTY_EMAIL, SEED_PASSWORD);
}

export async function loginAsSeedProject(page: Page) {
  await gotoAuth(page);
  await loginWithCredentials(page, SEED_PROJECT_EMAIL, SEED_PASSWORD);
}

export async function loginAsSeedLibrary(page: Page) {
  await gotoAuth(page);
  await loginWithCredentials(page, SEED_LIBRARY_EMAIL, SEED_PASSWORD);
}

export async function loginWithWrongPassword(page: Page) {
  await gotoAuth(page);
  await loginWithCredentials(page, SEED_EMPTY_EMAIL, 'WrongPassword!');
}

export async function generateRecoverySessionUrl(
  admin: SupabaseClient,
  email: string
): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error('Supabase E2E environment is not configured');

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: 'http://localhost:3000/auth/reset-password' },
  });
  if (linkError || !linkData.properties.hashed_token) {
    throw linkError ?? new Error('Recovery link did not include a hashed token');
  }

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    type: 'recovery',
    token_hash: linkData.properties.hashed_token,
  });
  if (verifyError || !verified.session) {
    throw verifyError ?? new Error('Recovery token did not produce a session');
  }

  const session = verified.session;
  const hash = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in ?? 3600),
    token_type: session.token_type,
    type: 'recovery',
  });
  return `http://localhost:3000/auth/reset-password#${hash.toString()}`;
}

