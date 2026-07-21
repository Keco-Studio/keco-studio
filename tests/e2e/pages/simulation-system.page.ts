import { expect, type Locator, type Page } from '@playwright/test';

export class SimulationSystemPage {
  readonly page: Page;
  readonly root: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.locator('[data-simulation-root]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/simulation-system');
    await expect(this.root).toBeVisible({ timeout: 30000 });
    await expect(this.page.getByRole('heading', { name: 'Import Studio libraries' })).toBeVisible();
  }

  async useDemoData(): Promise<void> {
    await this.page.getByLabel('Simulator name').fill('E2E combat simulator');
    await this.page.getByRole('button', { name: 'Use demo data' }).click();
    await expect(this.page.getByRole('button', { name: 'Continue to characters' })).toBeVisible({
      timeout: 30000,
    });
    await this.page.getByRole('button', { name: 'Continue to characters' }).click();
    await expect(this.page.getByRole('heading', { name: 'Configure characters' })).toBeVisible({
      timeout: 30000,
    });
  }

  async importLibraries(names: {
    characters: string;
    skills: string;
    level: string;
    skillCost: string;
  }): Promise<void> {
    await this.page.getByLabel('Characters', { exact: true }).selectOption({ label: names.characters });
    await this.page.getByLabel('Skills', { exact: true }).selectOption({ label: names.skills });
    await this.page.getByLabel('Level curve', { exact: true }).selectOption({ label: names.level });
    await this.page.getByLabel('Skill cost curve', { exact: true }).selectOption({ label: names.skillCost });
    await this.page.getByLabel('Simulator name').fill('E2E combat simulator');
    await expect(this.page.getByRole('button', { name: 'Import libraries' })).toBeEnabled();
    await this.page.getByRole('button', { name: 'Import libraries' }).click();
    await expect(this.page.getByRole('button', { name: 'Continue to characters' })).toBeVisible({
      timeout: 30000,
    });
    await this.page.getByRole('button', { name: 'Continue to characters' }).click();
    await expect(this.page.getByRole('heading', { name: 'Configure characters' })).toBeVisible({
      timeout: 30000,
    });
  }

  async configureTeamsAndSkills(): Promise<void> {
    await this.page.getByRole('button', { name: '+ Add characters' }).click();
    await this.page.getByText('Ignara', { exact: true }).click();
    await this.page.getByText('Bramwell', { exact: true }).click();
    await this.page.keyboard.press('Escape');
    await expect(this.page.getByText('A 1 vs B 1 — ready')).toBeVisible();
    await this.page.getByRole('button', { name: /Confirm.*go to skill/ }).click();

    await expect(this.page.getByRole('heading', { name: 'Config skills' })).toBeVisible();
    await this.page.getByText('Fireball', { exact: true }).click();
    await this.page.getByText('Bramwell', { exact: true }).click();
    await this.page.getByText('Fireball', { exact: true }).click();
    await expect(this.page.getByText('All fighters have skills — ready')).toBeVisible();
    await this.page.getByRole('button', { name: /Continue to Progression/ }).click();

    await this.page.getByRole('button', { name: /Go to Battle/ }).click();
  }

  async startBattleAndExpectRestoration(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Battle', exact: true })).toBeVisible();
    await this.page.getByRole('button', { name: 'Start battle' }).click();
    await expect(this.page.getByRole('button', { name: /Pause|Resume/ })).toBeVisible({ timeout: 30000 });
    await this.page.waitForTimeout(500);
    await this.page.reload();
    await expect(this.root).toBeVisible({ timeout: 30000 });
    await expect(this.page.getByRole('heading', { name: 'Battle', exact: true })).toBeVisible();
    await expect(this.page.getByRole('button', { name: 'Start battle' })).toBeEnabled();
    await expect(this.page.getByText('E2E combat simulator', { exact: true })).toBeVisible();
  }
}
