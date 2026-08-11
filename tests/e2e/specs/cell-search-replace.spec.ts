import { test, expect, type Page, type Locator } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { AssetPage } from '../pages/asset.page';
import { users } from '../fixures/users';

async function loginAsSeedEmpty(page: Page): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(users.seedEmpty);
  await loginPage.expectLoginSuccess();
}

function searchInput(page: Page): Locator {
  return page.getByPlaceholder(/Search for\.\.\.|Find in cell values\.\.\./);
}

function searchDropdown(page: Page): Locator {
  return page.locator('div[class*="searchDropdown"]').first();
}

async function closeCellSearch(page: Page): Promise<void> {
  const clearButton = page.getByRole('button', { name: /clear search/i });
  if (await clearButton.isVisible().catch(() => false)) {
    await clearButton.click();
  }
  await page.keyboard.press('Escape');
  const dropdown = searchDropdown(page);
  await expect(dropdown).not.toBeVisible({ timeout: 5000 }).catch(() => {});
}

async function openCellSearch(page: Page): Promise<{ input: Locator; dropdown: Locator }> {
  const input = searchInput(page);
  await expect(input).toBeVisible({ timeout: 15000 });
  await input.click();
  const dropdown = searchDropdown(page);
  await expect(dropdown).toBeVisible({ timeout: 5000 });

  const placeholder = (await input.getAttribute('placeholder')) ?? '';
  if (!/find in cell values/i.test(placeholder)) {
    const tableCellsTab = dropdown.getByRole('button', { name: /only search cell content/i });
    await expect(tableCellsTab).toBeVisible({ timeout: 5000 });
    await tableCellsTab.click();
    await expect(input).toHaveAttribute('placeholder', /find in cell values/i, { timeout: 5000 });
  }

  return { input, dropdown };
}

async function runCellSearch(page: Page, keyword: string): Promise<void> {
  const { input } = await openCellSearch(page);
  await input.fill(keyword);
  await expect(searchDropdown(page)).toBeVisible({ timeout: 10000 });
  await expect
    .poll(
      async () => {
        const loading = page.getByText('Searching...');
        if (await loading.isVisible().catch(() => false)) return false;
        const hits = searchDropdown(page).locator('button[class*="cellSearchHitMain"]');
        const noMatches = page.getByText('No matches.');
        return (await hits.count()) > 0 || (await noMatches.isVisible().catch(() => false));
      },
      { timeout: 20000 },
    )
    .toBeTruthy();
}

async function setReplaceText(page: Page, text: string): Promise<void> {
  const replaceInput = searchDropdown(page).getByPlaceholder('Replacement text');
  await expect(replaceInput).toBeVisible({ timeout: 5000 });
  await replaceInput.fill(text);
}

async function confirmReplaceModal(page: Page): Promise<void> {
  const modal = page.getByRole('dialog').filter({ hasText: /replace/i });
  await expect(modal).toBeVisible({ timeout: 15000 });
  await expect(modal.getByText(/cell\(s\) will be updated/i)).toBeVisible({ timeout: 30000 });

  const confirmButton = modal.getByRole('button', { name: /confirm replace/i });
  await expect(confirmButton).toBeEnabled({ timeout: 30000 });
  await confirmButton.click();
  await expect(modal).not.toBeVisible({ timeout: 30000 });
}

async function waitForTableReady(page: Page): Promise<void> {
  await expect(page.locator('table')).toBeVisible({ timeout: 30000 });
  const dataRowCount = await page.locator('tbody tr[data-row-id]').count();
  if (dataRowCount === 0) {
    await expect(page.getByRole('button', { name: /add new asset/i }).first()).toBeVisible({
      timeout: 30000,
    });
  } else {
    await expect(page.locator('tbody tr[data-row-id]').first()).toBeVisible({ timeout: 30000 });
  }
}

async function countTableCellsContaining(page: Page, text: string): Promise<number> {
  return page.locator('tbody td').filter({ hasText: text }).count();
}

async function resolveColumnCellIndex(page: Page, columnName: string): Promise<number> {
  const headerCells = page.locator('thead tr').last().locator('th[class*="propertyHeaderCell"]');
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const expected = normalize(columnName);

  const findHeaderElementIndex = async (): Promise<number> => {
    const count = await headerCells.count();
    for (let i = 0; i < count; i += 1) {
      const text = (await headerCells.nth(i).innerText()).trim();
      const current = normalize(text);
      if (current === expected || current.includes(expected)) return i;
    }
    return -1;
  };

  await expect
    .poll(findHeaderElementIndex, {
      timeout: 15000,
      message: `Cannot find header for column "${columnName}"`,
    })
    .toBeGreaterThanOrEqual(0);

  const headerIndex = await findHeaderElementIndex();
  const headerCell = headerCells.nth(headerIndex);
  return headerCell.evaluate((el) => (el as HTMLTableCellElement).cellIndex);
}

async function getTableCellForRowAndColumn(
  page: Page,
  rowLabel: string,
  columnName: string,
): Promise<Locator> {
  const cellIndex = await resolveColumnCellIndex(page, columnName);

  await expect
    .poll(async () => page.locator('tbody tr[data-row-id]').count(), { timeout: 30000 })
    .toBeGreaterThan(0);

  let row = page.locator('tbody tr[data-row-id]').filter({ hasText: rowLabel }).first();
  if ((await row.count()) === 0) {
    // Name may render in a nested cell; fall back when this library has a single asset row.
    row = page.locator('tbody tr[data-row-id]').first();
  }
  await expect(row).toBeVisible({ timeout: 15000 });

  const cell = row.locator('td').nth(cellIndex);
  await expect(cell).toBeVisible({ timeout: 5000 });
  return cell;
}

async function addReferenceColumn(
  page: Page,
  columnName: string,
  targetLibraryName: string,
): Promise<void> {
  const addColumnButton = page.getByRole('button', { name: /add new column/i }).first();
  await expect(addColumnButton).toBeVisible({ timeout: 15000 });
  await addColumnButton.click();

  const addModal = page
    .locator('[class*="popup"]')
    .filter({ has: page.getByRole('heading', { name: /add column/i }) })
    .first();
  await expect(addModal).toBeVisible({ timeout: 5000 });

  await addModal.locator('#add-column-name').fill(columnName);
  await addModal.locator('#add-column-type').click();

  const dropdown = page.locator('[class*="dataTypeDropdown"]').last();
  const typeSearch = dropdown.locator('input[placeholder="Search"]').first();
  await expect(typeSearch).toBeVisible({ timeout: 5000 });
  await typeSearch.fill('Reference');

  await page
    .locator('.ant-select-item-option')
    .filter({ hasText: /^reference$/i })
    .first()
    .click();

  const refSelect = addModal.locator('[class*="referenceSelect"]').first();
  await refSelect.click();

  const refDropdown = page.locator('[class*="referenceDropdown"]').last();
  await expect(refDropdown).toBeVisible({ timeout: 10000 });
  await expect(refDropdown.getByText(/loading libraries/i)).not.toBeVisible({ timeout: 15000 });

  await refDropdown.locator('[class*="referenceSearchInput"] input').fill(targetLibraryName);

  const libraryRow = refDropdown
    .locator('[class*="referenceOptionRow"]')
    .filter({ hasText: targetLibraryName })
    .first();
  await expect(libraryRow).toBeVisible({ timeout: 10000 });
  await libraryRow.locator('input[type="checkbox"]').click();
  await refSelect.click();

  await addModal.getByRole('button', { name: /^add$/i }).click();
  await expect(addModal).not.toBeVisible({ timeout: 10000 });
}

async function openReferenceModalOnCell(
  page: Page,
  rowLabel: string,
  refColumnName: string,
): Promise<Locator> {
  await expect(page.locator('thead').getByText(refColumnName, { exact: true })).toBeVisible({
    timeout: 15000,
  });

  const refCell = await getTableCellForRowAndColumn(page, rowLabel, refColumnName);
  await refCell.scrollIntoViewIfNeeded();
  // ReferenceField opens only when selectedCells has this cell. Clicking also
  // calls onCellFocus, so presence may paint cellEditing and hide cellSelected —
  // do not assert on CSS class.
  await refCell.click({ position: { x: 8, y: 8 } });

  const refField = refCell.locator('[class*="referenceFieldWrapper"]').first();
  await expect(refField).toBeVisible({ timeout: 15000 });

  // Prefer the arrow tile. Pills use data-reference-background and open the hover
  // card (stopPropagation) — clicking .first() on a combined locator never opens the modal.
  const arrow = refField.locator('[class*="referenceArrowTile"]').last();
  await expect(arrow).toBeVisible({ timeout: 15000 });
  await arrow.click({ force: true });

  const modal = page
    .locator('[class*="modalContainer"], [class*="dropdown"]')
    .filter({ hasText: 'APPLY REFERENCE' })
    .first();
  if (!(await modal.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape').catch(() => {});
    await refCell.click({ position: { x: 8, y: 8 } });
    const valueList = refField.locator('[class*="referenceValueList"]').first();
    if ((await valueList.count()) > 0) {
      await valueList.click({ position: { x: 4, y: 4 }, force: true });
    } else {
      await arrow.click({ force: true });
    }
  }
  await expect(modal).toBeVisible({ timeout: 15000 });
  return modal;
}

async function configureReferenceModalPicker(
  modal: Locator,
  page: Page,
  sourceLibraryName: string,
  notesColumnName: string,
): Promise<void> {
  await modal.locator('.ant-select').first().click();
  await page
    .locator('.ant-select-item-option')
    .filter({ hasText: sourceLibraryName })
    .first()
    .click();

  await modal.locator('.ant-select').nth(1).click();
  await page
    .locator('.ant-select-item-option')
    .filter({ hasText: notesColumnName })
    .first()
    .click();
  await page.waitForTimeout(500);
}

async function assertReferenceModalListShows(
  modal: Locator,
  page: Page,
  snippet: string,
): Promise<void> {
  await modal.getByPlaceholder('Search').fill(snippet);
  await page.waitForTimeout(800);
  await modal.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(
    modal.locator('[class*="assetListRow"]').filter({ hasText: snippet }).first(),
  ).toBeVisible({ timeout: 15000 });
}

async function linkReferenceToSourceCell(
  page: Page,
  consumerRowLabel: string,
  refColumnName: string,
  sourceLibraryName: string,
  notesColumnName: string,
  sourceValueSnippet: string,
): Promise<void> {
  const modal = await openReferenceModalOnCell(page, consumerRowLabel, refColumnName);

  await configureReferenceModalPicker(modal, page, sourceLibraryName, notesColumnName);
  await assertReferenceModalListShows(modal, page, sourceValueSnippet);

  const sourceAssetRow = modal
    .locator('[class*="assetListRow"]')
    .filter({ hasText: sourceValueSnippet })
    .first();
  await sourceAssetRow.click();

  await modal.getByRole('button', { name: /^apply$/i }).click();
  await expect(modal).not.toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1000);
}

type ReplaceFixture = {
  findToken: string;
  replaceToken: string;
  columnName: string;
  libraryName: string;
};

async function openLibraryTable(page: Page, libraryName: string): Promise<void> {
  await closeCellSearch(page);

  const sidebarLibraryItem = page
    .getByRole('treeitem')
    .filter({ has: page.locator(`[title="${libraryName}"]`) })
    .first();
  await expect(sidebarLibraryItem).toBeVisible({ timeout: 15000 });
  await sidebarLibraryItem.scrollIntoViewIfNeeded();
  await sidebarLibraryItem.click();

  // Sidebar click can be ignored while search UI is still focused; wait for breadcrumb to update.
  const libraryBreadcrumb = page
    .getByRole('banner')
    .getByRole('button')
    .filter({ hasText: libraryName.slice(0, Math.min(24, libraryName.length)) });
  await expect(libraryBreadcrumb).toBeVisible({ timeout: 20000 });

  await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
  await waitForTableReady(page);
}

async function createReplaceFixture(page: Page): Promise<ReplaceFixture> {
  const stamp = Date.now();
  const findToken = `find${stamp}`;
  const replaceToken = `replaced${stamp}`;
  const columnName = 'Notes';

  const projectPage = new ProjectPage(page);
  const libraryPage = new LibraryPage(page);
  const projectName = `CSR Project ${stamp}`;
  const libraryName = `CSR Library ${stamp}`;

  await projectPage.createProject({ name: projectName, description: `cell-replace-${stamp}` });
  await projectPage.expectProjectCreated();
  await libraryPage.waitForPageLoad();

  await libraryPage.createLibraryUnderProject({ name: libraryName });
  await libraryPage.expectLibraryCreated();

  const sidebarLibraryItem = page.locator('aside').locator(`[title="${libraryName}"]`).first();
  await expect(sidebarLibraryItem).toBeVisible({ timeout: 15000 });
  await sidebarLibraryItem.click();
  await libraryPage.waitForPageLoad();

  await libraryPage.addColumnFromTableSchemaEntry(libraryName, columnName, 'String');
  await page.waitForTimeout(1500);
  await waitForTableReady(page);

  return { findToken, replaceToken, columnName, libraryName };
}

async function createAssetWithNotes(
  page: Page,
  assetName: string,
  notesValue: string,
  columnName: string,
): Promise<void> {
  const assetPage = new AssetPage(page);
  await assetPage.createAsset('Breed Template', {
    name: assetName,
    fields: [{ label: columnName, value: notesValue }],
  });
  await assetPage.expectAssetCreated();
}

test.describe('Table cell search and replace', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);

  test('Replace single: updates one cell and leaves other matches unchanged', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const { findToken, replaceToken, columnName, libraryName } = await createReplaceFixture(page);
    const stamp = Date.now();

    await createAssetWithNotes(
      page,
      `CSR Asset A ${stamp}`,
      `Alpha ${findToken} value`,
      columnName,
    );
    await createAssetWithNotes(
      page,
      `CSR Asset B ${stamp}`,
      `Beta ${findToken} value`,
      columnName,
    );

    await openLibraryTable(page, libraryName);
    await expect.poll(() => countTableCellsContaining(page, findToken)).toBe(2);

    await runCellSearch(page, findToken);
    await setReplaceText(page, replaceToken);

    const firstHitReplace = searchDropdown(page).locator('button[class*="cellReplaceOneButton"]').first();
    await expect(firstHitReplace).toBeVisible({ timeout: 10000 });
    await firstHitReplace.click();

    const modal = page.getByRole('dialog').filter({ hasText: /replace cell value/i });
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal).toContainText(findToken);
    await expect(modal).toContainText(replaceToken);
    await confirmReplaceModal(page);

    await openLibraryTable(page, libraryName);
    await expect.poll(() => countTableCellsContaining(page, replaceToken), { timeout: 30000 }).toBe(1);
    await expect.poll(() => countTableCellsContaining(page, findToken), { timeout: 30000 }).toBe(1);

    await runCellSearch(page, findToken);
    const hitsAfter = searchDropdown(page).locator('button[class*="cellSearchHitMain"]');
    await expect(hitsAfter).toHaveCount(1, { timeout: 10000 });
  });

  test('Replace all: updates every matching cell', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const { findToken, replaceToken, columnName, libraryName } = await createReplaceFixture(page);
    const stamp = Date.now();

    await createAssetWithNotes(
      page,
      `CSR All A ${stamp}`,
      `Row one ${findToken}`,
      columnName,
    );
    await createAssetWithNotes(
      page,
      `CSR All B ${stamp}`,
      `Row two ${findToken}`,
      columnName,
    );

    await openLibraryTable(page, libraryName);
    await expect.poll(() => countTableCellsContaining(page, findToken)).toBe(2);

    await runCellSearch(page, findToken);
    await setReplaceText(page, replaceToken);

    const replaceAllButton = searchDropdown(page).getByRole('button', {
      name: new RegExp(`replace all \\(${2}\\)`, 'i'),
    });
    await expect(replaceAllButton).toBeVisible({ timeout: 10000 });
    await replaceAllButton.click();

    const modal = page.getByRole('dialog').filter({ hasText: /replace all matching cells/i });
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal.getByText(/2 cell\(s\) will be updated/i)).toBeVisible({ timeout: 30000 });
    await confirmReplaceModal(page);

    await openLibraryTable(page, libraryName);
    await expect.poll(() => countTableCellsContaining(page, findToken), { timeout: 30000 }).toBe(0);
    await expect.poll(() => countTableCellsContaining(page, replaceToken), { timeout: 30000 }).toBe(2);

    await runCellSearch(page, findToken);
    await expect(searchDropdown(page).getByText('No matches.')).toBeVisible({ timeout: 10000 });
  });

  test('Replace all: reference displayValue syncs when source cell text changes', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const findToken = `reffind${stamp}`;
    const replaceToken = `refreplaced${stamp}`;
    const notesColumn = 'Notes';
    const refColumn = 'SourceRef';
    const sourceValueText = `Source ${findToken} text`;
    const sourceAssetName = `CSR Source ${stamp}`;
    const consumerAssetName = `CSR Consumer ${stamp}`;

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);
    const sourceLibraryName = `CSR Source Lib ${stamp}`;
    const consumerLibraryName = `CSR Consumer Lib ${stamp}`;

    await projectPage.createProject({
      name: `CSR Ref Project ${stamp}`,
      description: `cell-replace-ref-${stamp}`,
    });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    await libraryPage.createLibraryUnderProject({ name: sourceLibraryName });
    await libraryPage.expectLibraryCreated();

    await openLibraryTable(page, sourceLibraryName);
    await libraryPage.addColumnFromTableSchemaEntry(sourceLibraryName, notesColumn, 'String');
    await page.waitForTimeout(1500);
    await createAssetWithNotes(page, sourceAssetName, sourceValueText, notesColumn);

    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await libraryPage.createLibraryUnderProject({ name: consumerLibraryName });
    await libraryPage.expectLibraryCreated();

    await openLibraryTable(page, consumerLibraryName);
    await addReferenceColumn(page, refColumn, sourceLibraryName);
    await page.waitForTimeout(1500);
    await waitForTableReady(page);

    const consumerAssetPage = new AssetPage(page);
    await consumerAssetPage.createAsset('Breed Template', {
      name: consumerAssetName,
      fields: [],
    });
    await consumerAssetPage.expectAssetCreated();

    await openLibraryTable(page, consumerLibraryName);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    await linkReferenceToSourceCell(
      page,
      consumerAssetName,
      refColumn,
      sourceLibraryName,
      notesColumn,
      findToken,
    );

    await runCellSearch(page, findToken);
    await setReplaceText(page, replaceToken);

    const replaceAllButton = searchDropdown(page).getByRole('button', {
      name: /replace all \(\d+\)/i,
    });
    await expect(replaceAllButton).toBeVisible({ timeout: 10000 });
    await replaceAllButton.click();
    await confirmReplaceModal(page);

    await openLibraryTable(page, sourceLibraryName);
    await expect.poll(() => countTableCellsContaining(page, findToken), { timeout: 30000 }).toBe(0);
    await expect.poll(() => countTableCellsContaining(page, replaceToken), { timeout: 30000 }).toBeGreaterThan(0);

    await openLibraryTable(page, consumerLibraryName);
    const modalAfterReplace = await openReferenceModalOnCell(page, consumerAssetName, refColumn);
    await configureReferenceModalPicker(modalAfterReplace, page, sourceLibraryName, notesColumn);
    await assertReferenceModalListShows(modalAfterReplace, page, replaceToken);
    await expect(
      modalAfterReplace.locator('[class*="assetListRow"]').filter({ hasText: findToken }),
    ).toHaveCount(0);
    await modalAfterReplace.getByRole('button', { name: /^cancel$/i }).click();
  });
});
