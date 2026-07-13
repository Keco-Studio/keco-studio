import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateRecoverySessionUrl } from '../utils/auth-helpers';
import {
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  type TemporaryUser,
} from '../utils/supabase-admin';

test.describe('Password reset', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 });

  let admin: SupabaseClient;
  let user: TemporaryUser;

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    user = await createTemporaryUser(admin, 'password-reset');
  });

  test.afterAll(async () => {
    if (user) await deleteTemporaryUser(admin, user);
  });

  test('validates reset-request email and confirms a valid request', async ({ page }) => {
    await page.goto('/forgot-password');
    const email = page.getByLabel('Email or username');
    const submit = page.getByRole('button', { name: 'Send reset link' });

    await submit.click();
    await expect(page.getByText('Email is required')).toBeVisible();

    await email.fill('not-an-email');
    await submit.click();
    await expect(page.getByText('Please enter a valid email address')).toBeVisible();

    await email.fill(user.email);
    await submit.click();
    await expect(page.getByText(/Password reset email sent!/)).toBeVisible({ timeout: 30000 });
  });

  test('rejects a reset page without a recovery session', async ({ page }) => {
    await page.goto('/auth/reset-password');
    await expect(page.getByText(/Invalid or expired reset link/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Request New Reset Link' })).toBeVisible();
  });

  test('rejects mismatched confirmation then resets with a recovery session', async ({ page }) => {
    const resetUrl = await generateRecoverySessionUrl(admin, user.email);
    await page.goto(resetUrl);

    const password = page.getByLabel('New password');
    const confirmation = page.getByLabel('Confirm password');
    const submit = page.getByRole('button', { name: 'Confirm' });
    await expect(password).toBeVisible({ timeout: 15000 });

    await password.fill('NewPassword123!');
    await confirmation.fill('DifferentPassword123!');
    await submit.click();
    await expect(page.getByText('Passwords do not match')).toBeVisible();

    await confirmation.fill('NewPassword123!');
    await submit.click();
    await expect(page.getByText(/Password reset successfully!/)).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveURL(/\/(projects)?(?:\?|$)/, { timeout: 10000 });
  });
});
