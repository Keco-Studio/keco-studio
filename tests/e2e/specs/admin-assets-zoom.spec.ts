import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LoginPage } from '../pages/login.page';
import {
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

test.describe('Admin assets gallery zoom', () => {
  test.setTimeout(180_000);

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let projectId: string;

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'admin-assets-zoom');
    projectId = await createProjectFixture(admin, owner.id, { addOwnerMembership: true });

    const { error } = await admin.from('project_game_assets').insert(
      Array.from({ length: 8 }, (_, index) => ({
        project_id: projectId,
        created_by: owner.id,
        name: `Gallery asset ${index + 1}`,
        category: 'ui',
        status: 'ready',
        mime_type: 'image/png',
        storage_path: `${projectId}/e2e-gallery-${index + 1}.png`,
        width: 320 + index * 20,
        height: 180 + index * 10,
        file_size: 1024 + index,
      })),
    );
    if (error) throw error;
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('resizes assets with controls and Ctrl/Cmd wheel without page zoom', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(owner);
    await login.expectLoginSuccess();
    await page.goto(`/${projectId}/admin/assets`, { waitUntil: 'domcontentloaded' });

    const grid = page.getByTestId('game-assets-grid');
    await expect(grid).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('100%', { exact: true })).toBeVisible();

    const pageWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const gridBox = await grid.boundingBox();
    if (!gridBox) throw new Error('Admin assets grid has no bounding box');

    await page.keyboard.down('Control');
    await page.mouse.move(gridBox.x + gridBox.width / 2, gridBox.y + gridBox.height / 2);
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await expect(page.getByText('125%', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(pageWidth);

    await page.getByRole('button', { name: 'Increase asset size' }).click();
    await expect(page.getByText('150%', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Decrease asset size' }).click();
    await expect(page.getByText('125%', { exact: true })).toBeVisible();

    for (let step = 0; step < 6; step += 1) {
      await page.getByRole('button', { name: 'Decrease asset size' }).click();
    }
    await expect(page.getByText('10%', { exact: true })).toBeVisible();
    await expect(grid).toHaveAttribute('data-asset-layout', 'list');
    const compactRows = grid.locator('[data-asset-row]');
    await expect(compactRows).toHaveCount(8);
    await expect(compactRows.first().locator('[data-asset-card]')).toHaveCount(1);
    await expect(grid.locator('[data-asset-card]').first().locator(':scope > div').first()).toHaveCSS(
      'width',
      '56px',
    );

    await page.getByRole('button', { name: 'Gallery asset 1' }).click();
    await expect(page.getByRole('dialog', { name: 'Asset detail' })).toBeVisible();
  });
});
