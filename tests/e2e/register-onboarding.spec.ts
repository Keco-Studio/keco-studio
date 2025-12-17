import { test, expect } from '@playwright/test';
import { authSelectors, projectsSelectors } from './utils/selectors';
import { uniqueEmail } from './utils/data-factories';
import { gotoAuth } from './utils/auth-helpers';

// Detect whether we are running against a real Supabase instance.
// In CI we use example/dummy values, so network calls would always fail.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isRealSupabase =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  !supabaseUrl.includes('example.supabase.co') &&
  !/dummy/i.test(supabaseAnonKey);

test.describe('Registration and onboarding', () => {
  test.skip(!isRealSupabase, 'Requires real Supabase credentials');

  test('new user lands on empty projects dashboard', async ({ page }) => {
    await gotoAuth(page);

    const { signUpToggle, headingRegister, emailInput, usernameInput, passwordInput, confirmPasswordInput, registerButton } =
      authSelectors(page);

    await signUpToggle.click();
    await expect(headingRegister).toBeVisible();

    const email = uniqueEmail('reg');
    const username = `user-${Date.now().toString(16)}`;
    const password = 'Password123!';

    await emailInput.fill(email);
    await usernameInput.fill(username);
    await passwordInput.fill(password);
    await confirmPasswordInput.fill(password);

    await registerButton.click();

    // After successful registration the user should see the Projects dashboard
    const { projectsHeading, emptyProjectsMessage } = projectsSelectors(page);
    await expect(projectsHeading).toBeVisible();
    // For a fresh user there should be no projects yet
    await expect(emptyProjectsMessage).toBeVisible();
  });

  test('invalid registration inputs show validation errors', async ({ page }) => {
    await gotoAuth(page);
    const { signUpToggle, headingRegister, emailInput, usernameInput, passwordInput, confirmPasswordInput, registerButton } =
      authSelectors(page);

    await signUpToggle.click();
    await expect(headingRegister).toBeVisible();

    // Case: password mismatch
    await emailInput.fill(uniqueEmail('reg-mismatch'));
    await usernameInput.fill(`user-${Date.now().toString(16)}`);
    await passwordInput.fill('Password123!');
    await confirmPasswordInput.fill('Mismatch123!');
    await registerButton.click();
    await expect(page.getByText('Passwords do not match')).toBeVisible();
  });
});


