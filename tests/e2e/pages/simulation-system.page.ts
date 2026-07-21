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
    await expect(this.page.getByRole('heading', { name: 'Configure characters' })).toBeVisible({ timeout: 30000 });
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
    await expect(this.page.getByRole('button', { name: 'Import Studio data' })).toBeEnabled();
    await this.page.getByRole('button', { name: 'Import Studio data' }).click();
    await expect(this.page.getByRole('heading', { name: 'Configure characters' })).toBeVisible({ timeout: 30000 });
  }

  async configureTeamsAndSkills(): Promise<void> {
    await this.page.getByRole('button', { name: /Ignara/ }).click();
    await this.page.getByRole('button', { name: /Bramwell/ }).click();
    await expect(this.page.getByText('Team A: 1 · Team B: 1')).toBeVisible();
    await this.page.getByRole('button', { name: 'Continue to skills' }).click();

    await this.page.getByRole('button', { name: /Fireball/ }).click();
    await this.page.getByRole('navigation', { name: 'Fighters' }).getByRole('button', { name: /Bramwell/ }).click();
    await this.page.getByRole('button', { name: /Fireball/ }).click();
    await expect(this.page.getByText('Every fighter has a loadout.')).toBeVisible();
    await this.page.getByRole('button', { name: 'Continue to progression' }).click();
    await this.page.getByRole('button', { name: 'Open battle' }).click();
  }

  async startBattleAndExpectRestoration(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Battle', exact: true })).toBeVisible();
    await this.page.getByRole('button', { name: 'Start battle' }).click();
    await expect(this.page.getByText(/Fighting/)).toBeVisible();
    await this.page.waitForTimeout(500);
    await this.page.reload();
    await expect(this.root).toBeVisible({ timeout: 30000 });
    await expect(this.page.getByRole('heading', { name: 'Battle', exact: true })).toBeVisible();
    await expect(this.page.getByRole('button', { name: 'Start battle' })).toBeEnabled();
    await expect(this.page.getByText('E2E combat simulator', { exact: true })).toBeVisible();
  }
}
