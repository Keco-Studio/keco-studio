import { expect, test, type Page } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { users } from '../fixures/users';

async function login(page: Page) {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(users.seedEmpty4);
  await loginPage.expectLoginSuccess();
}

test.describe('Keco Admin workspace', () => {
  test('hides privileged navigation and denies overview to another account', async ({ page }) => {
    await login(page);

    await page.getByTestId('user-menu').click();
    await expect(page.getByTestId('user-menu-keco-admin')).toHaveCount(0);
    await expect(
      page
        .getByRole('navigation', { name: 'Product' })
        .getByRole('button', { name: 'Keco Admin', exact: true }),
    ).toHaveCount(0);

    const status = await page.evaluate(async () => {
      const response = await fetch('/api/keco-admin/overview');
      return response.status;
    });
    expect(status).toBe(403);

    await page.goto('/keco-admin');
    await expect(page).toHaveURL(/\/projects$/);
  });

  test('opens the complete workspace for an approved capability', async ({ page }) => {
    await page.route('**/api/keco-admin/access', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'private, no-store' },
      body: JSON.stringify({ isAdmin: true }),
    }));
    await page.route('**/api/keco-admin/overview', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'private, no-store' },
      body: JSON.stringify({
        totalUsers: 9,
        refreshedAt: '2026-09-11T10:00:00.000Z',
        users: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'alice@example.com',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastSignInAt: '2026-09-01T00:00:00.000Z',
            status: 'active',
          },
        ],
      }),
    }));
    await login(page);

    await page.getByTestId('user-menu').click();
    const adminButton = page.getByTestId('user-menu-keco-admin');
    await expect(adminButton).toBeVisible();
    expect(
      await adminButton.evaluate((node) => node.nextElementSibling?.textContent),
    ).toContain('Logout');
    await adminButton.click();

    await expect(page).toHaveURL(/\/keco-admin$/);
    await expect(
      page.getByRole('heading', { name: 'Keco Admin', exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('keco-admin-total-users')).toHaveText('9');
    await expect(page.getByText('alice@example.com')).toBeVisible();
    await expect(page.getByText('Active')).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Resource overview' })
        .getByText('Not connected', { exact: true }),
    ).toHaveCount(3);
    await expect(
      page.getByRole('table', { name: 'User resource details' }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Product' })
        .getByRole('button', { name: 'Keco Admin', exact: true }),
    ).toHaveCount(0);
  });

  test('keeps the dashboard contained at narrow width', async ({ page }) => {
    await page.route('**/api/keco-admin/access', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ isAdmin: true }),
    }));
    await page.route('**/api/keco-admin/overview', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totalUsers: 9,
        refreshedAt: '2026-09-11T10:00:00.000Z',
        users: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'alice@example.com',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastSignInAt: null,
            status: 'active',
          },
        ],
      }),
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto('/keco-admin');
    await expect(page.getByTestId('keco-admin-total-users')).toHaveText('9');

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(
      page.getByRole('region', { name: 'Scrollable user resource table' }),
    ).toBeVisible();
  });
});
