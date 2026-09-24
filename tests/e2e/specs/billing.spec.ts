import { expect, test, type Page } from '@playwright/test';
import { gotoAuth, loginWithCredentials } from '../utils/auth-helpers';
import {
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  type TemporaryUser,
} from '../utils/supabase-admin';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function appOrigin(): string {
  return `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '3000'}`;
}

test.describe('Billing and payment pages', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  const admin = getE2EAdminClient();
  let user: TemporaryUser;

  test.beforeAll(async () => {
    user = await createTemporaryUser(admin, 'billing-e2e');
  });

  test.afterAll(async () => {
    if (user) await deleteTemporaryUser(admin, user);
  });

  async function waitForUserProfile(page: Page): Promise<void> {
    const userMenu = page.getByTestId('user-menu');
    await expect(userMenu).toBeVisible({ timeout: 30_000 });
    await expect(userMenu.getByAltText('User')).toHaveCount(0, { timeout: 30_000 });
  }

  async function login(page: Page): Promise<void> {
    await gotoAuth(page);
    await loginWithCredentials(page, user.email, user.password);
    await expect(page).toHaveURL(/\/projects(?:\?|$)/, { timeout: 30_000 });
    await waitForUserProfile(page);
  }

  test('opens Billing from the avatar menu and renders the selectable catalog', async ({ page }) => {
    await login(page);

    await page.getByTestId('user-menu').click();
    await page.getByTestId('user-menu-billing').click();

    await expect(page).toHaveURL(/\/billing$/, { timeout: 30_000 });
    await expect(page.getByRole('region', { name: 'Subscription plans' })).toBeVisible();
    for (const plan of ['Starter', 'Pro', 'Studio', 'Enterprise']) {
      await expect(page.getByRole('heading', { name: plan, exact: true })).toBeVisible();
    }

    const studio = page.getByTestId('billing-plan-plan-studio');
    await studio.click();
    await expect(studio).toHaveAttribute('aria-pressed', 'true');
    await expect(studio).toHaveAttribute('data-selected', 'true');
  });

  test('submits Pro checkout, locks every action, and returns from success', async ({ page }) => {
    const checkoutRequest = deferred<Record<string, unknown>>();
    const checkoutResponse = deferred<void>();
    await page.route('**/api/checkout', async (route) => {
      expect(route.request().method()).toBe('POST');
      checkoutRequest.resolve(route.request().postDataJSON() as Record<string, unknown>);
      await checkoutResponse.promise;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: `${appOrigin()}/payment/success?session_id=e2e`,
        }),
      });
    });
    await login(page);
    await page.goto('/billing');
    await waitForUserProfile(page);

    const pro = page.getByTestId('billing-plan-plan-pro');
    const checkoutClick = pro
      .getByRole('button', { name: 'Choose Pro', exact: true })
      .click();

    expect(await checkoutRequest.promise).toEqual({
      planId: 'plan-pro',
      customerEmail: user.email,
    });
    await expect(
      pro.getByRole('button', { name: /Opening checkout/ })
    ).toBeDisabled();
    const actions = page.locator('[data-testid^="billing-plan-"] button');
    await expect(actions).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) {
      await expect(actions.nth(index)).toBeDisabled();
    }

    checkoutResponse.resolve();
    await checkoutClick;
    await expect(page).toHaveURL(/\/payment\/success\?session_id=e2e$/);
    await expect(
      page.getByRole('heading', { name: 'Thank you for your payment.' })
    ).toBeVisible();
    await expect(page.getByText('Payment received', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Return to billing' }).click();
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByTestId('billing-plans-page')).toBeVisible();
  });

  test('shows checkout errors and restores every plan action', async ({ page }) => {
    await page.route('**/api/checkout', async (route) => {
      expect(route.request().method()).toBe('POST');
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Checkout temporarily unavailable' }),
      });
    });
    await login(page);
    await page.goto('/billing');
    await waitForUserProfile(page);

    const studio = page.getByTestId('billing-plan-plan-studio');
    await studio.getByRole('button', { name: 'Choose Studio', exact: true }).click();

    await expect(page.getByRole('status')).toHaveText('Checkout temporarily unavailable');
    await expect(
      studio.getByRole('button', { name: /Opening checkout/ })
    ).toHaveCount(0);
    const actions = page.locator('[data-testid^="billing-plan-"] button');
    await expect(actions).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) {
      await expect(actions.nth(index)).toBeEnabled();
    }
  });

  test('returns to Billing from a canceled checkout', async ({ page }) => {
    await login(page);
    await page.goto('/payment/cancel?payment_id=e2e');

    await expect(page.getByText('Checkout canceled', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No payment was taken.' })).toBeVisible();

    await page.getByRole('link', { name: 'Return to billing' }).click();
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByTestId('billing-plans-page')).toBeVisible();
  });
});
