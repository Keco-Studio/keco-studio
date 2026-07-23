import { expect, test, type Page } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { users } from '../fixures/users';

const codexAdd = 'codex mcp add keco-account --url \"https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp\" --oauth-resource \"https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp\"';
const codexLogin = 'codex mcp login keco-account';
const claudeAdd = 'claude mcp add --transport http keco-account \"https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp\"';

async function login(page: Page) {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(users.seedEmpty4);
  await loginPage.expectLoginSuccess();
}

test.describe('MCP account connections page', () => {
  test('requires an authenticated Keco browser session', async ({ page, context }) => {
    await page.goto('/');
    await context.clearCookies();
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto('/mcp');
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'MCP', exact: true })).not.toBeVisible();
  });

  test('opens from the avatar menu, copies exact commands, and renders duplicate clients', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    let deletedId: string | null = null;
    await page.route('**/api/mcp/connections', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'private, no-store' },
        body: JSON.stringify({
          connections: [
            { id: 'v1.codex-one', client: 'codex', clientName: 'Codex', connectedAt: '2026-07-24T03:00:00Z' },
            { id: 'v1.codex-two', client: 'codex', clientName: 'Codex', connectedAt: '2026-07-24T02:00:00Z' },
          ].filter((item) => item.id !== deletedId),
        }),
      });
    });
    await page.route('**/api/mcp/connections/*', async (route) => {
      deletedId = route.request().url().split('/').pop() ?? null;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    });

    await login(page);
    await page.getByTestId('user-menu').click();
    const mcpButton = page.getByRole('button', { name: 'MCP', exact: true });
    const logoutButton = page.getByRole('button', { name: 'Logout', exact: true });
    await expect(mcpButton).toBeVisible();
    expect(await mcpButton.evaluate((node) => node.nextElementSibling?.textContent)).toContain('Logout');
    await expect(logoutButton).toBeVisible();
    await mcpButton.click();
    await expect(page).toHaveURL(/\/mcp$/);
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'MCP', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Copy Add Keco MCP command' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(codexAdd);
    await page.getByRole('button', { name: 'Copy Sign in to Keco command' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(codexLogin);
    await page.getByRole('tab', { name: 'Claude Code' }).click();
    await page.getByRole('button', { name: 'Copy Add Keco MCP command' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(claudeAdd);

    await expect(page.getByTestId('mcp-connection-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Disconnect Codex' }).first().click();
    await expect(page.getByText('Disconnect Codex?')).toBeVisible();
    await expect(page.getByText('This client will no longer be able to access Keco.')).toBeVisible();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByTestId('mcp-connection-row')).toHaveCount(1);
  });

  test('wraps commands and avoids horizontal overflow on desktop and mobile', async ({ page }) => {
    await page.route('**/api/mcp/connections', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        connections: [{ id: 'v1.claude', client: 'claude', clientName: 'Claude Code', connectedAt: '2026-07-24T03:00:00Z' }],
      }),
    }));
    await login(page);

    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/mcp');
      await expect(page.getByRole('heading', { name: 'MCP', exact: true })).toBeVisible();
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        commands: Array.from(document.querySelectorAll('code')).map((node) => node.scrollWidth - node.clientWidth),
      }));
      expect(overflow.page).toBeLessThanOrEqual(0);
      expect(overflow.commands.every((value) => value <= 0)).toBe(true);
      const connectedHeader = page.getByText('CONNECTED', { exact: true });
      if (viewport.width <= 680) await expect(connectedHeader).toBeHidden();
      else await expect(connectedHeader).toBeVisible();
    }
  });
});
