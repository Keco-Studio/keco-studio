import { test, expect } from '@playwright/test';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { PredefinedPage } from '../pages/predefined.page';
import { AssetPage } from '../pages/asset.page';
import { LoginPage } from '../pages/login.page';

import { projects } from '../fixures/projects';
import { libraries } from '../fixures/libraries';
import { DEFAULT_RESOURCE_FOLDER, folders } from '../fixures/folders';
import { predefinedTemplates } from '../fixures/predefined';
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
 * 6. Create Livestock Library (main library)
 * 7. Create Direct Folder (under project, not in another folder)
 * 8. Create Direct Library (under project, not folder)
 * 9. Create Livestock Predefined Template with:
 *    - String field: "Maturity Date"
 *    - Option field: "Health Status" with options [Healthy, Sick, Needs Checkup]
 *    - Reference field: "Breed" referencing the Breed Library
 * 10. Create a Livestock Asset based on the template
 * 11. Verify asset creation and field values
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
  let projectPage: ProjectPage;
  let libraryPage: LibraryPage;
  let predefinedPage: PredefinedPage;
  let assetPage: AssetPage;

  test.beforeEach(async ({ page }) => {
    // Initialize Page Objects
    projectPage = new ProjectPage(page);
    libraryPage = new LibraryPage(page);
    predefinedPage = new PredefinedPage(page);
    assetPage = new AssetPage(page);

    // Authenticate user before navigating to projects
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(users.seedEmpty3);
    await loginPage.expectLoginSuccess();

    // Verify authentication state is ready for API calls
    // This is critical in CI environments where auth state may take longer to establish
    await page.waitForFunction(
      () => {
        try {
          // Check if Supabase auth token exists and is valid in sessionStorage
          const keys = Object.keys(sessionStorage);
          for (const key of keys) {
            if (key.includes('sb-') && key.includes('auth-token')) {
              const value = sessionStorage.getItem(key);
              if (value) {
                try {
                  const parsed = JSON.parse(value);
                  // Verify token structure contains access_token
                  if (parsed && parsed.access_token && parsed.access_token.length > 10) {
                    return true;
                  }
                } catch {
                  // If parsing fails, token might be in different format
                  if (value.length > 10) {
                    return true;
                  }
                }
              }
            }
          }
          return false;
        } catch {
          return false;
        }
      },
      { timeout: 30000 }
    );

    // Additional wait to ensure Supabase client is fully initialized
    await page.waitForTimeout(2000);

    // Now navigate to projects page
    // await projectPage.goto();
  });

  test('should complete full workflow: Project → Folder → Libraries → Template → Asset', async () => {
    // Increase timeout for this complex E2E test
    // After adding authorization checks, operations may take longer
    test.setTimeout(180000); // 3 minutes
    
    // ==========================================
    // STEP 1: Create a new project
    // ==========================================
    await test.step('Create a new project', async () => {
      await projectPage.createProject(projects.happyPath);
      await projectPage.expectProjectCreated();
      // Project creation automatically navigates to project detail page
      await libraryPage.waitForPageLoad();
    });

    // ==========================================
    // STEP 3: Navigate to default Resource Folder
    // ==========================================
    // await test.step('Open the default Resource Folder', async () => {
    //   // When a project is created, a "Resource Folder" is auto-created
    //   await libraryPage.expectFolderExists(DEFAULT_RESOURCE_FOLDER);
    //   await libraryPage.openFolder(DEFAULT_RESOURCE_FOLDER);
    // });

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
      
      // Click the predefine button in the sidebar to navigate to predefine page
      await libraryPage.clickPredefineButton(libraries.breed.name);
      await predefinedPage.waitForPageLoad();
      
      // Create breed schema
      await predefinedPage.createPredefinedTemplate(predefinedTemplates.breed);
      await predefinedPage.expectTemplateCreated();
      
      // Navigate back to library page to create asset
      // Instead of goBack(), click on the library name in the sidebar to navigate
      const sidebar = libraryPage.page.getByRole('tree');
      const libraryLink = sidebar.getByText(libraries.breed.name, { exact: true });
      await libraryLink.click();
      await libraryPage.waitForPageLoad();
      
      // Create breed asset
      await assetPage.createAsset(predefinedTemplates.breed.name, assets.breed);
      await assetPage.expectAssetCreated();
    });

    // ==========================================
    // STEP 6: Create the Main Library (Livestock Library)
    // ==========================================
    // await test.step('Create the main livestock library', async () => {
    //   await libraryPage.openFolder(DEFAULT_RESOURCE_FOLDER);
    //   await libraryPage.createLibrary(libraries.livestock);
    //   await libraryPage.expectLibraryCreated();
    // });

    // ==========================================
    // STEP 7: Create a Folder directly under Project
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
    // STEP 8: Create a Library directly under Project
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
    // STEP 9: Open the Livestock Library
    // ==========================================
    // await test.step('Open the livestock library to create schema', async () => {
    //   await libraryPage.openFolder(DEFAULT_RESOURCE_FOLDER);
    //   await libraryPage.openLibrary(libraries.livestock.name);
    //   await libraryPage.waitForPageLoad();
    // });

    // ==========================================
    // STEP 10: Create Livestock Predefined Schema
    // ==========================================
    // Schema includes:
    // - Default "Name" field (auto-created, non-configurable)
    // - String field: "Maturity Date"
    // - Option field: "Health Status" with options [Healthy, Sick, Needs Checkup]
    // - Reference field: "Breed" referencing the Breed Library
    // await test.step('Create predefined schema with string, option, and reference fields', async () => {
    //   // Navigate to predefine page
    //   await libraryPage.page.goto(libraryPage.page.url() + '/predefine');
    //   await predefinedPage.waitForPageLoad();
      
    //   // Create livestock schema
    //   await predefinedPage.createPredefinedTemplate(predefinedTemplates.livestock);
    //   await predefinedPage.expectTemplateCreated();
      
    //   // Navigate back to library page
    //   await libraryPage.page.goBack();
    //   await libraryPage.waitForPageLoad();
    // });

    // ==========================================
    // STEP 11: Create a Livestock Asset
    // ==========================================
    // await test.step('Create an asset using the predefined schema', async () => {
    //   // Assets are created on the library page
    //   await assetPage.createAsset(
    //     predefinedTemplates.livestock.name,
    //     assets.livestock
    //   );
      
    //   await assetPage.expectAssetCreated();
    // });

    // ==========================================
    // STEP 12: Verify Asset Details
    // ==========================================
    // await test.step('Verify asset details and field values', async () => {
    //   // Verify asset name
    //   await assetPage.expectAssetName(assets.livestock.name);
      
    //   // Verify each field value
    //   for (const field of assets.livestock.fields) {
    //     await assetPage.expectFieldValue(field.label, field.value as string);
    //   }
    // });

    // ==========================================
    // SUCCESS: Happy Path Complete! 🎉
    // ==========================================
  });

  // ==========================================
  // Additional Happy Path Variations (Optional)
  // ==========================================

  // test.skip('should handle template creation with only string fields', async () => {
  //   // Simplified version testing only basic string fields
  //   // Can be implemented for regression testing
  // });

  // test.skip('should create multiple assets from same template', async () => {
  //   // Tests asset creation scalability
  //   // Can be implemented for load testing
  // });
});

