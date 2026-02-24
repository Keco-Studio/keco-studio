import { expect, type Page } from '@playwright/test';
import { authSelectors } from './selectors';

const SEED_EMPTY_EMAIL = 'seed-empty@example.com';
const SEED_PROJECT_EMAIL = 'seed-project@example.com';
const SEED_LIBRARY_EMAIL = 'seed-library@example.com';
const SEED_PASSWORD = 'Password123!';

export async function gotoAuth(page: Page) {
  await page.goto('/');
  const { headingLogin } = authSelectors(page);
  await expect(headingLogin).toBeVisible();
}

export async function loginWithCredentials(page: Page, email: string, password: string) {
  const { emailInput, passwordInput, loginButton } = authSelectors(page);

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await loginButton.click();
}

export async function loginAsSeedEmpty(page: Page) {
  await gotoAuth(page);
  await loginWithCredentials(page, SEED_EMPTY_EMAIL, SEED_PASSWORD);
}

export async function loginAsSeedProject(page: Page) {
  await gotoAuth(page);
  await loginWithCredentials(page, SEED_PROJECT_EMAIL, SEED_PASSWORD);
}

export async function loginAsSeedLibrary(page: Page) {
  await gotoAuth(page);
  await loginWithCredentials(page, SEED_LIBRARY_EMAIL, SEED_PASSWORD);
}

export async function loginWithWrongPassword(page: Page) {
  await gotoAuth(page);
  await loginWithCredentials(page, SEED_EMPTY_EMAIL, 'WrongPassword!');
}


