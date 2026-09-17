import { expect, test } from '@playwright/test';
import { gotoAuth, loginWithCredentials } from '../utils/auth-helpers';
import {
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  type TemporaryUser,
} from '../utils/supabase-admin';

test.describe('Account email settings', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 });

  const admin = getE2EAdminClient();
  let user: TemporaryUser;

  test.beforeAll(async () => {
    user = await createTemporaryUser(admin, 'account-email');
  });

  test.afterAll(async () => {
    if (user) await deleteTemporaryUser(admin, user);
  });

  test('renders the current email and remains usable on mobile', async ({ page }) => {
    await gotoAuth(page);
    await loginWithCredentials(page, user.email, user.password);
    await expect(page).toHaveURL(/\/projects/, { timeout: 15000 });
    await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('user-menu').click();
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
    await expect(page.getByText(user.email, { exact: true })).toBeVisible();
    await expect(page.getByLabel('New email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change email' })).toBeVisible();

    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByText(user.email, { exact: true })).toBeVisible();
    const accountBounds = await page.getByRole('main').boundingBox();
    expect(accountBounds?.width).toBeGreaterThanOrEqual(280);
  });
});
