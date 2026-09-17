import { expect, test } from '@playwright/test';
import {
  ACCOUNT_STORAGE_COLLABORATOR_ID,
  ACCOUNT_STORAGE_OWNER_ID,
  AccountStorageMockBackend,
  FORBIDDEN_PROJECT_ID,
  OWNED_PROJECT_ID,
  SHARED_PROJECT_ID,
  attemptProjectAssetUpload,
  loginToAccount,
} from '../helpers/account-storage';

test.describe('Account storage', () => {
  test.describe.configure({ timeout: 60_000 });

  test('shows owned usage, shared usage, and legacy rows without charging shared bytes twice', async ({ page }) => {
    const backend = new AccountStorageMockBackend();
    await loginToAccount(page, backend);

    await expect(page.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible();
    await expect(page.getByTestId('account-storage-summary')).toContainText('1 TB');
    await expect(page.getByTestId('account-storage-used')).toContainText('512 GB');
    await expect(page.getByRole('button', { name: /Owned Storage Fixture/ })).toContainText('3 files');
    await expect(page.getByRole('button', { name: /Shared Storage Fixture/ })).toContainText('Owned by Another Owner');
    await expect(page.getByText('Excluded from your allowance')).toBeVisible();
    await expect(page.getByText('Unassigned legacy files')).toBeVisible();
  });

  test('loads selected project files, forwards search and sort, exposes unavailable sources, and opens available locations', async ({ page }) => {
    const backend = new AccountStorageMockBackend();
    await loginToAccount(page, backend);

    await page.getByRole('button', { name: /Owned Storage Fixture/ }).click();
    await expect(page.getByRole('cell', { name: 'Zebra large.png', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Source no longer exists' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Deleted source.png location' })).toBeDisabled();

    await page.getByRole('searchbox', { name: 'Search files' }).fill('alpha');
    await expect(page.getByRole('cell', { name: 'Alpha small.png', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Zebra large.png', exact: true })).toHaveCount(0);
    await expect.poll(() => backend.fileRequests.at(-1)?.searchParams.get('query')).toBe('alpha');

    await page.getByLabel('Sort files').selectOption('name_desc');
    await expect.poll(() => backend.fileRequests.at(-1)?.searchParams.get('sort')).toBe('name_desc');

    const targetPath = `/${OWNED_PROJECT_ID}/admin/assets`;
    const navigation = page.waitForRequest((request) => new URL(request.url()).pathname === targetPath);
    await page.getByRole('button', { name: 'Open Alpha small.png location' }).click();
    expect(new URL((await navigation).url()).pathname).toBe(targetPath);
  });

  test('shows the 80%, 95%, and full warnings', async ({ page }) => {
    const backend = new AccountStorageMockBackend();
    backend.setUsagePercent(80);
    await loginToAccount(page, backend);
    const storage = page.getByRole('region', { name: 'Storage', exact: true });
    await expect(storage.getByRole('alert')).toContainText('Storage is 80% full');

    backend.setUsagePercent(95);
    await page.reload();
    await expect(storage.getByRole('alert')).toContainText('Storage is 95% full');

    backend.setUsagePercent(100);
    await page.reload();
    await expect(storage.getByRole('alert')).toContainText('Storage is full');
  });

  test('reports inaccessible project file APIs without exposing their contents', async ({ page }) => {
    const backend = new AccountStorageMockBackend();
    await loginToAccount(page, backend);

    await page.getByRole('button', { name: /Shared Storage Fixture/ }).click();
    await expect(page.getByRole('cell', { name: 'Shared fixture.png', exact: true })).toBeVisible();

    const status = await page.evaluate(async (projectId) => {
      const response = await fetch(`/api/account/storage/projects/${projectId}/files?query=&sort=size_desc&limit=50&offset=0`);
      return response.status;
    }, FORBIDDEN_PROJECT_ID);
    expect(status).toBe(403);
    await expect.poll(() => backend.fileRequests.at(-1)?.pathname).toContain(FORBIDDEN_PROJECT_ID);
  });

  test('allows owner and collaborator uploads below the owner quota, then blocks both at the same owner quota', async ({ page }) => {
    const backend = new AccountStorageMockBackend();
    await loginToAccount(page, backend);

    expect(await attemptProjectAssetUpload(page, OWNED_PROJECT_ID, ACCOUNT_STORAGE_OWNER_ID)).toMatchObject({ status: 201 });
    expect(await attemptProjectAssetUpload(page, SHARED_PROJECT_ID, ACCOUNT_STORAGE_COLLABORATOR_ID)).toMatchObject({ status: 201 });

    backend.setQuotaFull();
    expect(await attemptProjectAssetUpload(page, OWNED_PROJECT_ID, ACCOUNT_STORAGE_OWNER_ID)).toMatchObject({
      status: 409,
      body: { code: 'STORAGE_QUOTA_EXCEEDED' },
    });
    expect(await attemptProjectAssetUpload(page, SHARED_PROJECT_ID, ACCOUNT_STORAGE_COLLABORATOR_ID)).toMatchObject({
      status: 409,
      body: { code: 'STORAGE_QUOTA_EXCEEDED' },
    });
  });
});
