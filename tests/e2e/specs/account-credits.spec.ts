import { expect, test } from '@playwright/test';
import { loginToAccount } from '../helpers/account-storage';
import { SequencedCreditsBackend } from '../helpers/account-credits';

const summary = {
  allocated: 12.5,
  used: 0.0000819,
  remaining: 12.4999181,
  overage: 0,
  deepseekTokens: 21,
  incompleteCount: 2,
  trackedFrom: '2026-09-17T00:00:00.000Z',
};

test.describe('Account Credits', () => {
  test('shows the balance, fractional usage, and unpriced event warning', async ({ page }) => {
    const backend = new SequencedCreditsBackend([{ status: 200, body: summary }]);
    await loginToAccount(page, backend);

    await expect(page.getByTestId('account-credits-allocated')).toHaveText('12.5');
    await expect(page.getByTestId('account-credits-used')).toHaveText('0.000082');
    await expect(page.getByTestId('account-credits-remaining')).toHaveText('12.499918');
    await expect(page.getByRole('status')).toContainText('2 usage records');
    expect(backend.requestCount).toBe(1);
  });

  test('keeps the last values visible when a refresh fails', async ({ page }) => {
    const backend = new SequencedCreditsBackend([
      { status: 200, body: summary },
      { status: 503, body: { error: 'Unavailable' } },
    ]);
    await loginToAccount(page, backend);
    await expect(page.getByTestId('account-credits-remaining')).toHaveText('12.499918');

    await page.evaluate(() => {
      window.dispatchEvent(new Event('visibilitychange'));
    });

    await expect(
      page.getByRole('region', { name: 'Credits' }).getByRole('alert'),
    ).toContainText('could not be refreshed');
    await expect(page.getByTestId('account-credits-remaining')).toHaveText('12.499918');
    expect(backend.requestCount).toBe(2);
  });

  test('recovers when Retry succeeds after the initial load fails', async ({ page }) => {
    const backend = new SequencedCreditsBackend([
      { status: 503, body: { error: 'Unavailable' } },
      { status: 200, body: summary },
    ]);
    await loginToAccount(page, backend);
    await expect(page.getByText('Credit data could not be loaded')).toBeVisible();

    await page.getByRole('button', { name: 'Retry' }).click();

    await expect(page.getByTestId('account-credits-remaining')).toHaveText('12.499918');
    expect(backend.requestCount).toBe(2);
  });
});
