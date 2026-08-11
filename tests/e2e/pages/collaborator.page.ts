import { expect, type Locator, type Page } from '@playwright/test';

export class CollaboratorPage {
  constructor(readonly page: Page) {}

  async goto(projectId: string): Promise<void> {
    await this.page.goto(`/${projectId}/admin/collaborators`);
    await expect(this.page.getByTestId('admin-collaborators-page')).toBeVisible({
      timeout: 30000,
    });
    // Settled page: invite UI for roles that can invite, or a permission message otherwise.
    await expect(
      this.page
        .getByRole('heading', { name: 'Collaborators' })
        .or(this.page.getByText(/do not have permission to invite collaborators/i))
        .or(this.page.getByText('Only project admins can manage collaborators.'))
    ).toBeVisible({ timeout: 30000 });
  }

  async openInvite(): Promise<void> {
    const inviteButton = this.page.getByTestId('collaborators-invite-button');
    await expect(inviteButton).toBeVisible({ timeout: 15000 });
    await inviteButton.click();
    await expect(this.page.getByTestId('invite-collaborator-modal')).toBeVisible();
  }

  async fillInviteEmail(email: string): Promise<void> {
    await this.page.getByTestId('invite-email-input').fill(email);
  }

  async openInviteRoleOptions(): Promise<void> {
    await this.page.getByTestId('invite-role-select').click();
  }

  async selectInviteRole(role: 'Admin' | 'Editor' | 'Viewer'): Promise<void> {
    await this.openInviteRoleOptions();
    await this.page
      .locator('.ant-select-item-option:visible')
      .filter({ hasText: role })
      .click();
  }

  async submitInvite(): Promise<void> {
    await this.page.getByTestId('invite-submit-button').click();
  }

  collaboratorRow(email: string): Locator {
    return this.page
      .getByTestId('collaborator-row')
      .filter({ has: this.page.getByText(email, { exact: true }) });
  }

  async changeRole(email: string, role: 'admin' | 'editor' | 'viewer'): Promise<void> {
    const row = this.collaboratorRow(email);
    await row.getByTestId('collaborator-role-button').click();
    await this.page.getByTestId(`collaborator-role-option-${role}`).click();
  }

  async remove(email: string): Promise<void> {
    const row = this.collaboratorRow(email);
    await row.hover();
    const removeButton = row.getByTestId('collaborator-remove-button');
    await expect(removeButton).toBeVisible({ timeout: 5000 });
    await removeButton.click();
    await this.page.getByRole('button', { name: 'Remove', exact: true }).click();
  }

  async expectError(message: string | RegExp): Promise<void> {
    await expect(this.page.getByTestId('collaborators-error')).toContainText(message);
  }
}
