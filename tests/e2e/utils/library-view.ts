import { expect, type Page } from '@playwright/test';

export async function ensureLibraryTableView(page: Page): Promise<void> {
  const tableViewButton = page.getByRole('button', { name: 'Table view', exact: true });
  await expect(tableViewButton).toBeVisible({ timeout: 30000 });

  if ((await tableViewButton.getAttribute('aria-pressed')) !== 'true') {
    await tableViewButton.click();
  }

  await expect(tableViewButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('table').first()).toBeVisible({ timeout: 30000 });
}
