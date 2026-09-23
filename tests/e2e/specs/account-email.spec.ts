import { expect, test } from '@playwright/test';
import { AccountEmailMockBackend } from '../helpers/account-email';
import { loginToAccount } from '../helpers/account-storage';

const currentEmail = 'account-storage-e2e@example.com';
const nextEmail = 'new-account-email@example.com';

async function requestEmailChange(
  page: Parameters<typeof loginToAccount>[0],
  backend: AccountEmailMockBackend,
): Promise<void> {
  await loginToAccount(page, backend);
  const emailRegion = page.getByRole('region', { name: 'Email address' });
  await emailRegion.getByLabel('Current email').fill(currentEmail);
  await emailRegion.getByLabel('New email').fill(nextEmail);
  await emailRegion.getByRole('button', { name: 'Change email' }).click();
  await expect(emailRegion.getByLabel('Verification code')).toBeVisible();
}

test.describe('Account email settings', () => {
  test('rejects an old-email identity mismatch without requesting a change', async ({ page }) => {
    const backend = new AccountEmailMockBackend();
    await loginToAccount(page, backend);
    const emailRegion = page.getByRole('region', { name: 'Email address' });

    await emailRegion.getByLabel('Current email').fill('someone-else@example.com');
    await emailRegion.getByLabel('New email').fill(nextEmail);
    await emailRegion.getByRole('button', { name: 'Change email' }).click();

    await expect(emailRegion.getByRole('alert')).toContainText(
      'Current email does not match your signed-in account.',
    );
    expect(backend.updateRequests).toHaveLength(0);
  });

  test('requests and verifies an email change', async ({ page }) => {
    const backend = new AccountEmailMockBackend();
    await requestEmailChange(page, backend);
    const emailRegion = page.getByRole('region', { name: 'Email address' });

    expect(backend.updateRequests).toEqual([{
      email: nextEmail,
      code_challenge: expect.any(String),
      code_challenge_method: 's256',
    }]);
    await emailRegion.getByLabel('Verification code').fill('123456');
    await emailRegion.getByRole('button', { name: 'Verify email' }).click();

    await expect(emailRegion.getByText(nextEmail, { exact: true })).toBeVisible();
    await expect(emailRegion.getByLabel('New email')).toBeVisible();
    expect(backend.verifyRequests).toEqual([{
      email: nextEmail,
      token: '123456',
      type: 'email_change',
      gotrue_meta_security: {},
    }]);
  });

  test('keeps the verification form after an incorrect OTP', async ({ page }) => {
    const backend = new AccountEmailMockBackend();
    backend.setOtpFailure('incorrect');
    await requestEmailChange(page, backend);
    const emailRegion = page.getByRole('region', { name: 'Email address' });

    await emailRegion.getByLabel('Verification code').fill('000000');
    await emailRegion.getByRole('button', { name: 'Verify email' }).click();

    await expect(emailRegion.getByRole('alert')).toHaveText('That verification code is incorrect.');
    await expect(emailRegion.getByLabel('Verification code')).toHaveValue('000000');
  });

  test('keeps the verification form after an expired OTP', async ({ page }) => {
    const backend = new AccountEmailMockBackend();
    backend.setOtpFailure('expired');
    await requestEmailChange(page, backend);
    const emailRegion = page.getByRole('region', { name: 'Email address' });

    await emailRegion.getByLabel('Verification code').fill('123456');
    await emailRegion.getByRole('button', { name: 'Verify email' }).click();

    await expect(emailRegion.getByRole('alert')).toHaveText('This verification code has expired.');
    await expect(emailRegion.getByLabel('Verification code')).toHaveValue('123456');
  });

  test('restores a pending email change after reload', async ({ page }) => {
    const backend = new AccountEmailMockBackend();
    backend.setPendingEmail(nextEmail);
    await loginToAccount(page, backend);
    const emailRegion = page.getByRole('region', { name: 'Email address' });

    await expect(emailRegion.getByText(`A verification code was sent to ${nextEmail}.`)).toBeVisible();
    await page.reload();

    await expect(emailRegion.getByText(`A verification code was sent to ${nextEmail}.`)).toBeVisible();
    await expect(emailRegion.getByLabel('Verification code')).toBeVisible();
    expect(backend.updateRequests).toHaveLength(0);
  });
});
