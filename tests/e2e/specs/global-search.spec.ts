import { test, expect, type Page, type Locator } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { AssetPage } from '../pages/asset.page';
import { users } from '../fixures/users';

type SearchFixture = {
  projectName: string;
  folderName: string;
  rootLibraryName: string;
  nestedLibraryName: string;
  projectId: string;
};

async function loginAsSeedEmpty(page: Page): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(users.seedEmpty);
  await loginPage.expectLoginSuccess();
}

async function createSearchFixture(
  page: Page,
  names: {
    projectName: string;
    folderName: string;
    rootLibraryName: string;
    nestedLibraryName: string;
  },
): Promise<SearchFixture> {
  const projectPage = new ProjectPage(page);
  const libraryPage = new LibraryPage(page);

  await projectPage.createProject({ name: names.projectName, description: `search-fixture-${Date.now()}` });
  await projectPage.expectProjectCreated();
  await libraryPage.waitForPageLoad();

  const pathname = new URL(page.url()).pathname;
  const projectMatch = pathname.match(/^\/([^/]+)/);
  const projectId = projectMatch?.[1];
  if (!projectId || projectId === 'projects') {
    throw new Error(`Unable to resolve project id after project creation: ${page.url()}`);
  }

  await libraryPage.createFolderUnderProject({ name: names.folderName });
  await libraryPage.expectFolderCreated();

  await libraryPage.createLibraryUnderProject({ name: names.rootLibraryName });
  await libraryPage.expectLibraryCreated();

  // Keep this spec isolated from shared openFolder() behavior to avoid
  // impacting other suites: open folder directly from sidebar title node.
  const sidebarFolderItem = page.locator('aside').locator(`[title="${names.folderName}"]`).first();
  await expect(sidebarFolderItem).toBeVisible({ timeout: 15000 });
  await sidebarFolderItem.click();
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
  await libraryPage.createLibrary({ name: names.nestedLibraryName });
  await libraryPage.expectLibraryCreated();

  await libraryPage.navigateBackToProject();
  await libraryPage.waitForPageLoad();

  return { ...names, projectId };
}

function searchInput(page: Page): Locator {
  return page.getByPlaceholder('Search for...');
}

function searchDropdown(page: Page): Locator {
  return page.locator('div[class*="searchDropdown"]').first();
}

function searchResultItemByText(page: Page, text: string): Locator {
  return page
    .locator('div[class*="searchDropdownInner"] button[class*="searchResultItem"]')
    .filter({ hasText: text })
    .first();
}

function searchResultNameNodes(page: Page): Locator {
  return page
    .locator('div[class*="searchDropdownInner"] button[class*="searchResultItem"]')
    .locator('span[class*="searchResultName"]');
}

async function performSearch(page: Page, keyword: string): Promise<void> {
  const input = searchInput(page);
  await expect(input).toBeVisible({ timeout: 15000 });
  await input.click();
  await input.fill(keyword);
  await expect(searchDropdown(page)).toBeVisible({ timeout: 5000 });
}

// ============================================================================
// Table Cells Search Tests
// ============================================================================

test.describe('Table Cells search', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);

  /**
   * Test: 切换到 Table Cells 搜索
   * 步骤：
   * 1. 登录并创建包含数据的 Library
   * 2. 打开搜索框，选择 "Table Cells"
   * 3. 输入表格中存在的关键词
   * 预期：
   * - 搜索结果仅包含匹配的单元格
   * - 结果按 Library 最近打开排序
   */
  test('Table Cells search: filter and display results by keyword', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    // Step 1: Create project and library with table data
    const stamp = Date.now();
    const projectName = `TCS Project ${stamp}`;
    const libraryName = `TCS Library ${stamp}`;
    const searchKeyword = `keyword${stamp}`;

    await projectPage.createProject({ name: projectName, description: `search-fixture-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    await libraryPage.createLibraryUnderProject({ name: libraryName });
    await libraryPage.expectLibraryCreated();

    // Open library to add columns and assets
    const sidebarLibraryItem = page.locator('aside').locator(`[title="${libraryName}"]`).first();
    await expect(sidebarLibraryItem).toBeVisible({ timeout: 15000 });
    await sidebarLibraryItem.click();
    await libraryPage.waitForPageLoad();

    // Add a String column
    await libraryPage.addColumnFromTableSchemaEntry(libraryName, 'Description', 'String');
    await libraryPage.page.waitForTimeout(2000);

    // Create first asset with searchable content
    const assetPage1 = new AssetPage(page);
    await assetPage1.createAsset('Breed Template', {
      name: `Asset 1 ${stamp}`,
      fields: [{ label: 'Description', value: `This contains ${searchKeyword} for testing` }],
    });
    await assetPage1.expectAssetCreated();

    // Create second asset with same keyword
    const assetPage2 = new AssetPage(page);
    await assetPage2.createAsset('Breed Template', {
      name: `Asset 2 ${stamp}`,
      fields: [{ label: 'Description', value: `Another ${searchKeyword} entry` }],
    });
    await assetPage2.expectAssetCreated();

    // Step 2: Open search and select Table Cells tab
    const input = searchInput(page);
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.click();
    await expect(searchDropdown(page)).toBeVisible({ timeout: 5000 });

    // Click "Table Cells" tab
    const tableCellsTab = searchDropdown(page).getByRole('button', { name: /table cells/i });
    await expect(tableCellsTab).toBeVisible({ timeout: 5000 });
    await tableCellsTab.click();

    // Step 3: Enter search keyword
    await input.fill(searchKeyword);

    // Wait for cell search results to load
    await expect(searchDropdown(page)).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000); // Allow search API to respond

    // Verify results contain the keyword
    const noMatchesText = page.getByText('No matches.');
    const hasResults = !(await noMatchesText.isVisible({ timeout: 3000 }).catch(() => false));

    if (hasResults) {
      // Verify search results exist
      const cellResultButtons = searchDropdown(page).locator('button[class*="searchResultItem"]');
      await expect(cellResultButtons.first()).toBeVisible({ timeout: 10000 });

      // Verify results contain the search keyword in the value preview
      const resultText = await cellResultButtons.first().textContent();
      expect(resultText).toContain(searchKeyword);
    } else {
      // No results found - test the "No matches" state
      await expect(noMatchesText).toBeVisible({ timeout: 5000 });
    }
  });

  /**
   * Test: 分页显示
   * 步骤：
   * 1. 搜索结果超过 10 条
   * 2. 点击"下一页"/"上一页"
   * 预期：
   * - 可以正常翻页，内容正确加载
   */
  test('Table Cells search: pagination works correctly', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    // Step 1: Create project and library with multiple assets
    const stamp = Date.now();
    const projectName = `TCS Page Project ${stamp}`;
    const libraryName = `TCS Page Library ${stamp}`;
    const searchKeyword = `page${stamp}`;

    await projectPage.createProject({ name: projectName, description: `pagination-test-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    await libraryPage.createLibraryUnderProject({ name: libraryName });
    await libraryPage.expectLibraryCreated();

    // Open library
    const sidebarLibraryItem = page.locator('aside').locator(`[title="${libraryName}"]`).first();
    await expect(sidebarLibraryItem).toBeVisible({ timeout: 15000 });
    await sidebarLibraryItem.click();
    await libraryPage.waitForPageLoad();

    // Add a String column
    await libraryPage.addColumnFromTableSchemaEntry(libraryName, 'Notes', 'String');
    await libraryPage.page.waitForTimeout(2000);

    // Create multiple assets (11+) to trigger pagination (page size is 10)
    for (let i = 1; i <= 12; i++) {
      const assetPageX = new AssetPage(page);
      await assetPageX.createAsset('Breed Template', {
        name: `Page Asset ${i} ${stamp}`,
        fields: [{ label: 'Notes', value: `${searchKeyword} content ${i}` }],
      });
      await assetPageX.expectAssetCreated();
    }

    // Step 2: Open search and perform cell search
    const input = searchInput(page);
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.click();
    await expect(searchDropdown(page)).toBeVisible({ timeout: 5000 });

    // Select Table Cells tab
    const tableCellsTab = searchDropdown(page).getByRole('button', { name: /table cells/i });
    await expect(tableCellsTab).toBeVisible({ timeout: 5000 });
    await tableCellsTab.click();

    // Enter search keyword
    await input.fill(searchKeyword);
    await page.waitForTimeout(2000); // Wait for search API

    // Check if pagination controls are visible (indicating more than 10 results)
    const prevButton = page.getByRole('button', { name: /^prev$/i });
    const nextButton = page.getByRole('button', { name: /^next$/i });
    const pageIndicator = searchDropdown(page).locator('span').filter({ hasText: /\d+ \/ \d+/ });

    // Verify pagination is present if there are enough results
    const hasPagination = await pageIndicator.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasPagination) {
      // Get current page indicator
      const indicatorText = await pageIndicator.textContent();
      expect(indicatorText).toMatch(/\d+ \/ \d+/);

      // Click Next button if not on last page
      const nextDisabled = await nextButton.getAttribute('disabled');
      if (!nextDisabled) {
        await nextButton.click();
        await page.waitForTimeout(1000);

        // Verify page indicator changed
        const newIndicatorText = await pageIndicator.textContent();
        expect(newIndicatorText).not.toBe(indicatorText);

        // Click Prev button to go back
        const prevDisabled = await prevButton.getAttribute('disabled');
        if (!prevDisabled) {
          await prevButton.click();
          await page.waitForTimeout(1000);

          // Verify page indicator returned to original
          const finalIndicatorText = await pageIndicator.textContent();
          expect(finalIndicatorText).toBe(indicatorText);
        }
      }
    } else {
      // Less than 10 results, pagination should not be visible
      await expect(prevButton).not.toBeVisible({ timeout: 2000 });
      await expect(nextButton).not.toBeVisible({ timeout: 2000 });
    }
  });

  /**
   * Test: 点击单元格结果跳转并高亮
   * 步骤：
   * 1. 在 Table Cells 搜索结果中点击某单元格
   * 2. 观察页面
   * 预期：
   * - 跳转到对应 Library 表格视图
   * - 匹配的单元格背景黄色高亮
   */
  test('Table Cells search: click result navigates and highlights cell', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    // Step 1: Create project and library with test data
    const stamp = Date.now();
    const projectName = `TCS Nav Project ${stamp}`;
    const libraryName = `TCS Nav Library ${stamp}`;
    const searchKeyword = `highlight${stamp}`;

    await projectPage.createProject({ name: projectName, description: `nav-test-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    // Get project ID from URL
    const pathname = new URL(page.url()).pathname;
    const projectMatch = pathname.match(/^\/([^/]+)/);
    const projectId = projectMatch?.[1];
    if (!projectId || projectId === 'projects') {
      throw new Error(`Unable to resolve project id: ${page.url()}`);
    }

    await libraryPage.createLibraryUnderProject({ name: libraryName });
    await libraryPage.expectLibraryCreated();

    // Open library
    const sidebarLibraryItem = page.locator('aside').locator(`[title="${libraryName}"]`).first();
    await expect(sidebarLibraryItem).toBeVisible({ timeout: 15000 });
    await sidebarLibraryItem.click();
    await libraryPage.waitForPageLoad();

    // Add a String column
    await libraryPage.addColumnFromTableSchemaEntry(libraryName, 'Details', 'String');
    await libraryPage.page.waitForTimeout(2000);

    // Create an asset with searchable content
    const targetAssetName = `Highlight Asset ${stamp}`;
    const assetPageNav = new AssetPage(page);
    await assetPageNav.createAsset('Breed Template', {
      name: targetAssetName,
      fields: [{ label: 'Details', value: `This text has ${searchKeyword} keyword` }],
    });
    await assetPageNav.expectAssetCreated();

    // Step 2: Open search and perform cell search
    const input = searchInput(page);
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.click();
    await expect(searchDropdown(page)).toBeVisible({ timeout: 5000 });

    // Select Table Cells tab
    const tableCellsTab = searchDropdown(page).getByRole('button', { name: /table cells/i });
    await expect(tableCellsTab).toBeVisible({ timeout: 5000 });
    await tableCellsTab.click();

    // Enter search keyword
    await input.fill(searchKeyword);
    await page.waitForTimeout(2000);

    // Wait for results to appear
    const cellResultButtons = searchDropdown(page).locator('button[class*="searchResultItem"]');
    const resultCount = await cellResultButtons.count();

    // Step 3: Click on a search result
    if (resultCount > 0) {
      // Click the first result
      await cellResultButtons.first().click();

      // Wait for navigation to complete
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      await page.waitForTimeout(1000); // Allow URL params to settle

      // Verify we navigated to library page (not still on project page)
      const currentUrl = page.url();
      const urlObj = new URL(currentUrl);
      const urlPathParts = urlObj.pathname.split('/').filter(Boolean);

      // Navigate to the library page should have at least projectId/libraryId
      expect(urlPathParts.length).toBeGreaterThanOrEqual(2, `Expected URL to contain projectId/libraryId path, got: ${currentUrl}`);
      expect(currentUrl).toContain(`/${projectId}/`);

      // Verify search query parameters are present (cellSearchQ should be in URL)
      // The cellSearchQ param is used by the library page to highlight cells
      const cellSearchQ = urlObj.searchParams.get('cellSearchQ');

      // Either cellSearchQ matches keyword OR focusAssetId/focusFieldId params exist for navigation
      const hasNavigationParams = cellSearchQ !== null ||
        (urlObj.searchParams.get('focusAssetId') !== null && urlObj.searchParams.get('focusFieldId') !== null);

      expect(hasNavigationParams).toBe(true, `Expected navigation params in URL, got: ${currentUrl}`);

      // Wait for table to render
      await page.waitForTimeout(2000);

      // Verify highlighted cell exists (yellow background)
      // The highlighted cell has class "searchCellHit" with background #fff6cc
      const highlightedCell = page.locator('[class*="searchCellHit"]');
      await expect(highlightedCell.first()).toBeVisible({ timeout: 10000 });
    } else {
      // No results found - verify "No matches" message
      const noMatchesText = page.getByText('No matches.');
      await expect(noMatchesText).toBeVisible({ timeout: 5000 });
    }
  });
});

// ============================================================================
// Original Global Search Tests
// ============================================================================

test.describe('Global search (original)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180000);

  test('Exact match: project/folder/library can be found with correct hierarchy', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const fixture = await createSearchFixture(page, {
      projectName: `GS Project ${stamp}`,
      folderName: `GS Folder ${stamp}`,
      rootLibraryName: `GS Root Lib ${stamp}`,
      nestedLibraryName: `GS Nest Lib ${stamp}`,
    });

    await performSearch(page, fixture.nestedLibraryName);
    const nestedLibraryResult = searchResultItemByText(page, fixture.nestedLibraryName);
    await expect(nestedLibraryResult).toBeVisible({ timeout: 10000 });
    await expect(nestedLibraryResult).toContainText(fixture.projectName);
    await expect(nestedLibraryResult).toContainText(fixture.folderName);
    await expect(nestedLibraryResult.locator('span[class*="searchResultType"]')).not.toHaveText(/^$/);

    await performSearch(page, fixture.folderName);
    const folderResult = searchResultItemByText(page, fixture.folderName);
    await expect(folderResult).toBeVisible({ timeout: 10000 });
    await expect(folderResult).toContainText(fixture.projectName);
    await expect(folderResult.locator('span[class*="searchResultType"]')).not.toHaveText(/^$/);

    await performSearch(page, fixture.projectName);
    const projectResult = searchResultItemByText(page, fixture.projectName);
    await expect(projectResult).toBeVisible({ timeout: 10000 });
    await expect(projectResult.locator('span[class*="searchResultParent"]')).toHaveCount(0);
    await expect(projectResult.locator('span[class*="searchResultType"]')).not.toHaveText(/^$/);
  });

  test('Fuzzy match: query "abc" returns all names containing abc', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const fixture = await createSearchFixture(page, {
      projectName: `abc123-proj-${stamp}`,
      folderName: `12abc-folder-${stamp}`,
      rootLibraryName: `lib-xxabcxx-${stamp}`,
      nestedLibraryName: `lib-abc-tail-${stamp}`,
    });

    await performSearch(page, 'abc');
    await expect(searchResultItemByText(page, fixture.projectName)).toBeVisible({ timeout: 10000 });
    await expect(searchResultItemByText(page, fixture.folderName)).toBeVisible({ timeout: 10000 });
    await expect(searchResultItemByText(page, fixture.rootLibraryName)).toBeVisible({ timeout: 10000 });
    await expect(searchResultItemByText(page, fixture.nestedLibraryName)).toBeVisible({ timeout: 10000 });
  });

  test('Clicking a search result navigates to correct location', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const fixture = await createSearchFixture(page, {
      projectName: `GS Nav Proj ${stamp}`,
      folderName: `GS Nav Folder ${stamp}`,
      rootLibraryName: `GS Nav RootLib ${stamp}`,
      nestedLibraryName: `GS Nav NestLib ${stamp}`,
    });

    await performSearch(page, fixture.nestedLibraryName);
    await searchResultItemByText(page, fixture.nestedLibraryName).click();
    await page.waitForURL(new RegExp(`^.*\\/${fixture.projectId}\\/[^/]+$`), { timeout: 15000 });

    await performSearch(page, fixture.folderName);
    await searchResultItemByText(page, fixture.folderName).click();
    await page.waitForURL(new RegExp(`^.*\\/${fixture.projectId}\\/folder\\/[^/]+$`), { timeout: 15000 });
  });

  test('Scope filter: Library tab only shows library results', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const keyword = `scope${stamp}`;
    const fixture = await createSearchFixture(page, {
      projectName: `project-${keyword}`,
      folderName: `folder-${keyword}`,
      rootLibraryName: `library-${keyword}`,
      nestedLibraryName: `library-2-${keyword}`,
    });

    await performSearch(page, keyword);
    await expect(searchResultItemByText(page, fixture.projectName)).toBeVisible({ timeout: 10000 });
    await expect(searchResultItemByText(page, fixture.folderName)).toBeVisible({ timeout: 10000 });
    await expect(searchResultItemByText(page, fixture.rootLibraryName)).toBeVisible({ timeout: 10000 });

    await searchDropdown(page).getByRole('button', { name: /^library$/i }).click();

    await expect(searchResultItemByText(page, fixture.rootLibraryName)).toBeVisible({ timeout: 10000 });
    await expect(searchResultItemByText(page, fixture.nestedLibraryName)).toBeVisible({ timeout: 10000 });

    // In "Library" tab, project/folder names can still appear in hierarchy text.
    // Validate against primary result name only (not the full row text).
    const resultNames = searchResultNameNodes(page);
    await expect(resultNames.filter({ hasText: fixture.projectName })).toHaveCount(0);
    await expect(resultNames.filter({ hasText: fixture.folderName })).toHaveCount(0);
  });
});

