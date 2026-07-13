import { test } from '@playwright/test';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { AssetPage } from '../pages/asset.page';
import { LoginPage } from '../pages/login.page';

import { generateProjectData } from '../fixures/projects';
import { libraries } from '../fixures/libraries';
import { DEFAULT_RESOURCE_FOLDER, folders } from '../fixures/folders';
import { assets } from '../fixures/assets';
import { users } from '../fixures/users';

/**
 * Happy Path E2E Test
 * 
 * This test validates the complete user journey through the system:
 * 1. Login and navigate to projects
 * 2. Create a Project
 * 3. Navigate to default Resources Folder
 * 4. Create Breed Library (reference library)
 * 5. Create Breed Template and Asset (to be referenced)
 * 6. Create Direct Folder (under project, not in another folder)
 * 7. Create Direct Library (under project, not folder)
 * 
 * Authentication:
 * - User logs in at the start of each test
 * - Uses seed-empty user for clean state
 * 
 * Architecture:
 * - Pure business flow - no selectors in test file
 * - All UI interactions delegated to Page Objects
 * - All test data from fixtures
 * - Follows Page Object Model (POM) pattern
 */

test.describe('Happy Path - Complete User Journey', () => {
  test.describe.configure({ timeout: 180000 });

  let projectPage: ProjectPage;
  let libraryPage: LibraryPage;
  let assetPage: AssetPage;

  test.beforeEach(async ({ page }) => {
    // Initialize Page Objects
    projectPage = new ProjectPage(page);
    libraryPage = new LibraryPage(page);
    assetPage = new AssetPage(page);

    // Authenticate user before navigating to projects
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(users.seedEmpty);
    // expectLoginSuccess now includes comprehensive verification:
    // - URL change, network idle, auth token presence, and user avatar visibility
    await loginPage.expectLoginSuccess();

    // Now navigate to projects page if needed
    // await projectPage.goto();
  });

  test('should create a project with nested and direct resources', async () => {
    const testProject = generateProjectData();

    // ==========================================
    // STEP 1: Create a new project
    // ==========================================
    await test.step('Create a new project', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      // Project creation automatically navigates to project detail page
      await libraryPage.waitForPageLoad();
    });

    // ==========================================
    // STEP 3: Navigate to default Resource Folder
    // ==========================================
    await test.step('Open the default Resource Folder', async () => {
      // When a project is created, a "Resource Folder" is auto-created
      await libraryPage.expectFolderExists(DEFAULT_RESOURCE_FOLDER);
      await libraryPage.openFolder(DEFAULT_RESOURCE_FOLDER);
    });

    // ==========================================
    // STEP 4: Create the Reference Library (Breed Library)
    // ==========================================
    // This library will be referenced by the livestock library's reference field
    await test.step('Create the breed reference library', async () => {
      await libraryPage.createLibrary(libraries.breed);
      await libraryPage.expectLibraryCreated();
    });

    // ==========================================
    // STEP 5: Create Breed Schema and Asset
    // ==========================================
    // We need to create a breed asset first so it can be referenced by livestock
    await test.step('Create breed schema and asset', async () => {
      // Open the breed library (goes to library page)
      await libraryPage.openLibrary(libraries.breed.name);
      await libraryPage.waitForPageLoad();
      
      // Current UI schema entry: table right-side "+" (Add new column), not /predefine route.
      await libraryPage.addColumnFromTableSchemaEntry(libraries.breed.name, 'Origin', 'String');
      
      // Wait for template to be fully saved to database (critical in parallel execution)
      await libraryPage.page.waitForTimeout(2000);
      
      // Create breed asset
      await assetPage.createAsset('Breed Template', assets.breed);
      await assetPage.expectAssetCreated();
    });

    // ==========================================
    // STEP 6: Create a Folder directly under Project
    // ==========================================
    // Tests the P → F path (not P → F → F)
    await test.step('Create a folder directly under project', async () => {
      // Navigate back to project root
      await libraryPage.navigateBackToProject();
      
      // Create folder directly under project using sidebar add button
      // This uses: sidebar add button -> AddLibraryMenu -> Create new folder
      await libraryPage.createFolderUnderProject(folders.directFolder);
      await libraryPage.expectFolderCreated();
      
      // Navigate back to continue with main flow
      await libraryPage.navigateBackToProject();
    });

    // ==========================================
    // STEP 7: Create a Library directly under Project
    // ==========================================
    // Tests the P → L path (not P → F → L)
    await test.step('Create a library directly under project', async () => {
      // Navigate back to project root
      await libraryPage.navigateBackToProject();
      
      // Create library directly under project using sidebar add button
      // This uses: sidebar add button -> AddLibraryMenu -> Create new library
      await libraryPage.createLibraryUnderProject(libraries.directLibrary);
      await libraryPage.expectLibraryCreated();
      
      // Navigate back to continue with main flow
      await libraryPage.navigateBackToProject();
    });

    // ==========================================
    // SUCCESS: Happy Path Complete
    // ==========================================
  });
});
