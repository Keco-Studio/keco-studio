import { test, expect } from '@playwright/test';
import {
  loginAsSeedEmpty,
  loginAsSeedProject,
  loginAsSeedLibrary,
  loginWithWrongPassword,
  gotoAuth,
} from './e2e/utils/auth-helpers';
import { authSelectors } from './e2e/utils/selectors';
import {
  assertEmptyDashboard,
  assertProjectOnlyDashboard,
  assertProjectWithLibraryDashboard,
} from './e2e/utils/dashboard-assertions';

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

test.describe('Auth form', () => {
  test('register shows password mismatch validation', async ({ page }) => {
    await gotoAuth(page);

    const { signUpToggle, headingRegister } = authSelectors(page);

    await signUpToggle.click();
    await expect(headingRegister).toBeVisible();

    const { emailInput, usernameInput, passwordInput, confirmPasswordInput, registerButton } =
      authSelectors(page);

    await emailInput.fill(`e2e-${uniqueSuffix()}@example.com`);
    await usernameInput.fill(`user-${uniqueSuffix()}`);
    await passwordInput.fill('Password123!');
    await confirmPasswordInput.fill('Mismatch123!');

    await registerButton.click();
    await expect(page.getByText('Passwords do not match')).toBeVisible();
  });

  // test('register succeeds with a fresh account', async ({ page }) => {
  //   // This flow depends on real Supabase credentials; skip when running against dummy env (CI).
  //   test.skip(!isRealSupabase, 'Requires real Supabase credentials');
  //   await gotoAuthPage(page);

  //   await page.getByRole('button', { name: 'Sign Up Now' }).click();

  //   const email = `e2e-${Date.now()}-${uniqueSuffix()}@example.com`;
  //   const username = `user-${uniqueSuffix()}`;
  //   const password = 'Password123!';

  //   await page.getByLabel('Email').fill(email);
  //   await page.getByLabel('Username').fill(username);
  //   await page.getByLabel('Password', { exact: true }).fill(password);
  //   await page.getByLabel('Confirm Password', { exact: true }).fill(password);

  //   await page.getByRole('button', { name: 'Register' }).click();
  //   await expect(page).toHaveURL(/\/projects/);
  //   await expect(page.getByRole('heading', { name: /Projects/i })).toBeVisible();
  // });

  test.describe('seeded login dashboard states', () => {
    test.skip(!isRealSupabase, 'Requires real Supabase credentials and seeded data');

    test('empty account shows empty projects dashboard', async ({ page }) => {
      await loginAsSeedEmpty(page);
      await assertEmptyDashboard(page);
    });

    test('project-only account shows one project with no libraries', async ({ page }) => {
      await loginAsSeedProject(page);
      await assertProjectOnlyDashboard(page);
    });

    test('project-with-library account shows project and library', async ({ page }) => {
      await loginAsSeedLibrary(page);
      await assertProjectWithLibraryDashboard(page);
    });
  });

  test('login with incorrect password shows error', async ({ page }) => {
    test.skip(!isRealSupabase, 'Requires real Supabase credentials and seeded data');
    await loginWithWrongPassword(page);
    await expect(page.getByText('Incorrect password, please try again.')).toBeVisible();
  });
});
