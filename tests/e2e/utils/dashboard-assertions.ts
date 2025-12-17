import { expect, type Page } from '@playwright/test';
import { projectsSelectors, librariesSelectors } from './selectors';

export async function assertEmptyDashboard(page: Page) {
  const { projectsHeading } = projectsSelectors(page);
  await expect(projectsHeading).toBeVisible();
}

export async function assertProjectOnlyDashboard(page: Page) {
  const { projectsHeading } = projectsSelectors(page);
  await expect(projectsHeading).toBeVisible();
  // Seed project A should be visible for the project-only account (in main projects grid).
  const mainProject = page
    .locator('div[class*="projectsGrid"]')
    .getByText('Seed Project A');
  await expect(mainProject).toBeVisible();

  // Navigate into the project and assert no libraries yet.
  await mainProject.click();
  const { librariesHeading, emptyLibrariesMessage } = librariesSelectors(page);
  await expect(librariesHeading).toBeVisible();
  await expect(emptyLibrariesMessage).toBeVisible();
}

export async function assertProjectWithLibraryDashboard(page: Page) {
  const { projectsHeading } = projectsSelectors(page);
  await expect(projectsHeading).toBeVisible();
  // Seed project B should be visible for the library account (in main projects grid).
  const mainProject = page
    .locator('div[class*="projectsGrid"]')
    .getByText('Seed Project B');
  await expect(mainProject).toBeVisible();

  // Navigate into the project and assert at least one library.
  await mainProject.click();
  const { librariesHeading, libraryByName, emptyLibrariesMessage } = librariesSelectors(page);
  await expect(librariesHeading).toBeVisible();
  await expect(libraryByName('Seed Library B1')).toBeVisible();
  await expect(emptyLibrariesMessage).toHaveCount(0);
}


