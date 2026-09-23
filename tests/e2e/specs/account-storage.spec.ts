import { expect, test } from '@playwright/test';
import {
  ACCOUNT_STORAGE_COLLABORATOR_ID,
  ACCOUNT_STORAGE_OWNER_ID,
  AccountStorageMockBackend,
  FORBIDDEN_PROJECT_ID,
  OWNED_FOLDER_ID,
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
    await expect(page.getByLabel('Storage usage breakdown')).toContainText('Media 500 GB');
    await expect(page.getByLabel('Storage usage breakdown')).toContainText('Content 12 GB');
    await expect(page.getByRole('button', { name: /Owned Storage Fixture/ })).toContainText('4 items');
    await expect(page.getByRole('button', { name: /Shared Storage Fixture/ })).toContainText('Owned by Another Owner');
    await expect(page.getByText('Excluded from your allowance')).toBeVisible();
    await expect(page.getByText('Unassigned legacy files')).toBeVisible();
  });

  test('browses Folder contents, returns through the breadcrumb, and opens Table details', async ({ page }) => {
    const backend = new AccountStorageMockBackend();
    await loginToAccount(page, backend);

    await page.getByRole('button', { name: /Owned Storage Fixture/ }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Story content' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Assets' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Characters' })).toHaveCount(0);
    await expect(page.getByText('alice.png')).toHaveCount(0);

    await page.getByRole('listitem').filter({ hasText: 'Story content' }).click();
    await expect.poll(() => backend.entityRequests.at(-1)?.searchParams.get('parentFolderId')).toBe(OWNED_FOLDER_ID);
    await expect(page.getByRole('listitem').filter({ hasText: 'Story outline' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Characters' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Assets' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Project storage path' })).toContainText('Story content');

    await page.getByRole('searchbox', { name: 'Search folders, tables, documents, assets' }).fill('characters');
    await expect.poll(() => {
      const request = backend.entityRequests.at(-1);
      return [request?.searchParams.get('parentFolderId'), request?.searchParams.get('query')];
    }).toEqual([OWNED_FOLDER_ID, 'characters']);
    await page.getByLabel('Sort items').selectOption('name_asc');
    await expect.poll(() => {
      const request = backend.entityRequests.at(-1);
      return [request?.searchParams.get('parentFolderId'), request?.searchParams.get('sort')];
    }).toEqual([OWNED_FOLDER_ID, 'name_asc']);

    await page.getByRole('listitem').filter({ hasText: 'Characters' }).click();
    await expect(page.getByLabel('Characters storage details')).toContainText('Alice');
    await expect(page.getByLabel('Characters storage details')).toContainText('alice.png');

    const targetPath = `/${OWNED_PROJECT_ID}/84000000-0000-4000-8000-000000000008`;
    const navigation = page.waitForRequest((request) => new URL(request.url()).pathname === targetPath);
    await page.getByRole('button', { name: 'Open Table' }).click();
    expect(new URL((await navigation).url()).pathname).toBe(targetPath);

    await page.getByRole('button', { name: 'Owned Storage Fixture', exact: true }).click();
    await expect.poll(() => backend.entityRequests.at(-1)?.searchParams.has('parentFolderId')).toBe(false);
    await expect(page.getByRole('listitem').filter({ hasText: 'Assets' })).toBeVisible();
  });

  test('shows zero remaining and logical overage without reporting physical storage as full', async ({ page }) => {
    const backend = new AccountStorageMockBackend();
    backend.setLogicalOverage(1024 ** 3);
    await loginToAccount(page, backend);

    const storage = page.getByRole('region', { name: 'Storage', exact: true });
    await expect(storage.getByText('Stored content exceeds the allowance by 1 GB.')).toBeVisible();
    await expect(storage.getByText('Remaining').locator('..')).toContainText('0 B');
    await expect(storage.getByText(/Storage is full/)).toHaveCount(0);
  });

  test('forwards entity search and sort and opens the Assets workspace', async ({ page }) => {
    const backend = new AccountStorageMockBackend();
    await loginToAccount(page, backend);

    await page.getByRole('button', { name: /Owned Storage Fixture/ }).click();
    await page.getByRole('searchbox', { name: 'Search folders, tables, documents, assets' }).fill('assets');
    await expect(page.getByRole('listitem').filter({ hasText: 'Assets' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Characters' })).toHaveCount(0);
    await expect.poll(() => backend.entityRequests.at(-1)?.searchParams.get('query')).toBe('assets');

    await page.getByLabel('Sort items').selectOption('name_desc');
    await expect.poll(() => backend.entityRequests.at(-1)?.searchParams.get('sort')).toBe('name_desc');
    await page.getByRole('listitem').filter({ hasText: 'Assets' }).click();
    await expect(page.getByLabel('Assets storage details')).toContainText('project-assets.zip');

    const targetPath = `/${OWNED_PROJECT_ID}/admin/assets`;
    const navigation = page.waitForRequest((request) => new URL(request.url()).pathname === targetPath);
    await page.getByRole('button', { name: 'Open Assets' }).click();
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

  test('reports inaccessible project entity APIs without exposing their contents', async ({ page }) => {
    const backend = new AccountStorageMockBackend();
    await loginToAccount(page, backend);

    await page.getByRole('button', { name: /Shared Storage Fixture/ }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Assets' })).toBeVisible();

    const status = await page.evaluate(async (projectId) => {
      const response = await fetch(`/api/account/storage/projects/${projectId}/entities?query=&sort=size_desc&limit=50&offset=0`);
      return response.status;
    }, FORBIDDEN_PROJECT_ID);
    expect(status).toBe(403);
    await expect.poll(() => backend.entityRequests.at(-1)?.pathname).toContain(FORBIDDEN_PROJECT_ID);
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
