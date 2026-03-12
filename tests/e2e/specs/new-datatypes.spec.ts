import { test, expect, type Page, type Locator } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { users } from '../fixures/users';
import { generateProjectData } from '../fixures/projects';
import { generateLibraryData } from '../fixures/libraries';

async function login(page: Page): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(users.seedEmpty);
  await loginPage.expectLoginSuccess();
}

async function createLibraryForDatatypeTests(page: Page): Promise<void> {
  const projectPage = new ProjectPage(page);
  const libraryPage = new LibraryPage(page);
  const project = generateProjectData();
  const library = generateLibraryData();

  await projectPage.createProject(project);
  await projectPage.expectProjectCreated();
  await libraryPage.waitForPageLoad();

  await libraryPage.createLibraryUnderProject(library);
  await libraryPage.expectLibraryCreated();

  const sidebarTree = page.getByRole('tree');
  const sidebarLibraryItem = sidebarTree.locator(`[title="${library.name}"]`).first();
  await expect(sidebarLibraryItem).toBeVisible({ timeout: 15000 });
  await sidebarLibraryItem.click();
  await libraryPage.waitForPageLoad();
}

async function addColumn(page: Page, name: string, dataTypeLabel: string): Promise<void> {
  const addColumnButton = page.getByRole('button', { name: /add new column/i });
  await expect(addColumnButton).toBeVisible({ timeout: 15000 });
  await addColumnButton.click();

  const addModal = page
    .locator('[class*="popup"]')
    .filter({ has: page.getByRole('heading', { name: /add column/i }) })
    .first();
  await expect(addModal).toBeVisible({ timeout: 5000 });

  await addModal.locator('#add-column-name').fill(name);
  await addModal.locator('#add-column-type').click();

  // Use dropdown search for stable option selection (some options may be outside initial viewport).
  const dropdown = page.locator('[class*="dataTypeDropdown"]').last();
  const searchInput = dropdown.locator('input[placeholder="Search"]').first();
  await expect(searchInput).toBeVisible({ timeout: 5000 });
  await searchInput.fill(dataTypeLabel);

  const option = page
    .locator('.ant-select-item-option')
    .filter({ hasText: new RegExp(dataTypeLabel, 'i') })
    .first();
  await expect(option).toBeVisible({ timeout: 10000 });
  await option.click();

  await addModal.getByRole('button', { name: /^add$/i }).click();
  await expect(addModal).not.toBeVisible({ timeout: 10000 });
}

async function getColumnCellByName(page: Page, columnName: string): Promise<Locator> {
  const headerCells = page.locator('thead tr').last().locator('th[class*="propertyHeaderCell"]');
  const count = await headerCells.count();
  let targetIndex = -1;

  for (let i = 0; i < count; i += 1) {
    const text = (await headerCells.nth(i).innerText()).trim();
    if (text.includes(columnName)) {
      targetIndex = i;
      break;
    }
  }

  expect(targetIndex, `Cannot find header for column "${columnName}"`).toBeGreaterThanOrEqual(0);

  const firstDataRow = page.locator('tbody tr[data-row-id]').first();
  await expect(firstDataRow).toBeVisible({ timeout: 10000 });
  const cell = firstDataRow.locator('td[class*="cell"]').nth(targetIndex);
  await expect(cell).toBeVisible({ timeout: 5000 });
  return cell;
}

async function editCell(page: Page, cell: Locator, value: string): Promise<void> {
  await cell.dblclick();
  const editor = cell.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible({ timeout: 5000 });
  await editor.fill('');
  await editor.type(value);
  await editor.press('Enter');
}

test.describe('New data types (array/audio/video)', () => {
  // This suite has heavy setup in each test (login + create project + create library + table init).
  // Run serially and with a longer timeout to avoid hook timeouts in local headed mode.
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180000);

  test.beforeEach(async ({ page }) => {
    await login(page);
    await createLibraryForDatatypeTests(page);
  });

  test('Int Array valid input displays normalized array', async ({ page }) => {
    const column = `Int Array ${Date.now()}`;
    await addColumn(page, column, 'Int Array');

    const cell = await getColumnCellByName(page, column);
    await editCell(page, cell, '[1,2,3]');
    await expect(cell).toContainText('[1,2,3]');
  });

  test('Int Array invalid format shows error prompt', async ({ page }) => {
    const column = `Int Array Invalid ${Date.now()}`;
    await addColumn(page, column, 'Int Array');

    const cell = await getColumnCellByName(page, column);
    await cell.dblclick();
    const editor = cell.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.fill('');
    await editor.type('[1,,3]');
    await editor.press('Enter');

    await expect(page.locator('.ant-tooltip-inner').filter({ hasText: /array format is incorrect/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('Float Array ignores spaces and saves normalized value', async ({ page }) => {
    const column = `Float Array ${Date.now()}`;
    await addColumn(page, column, 'Float Array');

    const cell = await getColumnCellByName(page, column);
    await editCell(page, cell, '[1.5, 2.3, 3.7]');
    await expect(cell).toContainText('[1.5,2.3,3.7]');
  });

  test('String Array without quotes shows format error', async ({ page }) => {
    const column = `String Array ${Date.now()}`;
    await addColumn(page, column, 'String Array');

    const cell = await getColumnCellByName(page, column);
    await cell.dblclick();
    const editor = cell.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.fill('');
    await editor.type('[Red, Blue]');
    await editor.press('Enter');

    await expect(page.locator('.ant-tooltip-inner').filter({ hasText: /array format|invalid array format/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('Int Array auto-wraps with brackets when typing comma-separated values', async ({ page }) => {
    const column = `Int Array Wrap ${Date.now()}`;
    await addColumn(page, column, 'Int Array');

    const cell = await getColumnCellByName(page, column);
    await editCell(page, cell, '1,2,3');
    await expect(cell).toContainText('[1,2,3]');
  });

  test('Audio file upload and preview open', async ({ page }) => {
    const column = `Audio ${Date.now()}`;
    await addColumn(page, column, 'Audio');

    const cell = await getColumnCellByName(page, column);
    await cell.click();

    const fileInput = cell.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5000 });
    await fileInput.setInputFiles({
      name: 'sample.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x21', 'binary'),
    });

    await expect(cell).toContainText('sample.mp3', { timeout: 30000 });

    // Assert preview behavior by verifying window.open is called (more stable than popup event).
    await page.evaluate(() => {
      (window as unknown as { __openedUrls?: string[] }).__openedUrls = [];
      const originalOpen = window.open.bind(window);
      window.open = ((...args: Parameters<typeof window.open>) => {
        const url = typeof args[0] === 'string' ? args[0] : '';
        (window as unknown as { __openedUrls?: string[] }).__openedUrls?.push(url);
        return originalOpen(...args);
      }) as typeof window.open;
    });

    await cell.locator('[class*="fileInfoClickable"]').click();
    await expect
      .poll(
        async () =>
          page.evaluate(
            () => (window as unknown as { __openedUrls?: string[] }).__openedUrls?.length ?? 0,
          ),
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);
  });

  test('Video file upload and preview open', async ({ page }) => {
    const column = `Video ${Date.now()}`;
    await addColumn(page, column, 'Multimedia');

    const cell = await getColumnCellByName(page, column);
    await cell.click();

    const fileInput = cell.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5000 });
    await fileInput.setInputFiles({
      name: 'sample.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('00000018667479706d70343200000000', 'hex'),
    });

    await expect(cell).toContainText('sample.mp4', { timeout: 30000 });

    // Assert preview behavior by verifying window.open is called (more stable than popup event).
    await page.evaluate(() => {
      (window as unknown as { __openedUrls?: string[] }).__openedUrls = [];
      const originalOpen = window.open.bind(window);
      window.open = ((...args: Parameters<typeof window.open>) => {
        const url = typeof args[0] === 'string' ? args[0] : '';
        (window as unknown as { __openedUrls?: string[] }).__openedUrls?.push(url);
        return originalOpen(...args);
      }) as typeof window.open;
    });

    await cell.locator('[class*="fileInfoClickable"]').click();
    await expect
      .poll(
        async () =>
          page.evaluate(
            () => (window as unknown as { __openedUrls?: string[] }).__openedUrls?.length ?? 0,
          ),
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);
  });
});

