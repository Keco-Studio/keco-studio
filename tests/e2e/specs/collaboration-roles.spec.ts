import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CollaboratorPage } from '../pages/collaborator.page';
import { LoginPage } from '../pages/login.page';
import {
  addProjectCollaborator,
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getBrowserAccessToken,
  getE2EAdminClient,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

test.describe('Collaborator role management', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 });

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let projectId: string;
  const members: TemporaryUser[] = [];

  async function login(page: Page, user: TemporaryUser): Promise<void> {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(user);
    await loginPage.expectLoginSuccess();
  }

  async function roleFromBrowser(page: Page): Promise<string | null> {
    const accessToken = await getBrowserAccessToken(page);
    return page.evaluate(async ({ id, accessToken }) => {
      const response = await fetch(`/api/projects/${id}/role`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      return result.role ?? null;
    }, { id: projectId, accessToken });
  }

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'roles-owner');
    projectId = await createProjectFixture(admin, owner.id, { addOwnerMembership: true });
  });

  test.beforeEach(async () => {
    await admin
      .from('project_collaborators')
      .delete()
      .eq('project_id', projectId)
      .neq('user_id', owner.id);
    await addProjectCollaborator(admin, projectId, owner.id, 'admin', null);
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    for (const member of members) await deleteTemporaryUser(admin, member);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('changes another collaborator role and updates their permissions', async ({ browser, page }) => {
    const member = await createTemporaryUser(admin, 'roles-change');
    members.push(member);
    await addProjectCollaborator(admin, projectId, member.id, 'editor', owner.id);
    await login(page, owner);

    const collaborators = new CollaboratorPage(page);
    await collaborators.goto(projectId);
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/collaborators/') && response.request().method() === 'PATCH'
    );
    await collaborators.changeRole(member.email, 'viewer');
    expect((await responsePromise).status()).toBe(200);
    await expect(collaborators.collaboratorRow(member.email)).toContainText('Viewer');

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await login(memberPage, member);
    expect(await roleFromBrowser(memberPage)).toBe('viewer');
    await memberContext.close();
  });

  test('removes a collaborator and revokes project access', async ({ browser, page }) => {
    const member = await createTemporaryUser(admin, 'roles-remove');
    members.push(member);
    await addProjectCollaborator(admin, projectId, member.id, 'editor', owner.id);
    await login(page, owner);

    const collaborators = new CollaboratorPage(page);
    await collaborators.goto(projectId);
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/collaborators/') && response.request().method() === 'DELETE'
    );
    await collaborators.remove(member.email);
    expect((await responsePromise).status()).toBe(200);
    await expect(collaborators.collaboratorRow(member.email)).toHaveCount(0);

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await login(memberPage, member);
    expect(await roleFromBrowser(memberPage)).toBeNull();
    await memberContext.close();
  });

  test('prevents changing or removing your own membership', async ({ page }) => {
    await login(page, owner);
    const collaborators = new CollaboratorPage(page);
    await collaborators.goto(projectId);
    const selfRow = collaborators.collaboratorRow(owner.email);
    await expect(selfRow.getByTestId('collaborator-role-button')).toHaveCount(0);
    await expect(selfRow.getByTestId('collaborator-remove-button')).toHaveCount(0);

    const { data: membership } = await admin
      .from('project_collaborators')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', owner.id)
      .single();

    const accessToken = await getBrowserAccessToken(page);
    const results = await page.evaluate(async ({ id, accessToken }) => {
      const patch = await fetch(`/api/collaborators/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ newRole: 'viewer' }),
      });
      const remove = await fetch(`/api/collaborators/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { patch: { status: patch.status, body: await patch.json() }, remove: { status: remove.status, body: await remove.json() } };
    }, { id: membership!.id, accessToken });

    expect(results.patch).toMatchObject({ status: 400, body: { error: 'You cannot change your own role' } });
    expect(results.remove).toMatchObject({
      status: 400,
      body: { error: 'You cannot remove yourself from the project' },
    });
  });

  test('blocks demoting and removing the last admin', async ({ page }) => {
    await admin
      .from('project_collaborators')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', owner.id);
    const soleAdmin = await createTemporaryUser(admin, 'roles-sole-admin');
    members.push(soleAdmin);
    await addProjectCollaborator(admin, projectId, soleAdmin.id, 'admin', owner.id);
    await login(page, owner);

    const collaborators = new CollaboratorPage(page);
    await collaborators.goto(projectId);
    await collaborators.changeRole(soleAdmin.email, 'viewer');
    await collaborators.expectError(/Cannot change the last admin/i);
    await expect(collaborators.collaboratorRow(soleAdmin.email)).toContainText('Admin');

    await collaborators.remove(soleAdmin.email);
    await collaborators.expectError(/Cannot remove the last admin/i);
    await expect(collaborators.collaboratorRow(soleAdmin.email)).toBeVisible();
  });
});
