import { expect, type Locator, type Page } from '@playwright/test';
import { autoMapFields } from '@/lib/simulation/data';
import type { LibraryRole, StudioColumnDefinition } from '@/lib/simulation/types';

export class SimulationSystemPage {
  readonly page: Page;
  readonly root: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.locator('[data-simulation-root]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/simulation-system', { waitUntil: 'domcontentloaded' });
    await expect(this.root).toBeVisible({ timeout: 30000 });
    await expect(this.page.getByRole('heading', { name: 'Import Studio libraries' })).toBeVisible();
  }

  async mockAiFieldMapping(): Promise<void> {
    await this.page.route('**/api/simulation/field-mapping', async (route) => {
      const body = route.request().postDataJSON() as {
        role?: LibraryRole;
        columns?: StudioColumnDefinition[];
      };
      const role = body.role;
      const columns = (body.columns ?? []).filter(
        (column): column is StudioColumnDefinition =>
          typeof column?.id === 'string' && typeof column?.label === 'string',
      );
      const mappings = role ? autoMapFields(role, {}, columns) : {};
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mappings }),
      });
    });
  }

  async importLibraries(names: {
    characters: string;
    skills: string;
    level: string;
    skillCost: string;
  }): Promise<void> {
    await this.selectLibrary('Characters', names.characters);
    await this.selectLibrary('Skills', names.skills);
    await this.selectLibrary('Character curve', names.level);
    await this.selectLibrary('Skill curve', names.skillCost);
    await this.page.getByLabel('Simulator name').fill('E2E combat simulator');
    await expect(this.page.getByRole('button', { name: 'Import libraries' })).toBeEnabled({
      timeout: 30000,
    });
    await this.page.getByRole('button', { name: 'Import libraries' }).click();
    await expect(this.page.getByRole('button', { name: 'Continue to characters' })).toBeVisible({
      timeout: 30000,
    });
    await this.page.getByRole('button', { name: 'Continue to characters' }).click();
    await expect(this.page.getByRole('heading', { name: 'Configure characters' })).toBeVisible({
      timeout: 30000,
    });
  }

  async selectLibrary(slotLabel: string, libraryName: string): Promise<void> {
    await this.page.getByText(slotLabel, { exact: true }).first().click();
    const option = this.page.getByText(libraryName, { exact: true });
    await expect(option).toBeVisible({ timeout: 30000 });
    await option.click();
  }

  async configureTeamsAndSkills(): Promise<void> {
    await this.page.getByRole('button', { name: /Add characters/ }).click();
    const picker = this.page.locator('input[placeholder="Search characters…"]').locator('..');
    await picker.getByText('Ignara', { exact: true }).click();
    await picker.getByText('Bramwell', { exact: true }).click();
    await this.page.keyboard.press('Escape');
    await expect(this.page.getByText(/A 1 vs B 1/)).toBeVisible();
    await this.page.getByRole('button', { name: /Confirm.*go to skill/i }).click();

    await expect(this.page.getByRole('heading', { name: 'Configure skills' })).toBeVisible();
    await this.page.getByText('Fireball', { exact: true }).click();
    await this.page.getByText('Bramwell', { exact: true }).click();
    await this.page.getByText('Fireball', { exact: true }).click();
    await expect(this.page.getByText(/All fighters have skills/)).toBeVisible();
    await this.page.getByRole('button', { name: /Continue to Progression/ }).click();

    await this.page.getByRole('button', { name: /Go to Battle/ }).click();
  }

  async startBattleAndExpectRestoration(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Battle', exact: true })).toBeVisible();
    await expect(this.page.getByRole('button', { name: 'Start battle' })).toBeEnabled();
    await this.page.getByRole('button', { name: 'Start battle' }).click();
    // Design presentation hides Pause/Resume; assert the Studio battle chrome instead.
    await expect(this.page.getByRole('button', { name: 'Stop battle' })).toBeVisible({ timeout: 30000 });
    await expect(this.page.getByText('Battle logs')).toBeVisible();
    await this.page.waitForTimeout(1000);
    await this.page.reload();
    await expect(this.root).toBeVisible({ timeout: 30000 });
    await expect(this.page.getByText('E2E combat simulator', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(this.page.getByRole('heading', { name: 'Battle', exact: true })).toBeVisible();
    await expect(this.page.getByRole('button', { name: 'Start battle' })).toBeEnabled();
  }
}
