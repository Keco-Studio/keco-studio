import { test, expect, type Page, type Locator } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
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

test.describe('Global search', () => {
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

