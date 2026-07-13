import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CollaboratorPage } from '../pages/collaborator.page';
import { LoginPage, type UserCredentials } from '../pages/login.page';
import { users } from '../fixures/users';
import {
  createInvitationFixture,
  invitationExists,
} from '../utils/invitation-helpers';
import {
  addProjectCollaborator,
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  getUserIdByEmail,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

test.describe('Collaboration invitations', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 });

  let admin: SupabaseClient;
  let ownerId: string;
  let projectId: string;
  const temporaryUsers: TemporaryUser[] = [];

  async function login(page: Page, user: UserCredentials): Promise<void> {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(user);
    await loginPage.expectLoginSuccess();
  }

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    ownerId = await getUserIdByEmail(admin, users.seedEmpty2.email);
    projectId = await createProjectFixture(admin, ownerId);
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    for (const user of temporaryUsers) await deleteTemporaryUser(admin, user);
  });

  test('validates email and restricts editor role grants', async ({ page }) => {
    const editorId = await getUserIdByEmail(admin, users.seedEmpty4.email);
    await addProjectCollaborator(admin, projectId, editorId, 'editor', ownerId);
    await login(page, users.seedEmpty4);

    const collaborators = new CollaboratorPage(page);
    await collaborators.goto(projectId);
    await collaborators.openInvite();
    await collaborators.submitInvite();
    await expect(page.getByText('Please enter an email address')).toBeVisible();

    await collaborators.fillInviteEmail('not-an-email');
    await collaborators.submitInvite();
    await expect(page.getByText('Please enter a valid email address')).toBeVisible();

    await collaborators.openInviteRoleOptions();
    const visibleOptions = page.locator('.ant-select-item-option:visible');
    await expect(visibleOptions.filter({ hasText: 'Admin' })).toHaveCount(0);
    await expect(visibleOptions.filter({ hasText: 'Editor' })).toBeVisible();
    await expect(visibleOptions.filter({ hasText: 'Viewer' })).toBeVisible();
  });

  test('auto-accepts an invitation submitted by the owner', async ({ page }) => {
    const inviteeId = await getUserIdByEmail(admin, users.seedEmpty3.email);
    await admin
      .from('project_collaborators')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', inviteeId);

    await login(page, users.seedEmpty2);
    const collaborators = new CollaboratorPage(page);
    await collaborators.goto(projectId);
    await collaborators.openInvite();
    await collaborators.fillInviteEmail(users.seedEmpty3.email);
    await collaborators.selectInviteRole('Viewer');

    const responsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/invitations') && response.request().method() === 'POST'
    );
    await collaborators.submitInvite();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    await expect(response.json()).resolves.toMatchObject({ success: true, autoAccepted: true });
    await expect(collaborators.collaboratorRow(users.seedEmpty3.email)).toBeVisible();
  });

  test('accepts a token while already logged in', async ({ page }) => {
    const invitee = await createTemporaryUser(admin, 'invite-logged-in');
    temporaryUsers.push(invitee);
    const invitation = await createInvitationFixture(admin, {
      projectId,
      recipientEmail: invitee.email,
      role: 'editor',
      invitedBy: ownerId,
    });

    await login(page, invitee);
    await page.goto(`/accept-invitation?token=${encodeURIComponent(invitation.token)}`);
    await expect(page.getByText('Invitation accepted!', { exact: true })).toBeVisible({ timeout: 30000 });

    const { data } = await admin
      .from('project_collaborators')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', invitee.id)
      .single();
    expect(data?.role).toBe('editor');
  });

  test('returns to token acceptance after logged-out authentication', async ({ page }) => {
    const invitee = await createTemporaryUser(admin, 'invite-redirect');
    temporaryUsers.push(invitee);
    const invitation = await createInvitationFixture(admin, {
      projectId,
      recipientEmail: invitee.email,
      role: 'viewer',
      invitedBy: ownerId,
    });

    await page.goto(`/accept-invitation?token=${encodeURIComponent(invitation.token)}`);
    await expect(page).toHaveURL(/\/projects\?redirect=/, { timeout: 30000 });

    const loginPage = new LoginPage(page);
    const acceptanceResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/invitations/accept') &&
        response.request().method() === 'POST',
    );
    await loginPage.login(invitee);
    const acceptanceResponse = await acceptanceResponsePromise;
    expect(acceptanceResponse.ok()).toBe(true);
    await expect(acceptanceResponse.json()).resolves.toMatchObject({ success: true, projectId });
    await expect.poll(async () => {
      const { data } = await admin
        .from('project_collaborators')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', invitee.id)
        .maybeSingle();
      return data?.role ?? null;
    }).toBe('viewer');
  });

  test('declines a token and deletes its invitation', async ({ page }) => {
    const invitation = await createInvitationFixture(admin, {
      projectId,
      recipientEmail: `decline-${crypto.randomUUID()}@mailinator.com`,
      role: 'viewer',
      invitedBy: ownerId,
    });

    await page.goto(`/decline-invitation?token=${encodeURIComponent(invitation.token)}`);
    await expect(page.getByRole('heading', { name: 'Invitation Declined' })).toBeVisible({
      timeout: 30000,
    });
    await expect.poll(() => invitationExists(admin, invitation.id)).toBe(false);
  });
});
