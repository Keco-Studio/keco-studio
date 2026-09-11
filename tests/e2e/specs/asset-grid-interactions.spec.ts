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

test.describe('Asset grid interactions', () => {
  test.setTimeout(180_000);

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let projectId: string;
  let libraryId: string;

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'asset-grid-owner');
    projectId = await createProjectFixture(admin, owner.id, { addOwnerMembership: true });

    const { data: library, error: libraryError } = await admin
      .from('libraries')
      .insert({
        project_id: projectId,
        name: `Asset Grid ${crypto.randomUUID().slice(0, 6)}`,
        description: 'Asset grid browser regression fixture',
      })
      .select('id')
      .single();
    if (libraryError || !library) throw libraryError ?? new Error('Failed to create asset grid library');
    libraryId = library.id as string;

    const { error: assetsError } = await admin.from('library_assets').insert(
      Array.from({ length: 96 }, (_, rowIndex) => ({
        library_id: libraryId,
        name: `Asset ${String(rowIndex + 1).padStart(3, '0')}`,
        row_index: rowIndex,
      })),
    );
    if (assetsError) throw assetsError;
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('zooms independently, keeps a visible Tab target, and navigates across virtual rows', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(owner);
    await login.expectLoginSuccess();
    await page.goto(`/${projectId}/${libraryId}`, { waitUntil: 'domcontentloaded' });

    const grid = page.getByTestId('library-assets-grid');
    await expect(grid).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('100%', { exact: true })).toBeVisible();
    expect(await grid.getByRole('gridcell').count()).toBeLessThan(96);

    const gridBox = await grid.boundingBox();
    if (!gridBox) throw new Error('Asset grid has no bounding box');
    await page.mouse.move(gridBox.x + gridBox.width / 2, gridBox.y + gridBox.height / 2);
    await page.mouse.wheel(0, 1200);
    await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByText('100%', { exact: true })).toBeVisible();

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await expect(page.getByText('125%', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Decrease asset size' }).click();
    await expect(page.getByText('100%', { exact: true })).toBeVisible();
    await grid.evaluate((element) => {
      element.scrollTop = Math.floor(element.scrollHeight * 0.55);
      element.dispatchEvent(new Event('scroll'));
    });

    const getFirstVisibleIndex = () => grid.evaluate((element) => {
      const gridRect = element.getBoundingClientRect();
      const visibleCard = [...element.querySelectorAll<HTMLElement>('[data-asset-index]')]
        .find((card) => {
          const cardRect = card.getBoundingClientRect();
          return cardRect.bottom > gridRect.top && cardRect.top < gridRect.bottom;
        });
      return visibleCard ? Number(visibleCard.dataset.assetIndex) : -1;
    });
    await expect.poll(getFirstVisibleIndex).toBeGreaterThan(0);
    const firstVisibleIndex = await getFirstVisibleIndex();

    await page.getByRole('button', { name: 'Table view' }).focus();
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() =>
      Number((document.activeElement as HTMLElement | null)?.dataset.assetIndex ?? -1)
    )).toBe(firstVisibleIndex);

    await page.keyboard.press('End');
    const lastCard = grid.locator('[data-asset-index="95"]');
    await expect(lastCard).toBeFocused();
    await expect(lastCard).toHaveAttribute('aria-selected', 'true');
  });
});
