import { test, expect } from '@playwright/test';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { LoginPage } from '../pages/login.page';

import { projects } from '../fixures/projects';
import { libraries } from '../fixures/libraries';
import { folders } from '../fixures/folders';
import { users } from '../fixures/users';

/**
 * Destructive E2E Test
 * 
 * This test validates deletion functionality for all major entities:
 * 1. Library deletion (including contained assets)
 * 2. Folder deletion
 * 3. Project deletion
 * 
 * Prerequisites:
 * - Uses pre-seeded account (seedHappyPath) that matches happy-path.spec.ts output
 * - No need to run happy-path.spec.ts first - data is pre-populated in database
 * - Pre-seeded data includes:
 *   - Project: "Livestock Management Project"
 *   - Breed Library (with predefined template and asset "Black Goat Breed")
 *   - Direct Library (created directly under project)
 *   - Direct Folder (created directly under project)
 * 
 * Test Strategy:
 * - Delete in reverse dependency order (assets → libraries → folders → project)
 * - Use sidebar delete buttons (× buttons)
 * - Verify deletion through UI absence
 * 
 * Architecture:
 * - Pure business flow - no selectors in test file
 * - All UI interactions delegated to Page Objects
 * - All test data from fixtures
 * - Follows Page Object Model (POM) pattern
 */

test.describe('Destructive Tests - Delete Operations', () => {
  test.describe.configure({ timeout: 120000 });

  let projectPage: ProjectPage;
  let libraryPage: LibraryPage;

  test.beforeEach(async ({ page }) => {
    // Initialize Page Objects
    projectPage = new ProjectPage(page);
    libraryPage = new LibraryPage(page);

    // Authenticate user with pre-seeded data matching happy-path test output
    // This account has the same data structure as what happy-path.spec.ts creates
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(users.seedHappyPath);
    // expectLoginSuccess now includes comprehensive verification:
    // - URL change, network idle, auth token presence, and user avatar visibility
    await loginPage.expectLoginSuccess();

    // Note: seed-happy-path user has exactly one project, so after login success,
    // the app will auto-redirect from /projects to /{projectId} (see Sidebar.tsx auto-navigate logic).
    // This is the expected behavior - we're already in the project page.
    // The pre-seeded project is "Livestock Management Project"
    await libraryPage.waitForPageLoad();
  });

  test('should delete all entities in dependency order: library → folder → project', async () => {
    // ==========================================
    // STEP 1: Delete Libraries
    // ==========================================
    await test.step('Delete all libraries', async () => {
      // We're already in the project root page after beforeEach
      // No need to navigate back
      
      // Delete breed library
      await libraryPage.deleteLibrary(libraries.breed.name, { deleteAllMatching: true });
      await libraryPage.expectLibraryDeleted(libraries.breed.name);
      
      // Delete direct library
      await libraryPage.deleteLibrary(libraries.directLibrary.name, { deleteAllMatching: true });
      await libraryPage.expectLibraryDeleted(libraries.directLibrary.name);
    });

    // ==========================================
    // STEP 2: Delete Folder
    // ==========================================
    await test.step('Delete direct folder', async () => {
      await libraryPage.deleteFolder(folders.directFolder.name, { deleteAllMatching: true });
      await libraryPage.expectFolderDeleted(folders.directFolder.name);
    });

    // ==========================================
    // STEP 3: Delete Project
    // ==========================================
    await test.step('Delete project', async () => {
      // After deleting all libraries and folders, we should still be in the project page
      // Wait for page to stabilize before attempting deletion
      await libraryPage.page.waitForLoadState('load', { timeout: 10000 });
      await libraryPage.page.waitForTimeout(1000);
      
      // Wait for the Projects section in sidebar to be visible
      // This ensures the sidebar has fully rendered and projects list is loaded
      const projectsHeading = libraryPage.page.locator('aside').getByText('Projects');
      await expect(projectsHeading).toBeVisible({ timeout: 10000 });
      
      // Additional wait to ensure projects list is populated
      await libraryPage.page.waitForTimeout(1000);
      
      // Delete the project from sidebar
      await projectPage.deleteProject(projects.happyPath.name, { deleteAllMatching: true });
      await projectPage.expectProjectDeleted(projects.happyPath.name);
      
      // Verify navigation to home page (which redirects to /projects)
      await libraryPage.page.waitForURL(/\/(projects)?$/, { timeout: 10000 });
    });

    // ==========================================
    // SUCCESS: All entities deleted successfully! 🎉
    // ==========================================
  });
});
