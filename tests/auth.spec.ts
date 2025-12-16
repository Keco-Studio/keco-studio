import { test, expect, type Page } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

// Detect whether we are running against a real Supabase instance.
// In CI we use example/dummy values, so network calls would always fail.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isRealSupabase =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  !supabaseUrl.includes('example.supabase.co') &&
  !/dummy/i.test(supabaseAnonKey);

const uniqueSuffix = () => Math.random().toString(16).slice(2);

const gotoAuthPage = async (page: Page) => {
  await page.goto(baseURL);
  await expect(page.getByRole('heading', { name: /login/i })).toBeVisible();
};

test.describe('Auth form', () => {
  test('register shows password mismatch validation', async ({ page }) => {
    await gotoAuthPage(page);

    await page.getByRole('button', { name: 'Sign Up Now' }).click();
    await expect(page.getByRole('heading', { name: /register/i })).toBeVisible();

    await page.getByLabel('Email').fill(`e2e-${uniqueSuffix()}@example.com`);
    await page.getByLabel('Username').fill(`user-${uniqueSuffix()}`);
    await page.getByLabel('Password', { exact: true }).fill('Password123!');
    await page.getByLabel('Confirm Password', { exact: true }).fill('Mismatch123!');

    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByText('Passwords do not match')).toBeVisible();
  });

  test('register succeeds with a fresh account', async ({ page }) => {
    // This flow depends on real Supabase credentials; skip when running against dummy env (CI).
    test.skip(!isRealSupabase, 'Requires real Supabase credentials');
    await gotoAuthPage(page);

    await page.getByRole('button', { name: 'Sign Up Now' }).click();

    const email = `e2e-${Date.now()}-${uniqueSuffix()}@example.com`;
    const username = `user-${uniqueSuffix()}`;
    const password = 'Password123!';

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm Password', { exact: true }).fill(password);

    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByRole('heading', { name: /Projects/i })).toBeVisible();
  });

  test('login succeeds with provided test user', async ({ page }) => {
    const loginEmail = process.env.AUTH_E2E_EMAIL;
    const loginPassword = process.env.AUTH_E2E_PASSWORD;
    // Login also depends on real Supabase + seeded test user.
    test.skip(!isRealSupabase, 'Requires real Supabase credentials');
    test.skip(!loginEmail || !loginPassword, 'Set AUTH_E2E_EMAIL and AUTH_E2E_PASSWORD to run login test');

    await gotoAuthPage(page);

    await page.getByLabel('Email').fill(loginEmail!);
    await page.getByLabel('Password').fill(loginPassword!);
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page.getByRole('heading', { name: /Projects/i })).toBeVisible();
  });
});

