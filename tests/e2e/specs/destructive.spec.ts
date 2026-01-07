import { test, expect } from '@playwright/test';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { AssetPage } from '../pages/asset.page';
import { LoginPage } from '../pages/login.page';

import { projects } from '../fixures/projects';
import { libraries } from '../fixures/libraries';
import { folders } from '../fixures/folders';
import { assets } from '../fixures/assets';
import { users } from '../fixures/users';

/**
 * Destructive E2E Test
 * 
 * This test validates deletion functionality for all major entities:
 * 1. Asset deletion
 * 2. Library deletion
 * 3. Folder deletion
 * 4. Project deletion
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
  let projectPage: ProjectPage;
  let libraryPage: LibraryPage;
  let assetPage: AssetPage;

  test.beforeEach(async ({ page }) => {
    // Initialize Page Objects
    projectPage = new ProjectPage(page);
    libraryPage = new LibraryPage(page);
    assetPage = new AssetPage(page);

    // Authenticate user with pre-seeded data matching happy-path test output
    // This account has the same data structure as what happy-path.spec.ts creates
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(users.seedHappyPath);
    // await loginPage.login(users.seedHappyPath);
    await loginPage.expectLoginSuccess();

    // Navigate to projects page first to ensure we're on the right page
    await projectPage.goto();
    await projectPage.waitForPageLoad();

    // Navigate to the test project (pre-seeded, matches happy-path output)
    await projectPage.openProject(projects.happyPath.name);
    await libraryPage.waitForPageLoad();
  });

  // test('should delete asset successfully', async () => {
  //   test.setTimeout(60000); // 1 minute
    
  //   // ==========================================
  //   // STEP 1: Delete the breed asset
  //   // ==========================================
  //   // Note: deleteAsset will automatically expand the library if needed
  //   await test.step('Delete breed asset from sidebar', async () => {
  //     await assetPage.deleteAsset(assets.breed.name, libraries.breed.name);
  //     await assetPage.expectAssetDeleted(assets.breed.name);
  //   });
  // });

  // test('should delete library successfully', async () => {
  //   test.setTimeout(60000); // 1 minute
    
  //   // ==========================================
  //   // STEP 1: Delete the Breed Library
  //   // ==========================================
  //   await test.step('Delete breed library from sidebar', async () => {
  //     await libraryPage.deleteLibrary(libraries.breed.name);
  //     await libraryPage.expectLibraryDeleted(libraries.breed.name);
  //   });

  //   // ==========================================
  //   // STEP 2: Delete the Direct Library
  //   // ==========================================
  //   await test.step('Delete direct library from sidebar', async () => {
  //     await libraryPage.deleteLibrary(libraries.directLibrary.name);
  //     await libraryPage.expectLibraryDeleted(libraries.directLibrary.name);
  //   });
  // });

  // test('should delete folder successfully', async () => {
  //   test.setTimeout(60000); // 1 minute
    
  //   // ==========================================
  //   // STEP 1: Delete the Direct Folder
  //   // ==========================================
  //   await test.step('Delete direct folder from sidebar', async () => {
  //     await libraryPage.deleteFolder(folders.directFolder.name);
  //     await libraryPage.expectFolderDeleted(folders.directFolder.name);
  //   });
  // });

  // test.skip('should delete project successfully', async () => {
  //   test.setTimeout(60000); // 1 minute
    
  //   // ==========================================
  //   // STEP 1: Wait for page to stabilize
  //   // ==========================================
  //   await test.step('Ensure sidebar is ready', async () => {
  //     // We're already in the project page after beforeEach
  //     // Wait for the Projects section in sidebar to be visible
  //     await libraryPage.page.waitForLoadState('networkidle');
  //     const projectsHeading = libraryPage.page.locator('aside').getByText('Projects');
  //     await expect(projectsHeading).toBeVisible({ timeout: 10000 });
  //     await libraryPage.page.waitForTimeout(1000);
  //   });

  //   // ==========================================
  //   // STEP 2: Delete the project
  //   // ==========================================
  //   await test.step('Delete project from sidebar', async () => {
  //     await projectPage.deleteProject(projects.happyPath.name);
  //     await projectPage.expectProjectDeleted(projects.happyPath.name);
  //   });

  //   // ==========================================
  //   // STEP 3: Verify we're redirected to home/root page
  //   // ==========================================
  //   await test.step('Verify navigation to home page after deletion', async () => {
  //     // After project deletion, should redirect to root (which redirects to /projects)
  //     await libraryPage.page.waitForURL(/\/(projects)?$/, { timeout: 10000 });
  //   });
  // });

  // ==========================================
  // Combined Test: Delete all in correct order
  // ==========================================
  test('should delete all entities in correct order: asset → library → folder → project', async () => {
    test.setTimeout(120000); // 2 minutes
    
    // ==========================================
    // STEP 1: Delete Asset
    // ==========================================
    await test.step('Delete breed asset', async () => {
      // Delete the asset (deleteAsset will automatically expand the library)
      await assetPage.deleteAsset(assets.breed.name, libraries.breed.name);
      await assetPage.expectAssetDeleted(assets.breed.name);
    });

    // ==========================================
    // STEP 2: Delete Libraries
    // ==========================================
    await test.step('Delete all libraries', async () => {
      // Navigate back to project root
      await libraryPage.navigateBackToProject();
      
      // Delete breed library
      await libraryPage.deleteLibrary(libraries.breed.name);
      await libraryPage.expectLibraryDeleted(libraries.breed.name);
      
      // Delete direct library
      await libraryPage.deleteLibrary(libraries.directLibrary.name);
      await libraryPage.expectLibraryDeleted(libraries.directLibrary.name);
    });

    // ==========================================
    // STEP 3: Delete Folder
    // ==========================================
    await test.step('Delete direct folder', async () => {
      await libraryPage.deleteFolder(folders.directFolder.name);
      await libraryPage.expectFolderDeleted(folders.directFolder.name);
    });

    // ==========================================
    // STEP 4: Delete Project
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
      await projectPage.deleteProject(projects.happyPath.name);
      await projectPage.expectProjectDeleted(projects.happyPath.name);
      
      // Verify navigation to home page (which redirects to /projects)
      await libraryPage.page.waitForURL(/\/(projects)?$/, { timeout: 10000 });
    });

    // ==========================================
    // SUCCESS: All entities deleted successfully! 🎉
    // ==========================================
  });
});
