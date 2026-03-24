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
  const addColumnButton = page.getByRole('button', { name: /add new column/i }).first();
  await expect(addColumnButton).toBeVisible({ timeout: 15000 });

  const addModal = page.getByRole('dialog', { name: /add column/i }).first();
  await addColumnButton.click();
  if (!(await addModal.isVisible({ timeout: 1200 }).catch(() => false))) {
    await addColumnButton.click({ force: true });
  }
  await expect(addModal).toBeVisible({ timeout: 5000 });

  const fillHeaderNameWithRetry = async () => {
    for (let i = 0; i < 4; i += 1) {
      const input = addModal.locator('#add-column-name:visible').first();
      await expect(input).toBeVisible({ timeout: 5000 });
      await input.click();
      await input.fill('');
      await input.type(name, { delay: 20 });
      let current = await input.inputValue();
      if (current === name) return;

      // Controlled input fallback for remount/race cases.
      await input.evaluate((el, v) => {
        const node = el as HTMLInputElement;
        node.value = v;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, name);
      current = await input.inputValue();
      if (current === name) return;
    }
    throw new Error('Failed to persist header name while adding column.');
  };

  await fillHeaderNameWithRetry();
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
  // If transient rerender clears the name right before submit, refill once and retry.
  if (
    await addModal
      .locator('[class*="errorText"]')
      .getByText(/header name is required\./i)
      .isVisible({ timeout: 1200 })
      .catch(() => false)
  ) {
    await fillHeaderNameWithRetry();
    await addModal.getByRole('button', { name: /^add$/i }).click();
  }

  // Success signal: modal closes OR the new header appears in table.
  await expect
    .poll(
      async () => {
        const modalVisible = await addModal.isVisible().catch(() => false);
        if (!modalVisible) return true;
        const headerExists = await page
          .locator('thead tr')
          .last()
          .locator('th[class*="propertyHeaderCell"]')
          .filter({ hasText: name })
          .count();
        return headerExists > 0;
      },
      { timeout: 15000 },
    )
    .toBeTruthy();

  if (await addModal.isVisible({ timeout: 500 }).catch(() => false)) {
    // If still visible here, fail with actionable context.
    const errorText = await addModal.locator('[class*="errorText"]').allInnerTexts().catch(() => []);
    throw new Error(`Add column modal still visible after submit. errors=${errorText.join(' | ')}`);
  }
}

async function getColumnCellByName(page: Page, columnName: string): Promise<Locator> {
  const headerCells = page.locator('thead tr').last().locator('th[class*="propertyHeaderCell"]');
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const expected = normalize(columnName);
  const isHeaderMatch = (current: string, target: string) => {
    // Prefer exact/forward match; only allow reverse contains for sufficiently long headers
    // (avoid false positive on short labels like "id").
    if (current === target) return true;
    if (current.includes(target)) return true;
    if (current.length >= 8 && target.includes(current)) return true;
    return false;
  };

  const findHeaderElementIndex = async (): Promise<number> => {
    const count = await headerCells.count();
    for (let i = 0; i < count; i += 1) {
      const text = (await headerCells.nth(i).innerText()).trim();
      const current = normalize(text);
      // UI may normalize/truncate header display, so compare normalized tokens with safeguards.
      if (isHeaderMatch(current, expected)) return i;
    }
    return -1;
  };

  await expect
    .poll(findHeaderElementIndex, {
      timeout: 15000,
      message: `Cannot find header for column "${columnName}"`,
    })
    .toBeGreaterThanOrEqual(0);

  const headerElementIndex = await findHeaderElementIndex();
  const headerCell = headerCells.nth(headerElementIndex);
  const targetCellIndex = await headerCell.evaluate((el) => (el as HTMLTableCellElement).cellIndex);

  const dataRows = page.locator('tbody tr[data-row-id]');
  if ((await dataRows.count()) === 0) {
    const addRowButton = page.getByRole('button', { name: /add new asset/i }).first();
    if (await addRowButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addRowButton.click();
    }
  }

  const firstDataRow = page.locator('tbody tr[data-row-id]').first();
  await expect(firstDataRow).toBeVisible({ timeout: 10000 });
  const rowCells = firstDataRow.locator('td');
  const cell = rowCells.nth(targetCellIndex);
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

async function expectArrayFormatError(page: Page, cell: Locator): Promise<void> {
  const tooltip = page.locator('.ant-tooltip, .ant-tooltip-inner').filter({ hasText: /array format is incorrect|invalid array format/i });
  const errorDot = cell.locator('div[style*="background-color: rgb(255, 77, 79)"], div[style*="background-color: #ff4d4f"]');

  await expect
    .poll(
      async () => {
        const tooltipVisible = await tooltip.first().isVisible().catch(() => false);
        if (tooltipVisible) return true;

        const hasErrorDot = (await errorDot.count().catch(() => 0)) > 0;
        if (hasErrorDot) return true;

        const hasErrorClass = await cell
          .evaluate((el) => el.className.includes('cellError'))
          .catch(() => false);
        return hasErrorClass;
      },
      { timeout: 8000 },
    )
    .toBeTruthy();
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

    await expectArrayFormatError(page, cell);
  });

  test('Float Array ignores spaces and saves normalized value', async ({ page }) => {
    const column = `Float Array ${Date.now()}`;
    await addColumn(page, column, 'Float Array');

    const cell = await getColumnCellByName(page, column);
    await editCell(page, cell, '[1.5, 2.3, 3.7]');
    await expect(cell).toContainText('[1.5,2.3,3.7]');
  });

  test('String Array without quotes normalizes to JSON string elements', async ({ page }) => {
    const column = `String Array ${Date.now()}`;
    await addColumn(page, column, 'String Array');

    const cell = await getColumnCellByName(page, column);
    await cell.dblclick();
    const editor = cell.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.fill('');
    await editor.type('[Red, Blue]');
    await editor.press('Enter');

    // JSON.parse fails on unquoted tokens; validateValueByType fallback treats comma-separated
    // inner text as plain strings and saves as ["Red","Blue"]. Display uses JSON.stringify per element.
    await expect(cell).toContainText('["Red","Blue"]', { timeout: 10000 });
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

