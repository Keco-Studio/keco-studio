import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LoginPage } from '../pages/login.page';
import {
  addProjectCollaborator,
  createFolderFixture,
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

test.describe('Sidebar Create Asset actions', () => {
  test.setTimeout(180_000);

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let editor: TemporaryUser;
  let rootProjectId: string;
  let folderProjectId: string;
  let folder: { id: string; name: string };

  async function login(page: Page, user: TemporaryUser): Promise<void> {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(user);
    await loginPage.expectLoginSuccess();
  }

  async function expectAssetMenuNavigates(page: Page, projectId: string): Promise<void> {
    const activation = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/projects/${projectId}/game-assets`) &&
        response.request().method() === 'POST',
    );

    await page.getByRole('menuitem', { name: 'Create Asset', exact: true }).click();
    expect((await activation).status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/${projectId}/admin/assets$`));
  }

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'sidebar-create-asset');
    editor = await createTemporaryUser(admin, 'sidebar-create-asset-editor');
    rootProjectId = await createProjectFixture(admin, owner.id, { addOwnerMembership: true });
    folderProjectId = await createProjectFixture(admin, owner.id, { addOwnerMembership: true });
    await addProjectCollaborator(admin, folderProjectId, editor.id, 'editor', owner.id);
    folder = await createFolderFixture(admin, folderProjectId, 'Asset destination');
  });

  test.afterAll(async () => {
    if (rootProjectId) await removeProjectFixture(admin, rootProjectId);
    if (folderProjectId) await removeProjectFixture(admin, folderProjectId);
    if (owner) await deleteTemporaryUser(admin, owner);
    if (editor) await deleteTemporaryUser(admin, editor);
  });

  test('shows Create Asset in the root menu for an admin before Assets is enabled', async ({ page }) => {
    await login(page, owner);
    await page.goto(`/${rootProjectId}`);

    const sidebar = page.locator('aside');
    await sidebar.locator('button[title="Add new folder, library, or document"]').click();
    await expect(page.getByRole('menuitem', { name: 'Create Asset', exact: true })).toBeVisible();
    await expectAssetMenuNavigates(page, rootProjectId);

    const { data, error } = await admin
      .from('projects')
      .select('assets_workspace_enabled')
      .eq('id', rootProjectId)
      .single();
    if (error) throw error;
    expect(data.assets_workspace_enabled).toBe(true);
  });

  test('shows Create Asset in the folder menu for an editor before Assets is enabled', async ({ page }) => {
    await login(page, editor);
    await page.goto(`/${folderProjectId}`);

    const sidebar = page.locator('aside');
    const folderRow = sidebar.locator(`[title="${folder.name}"]`).first();
    await expect(folderRow).toBeVisible({ timeout: 30_000 });
    const treeNode = folderRow.locator('xpath=ancestor::div[contains(@class,"ant-tree-treenode")][1]');
    await treeNode.hover();
    await treeNode.getByRole('button', { name: 'Folder actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Create Asset', exact: true })).toBeVisible();
    await expectAssetMenuNavigates(page, folderProjectId);

    const { data, error } = await admin
      .from('projects')
      .select('assets_workspace_enabled')
      .eq('id', folderProjectId)
      .single();
    if (error) throw error;
    expect(data.assets_workspace_enabled).toBe(true);
  });
});
