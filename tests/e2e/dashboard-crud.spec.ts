import { test, expect, Page } from '@playwright/test';
import { projectsSelectors, librariesSelectors } from './utils/selectors';
import { loginAsSeedEmpty } from './utils/auth-helpers';
import { uniqueName } from './utils/data-factories';

// Detect whether we are running against a real Supabase instance.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isRealSupabase =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  !supabaseUrl.includes('example.supabase.co') &&
  !/dummy/i.test(supabaseAnonKey);

async function acceptNextDialog(page: Page) {
  page.once('dialog', (dialog) => dialog.accept());
}

async function createProject(page: Page, name: string) {
  const { projectsHeading, newProjectButton } = projectsSelectors(page);
  await expect(projectsHeading).toBeVisible();

  await newProjectButton.click();
  await page.getByPlaceholder('Enter project name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
}

test.describe('Dashboard project and library CRUD', () => {
  test.skip(!isRealSupabase, 'Requires real Supabase credentials and seeded data');

  test('create a new project and arrive on its page', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const projectName = uniqueName('e2e-project');
    await createProject(page, projectName);

    // After creating a project from /projects we should land on the project page
    const { librariesHeading } = librariesSelectors(page);
    await expect(librariesHeading).toBeVisible();
  });

  test('create a new library under a project and see it listed', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const projectName = uniqueName('e2e-project-lib');
    await createProject(page, projectName);

    const sidebar = page.locator('aside');
    const sidebarProject = sidebar.getByText(projectName);
    await expect(sidebarProject).toBeVisible();
    await sidebarProject.click();

    // Open "New Library" modal from the Libraries section in the sidebar (the "+" button)

    const libraryName = uniqueName('e2e-library');
    const { libraryByName, newLibraryButton } = librariesSelectors(page);
    await newLibraryButton.click();
    const nameInput = page.getByPlaceholder('Enter library name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(libraryName);
    await page.getByRole('button', { name: 'Create' }).click();

    // Library should appear in the main libraries list
    await expect(libraryByName(libraryName)).toBeVisible();
  });

  test('delete a library via confirmation and keep project', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const projectName = uniqueName('e2e-project-del-lib');
    const libraryName = uniqueName('e2e-library-del');
    const { projectByName } = projectsSelectors(page);
    const { libraryByName } = librariesSelectors(page);

    // Create project and navigate to it
    await createProject(page, projectName);
    const sidebar = page.locator('aside');
    const sidebarProject = sidebar.getByText(projectName);
    await expect(sidebarProject).toBeVisible();
    await sidebarProject.click();

    // Create library
    const newLibraryButton = sidebar.getByRole('button', { name: 'New Library' });
    await newLibraryButton.click();
    await page.getByPlaceholder('Enter library name').fill(libraryName);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(libraryByName(libraryName)).toBeVisible();

    // Delete library via confirmation dialog (sidebar delete button)
    await acceptNextDialog(page);
    await page.getByRole('button', { name: 'Delete library' }).nth(1).click();

    await expect(libraryByName(libraryName)).toHaveCount(0);
    // Project should still exist in projects view
    await expect(projectByName(projectName)).toBeVisible();
  });

  test('delete a project via confirmation and ensure it disappears', async ({ page }) => {
    await loginAsSeedEmpty(page);

    const projectName = uniqueName('e2e-project-del');
    const { projectByName } = projectsSelectors(page);

    await createProject(page, projectName);
    await expect(projectByName(projectName)).toBeVisible();

    // Delete the project via sidebar button and confirmation
    await acceptNextDialog(page);
    await page.getByRole('button', { name: 'Delete project' }).first().click();

    // Project disappears from the sidebar/projects list (other projects may still exist)
    const sidebar = page.locator('aside');
    const sidebarProject = sidebar.getByText(projectName);
    await expect(sidebarProject).toHaveCount(1);
  });
});
