import { expect, type Page, type Locator } from '@playwright/test';
import type { LibraryData } from '../fixures/libraries';
import type { FolderData } from '../fixures/folders';

/**
 * LibraryPage - Page Object Model for Library management
 * 
 * Libraries can be created in two ways:
 * 1. Directly under a Project (P → L)
 * 2. Inside a Folder (P → F → L)
 * 
 * This page handles:
 * - Folder operations (default Resource Folder navigation)
 * - Library creation in folders or directly under project
 * - Library navigation
 */
export class LibraryPage {
  readonly page: Page;

  // Folder and Library list elements
  readonly foldersHeading: Locator;
  readonly librariesHeading: Locator;
  readonly createFolderButton: Locator;
  readonly createLibraryButton: Locator;

  // Folder creation form
  readonly folderNameInput: Locator;
  readonly folderDescriptionInput: Locator;

  // Library creation form
  readonly libraryNameInput: Locator;
  readonly libraryDescriptionInput: Locator;
  
  // Form action buttons
  readonly submitButton: Locator;
  readonly cancelButton: Locator;

  // Success/error feedback
  readonly successMessage: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;

    // Page headings
    this.foldersHeading = page.getByRole('heading', { name: /folders/i });
    this.librariesHeading = page.getByRole('heading', { name: /libraries/i });

    // Action buttons
    this.createFolderButton = page.getByRole('button', { name: /create folder/i });
    // Note: There are two "Create Library" buttons:
    // 1. LibraryToolbar button (with aria-label="Create Library") - commented out for now
    // 2. FolderPage button (in empty state) - using .nth(1) to select the second one
    // this.createLibraryButton = page.getByRole('button', { name: /create library/i }); // First button
    this.createLibraryButton = page.getByRole('button', { name: /create library/i }).nth(1); // Second button (FolderPage)

    // Folder form inputs
    this.folderNameInput = page.getByLabel(/folder name/i);
    // Note: Folder modal doesn't have description field based on NewFolderModal.tsx
    this.folderDescriptionInput = page.getByLabel(/folder description/i)
      .or(page.getByLabel(/description/i));

    // Library form inputs
    this.libraryNameInput = page.getByLabel(/library name/i);
    // Library description label is "Add notes for this Library"
    this.libraryDescriptionInput = page.locator('textarea').filter({ 
      has: page.locator('label:has-text("Add notes")') 
    }).or(page.getByLabel(/add notes.*library/i))
      .or(page.getByLabel(/library description/i));

    // Form action buttons
    this.submitButton = page.getByRole('button', { name: /^(create|submit)$/i });
    this.cancelButton = page.getByRole('button', { name: /cancel/i });

    // Feedback messages
    this.successMessage = page.locator('[class*="success"], [role="alert"]').filter({ hasText: /success/i });
    this.errorMessage = page.locator('[class*="error"], [role="alert"]').filter({ hasText: /error/i });
  }

  /**
   * Open the default Resource Folder that is auto-created with each project
   * @param folderName - Name of the folder (default: "Resource Folder")
   */
  async openFolder(folderName: string): Promise<void> {
    // Find and click the folder by name
    const folderCard = this.page.getByRole('button', { name: folderName })
      .or(this.page.getByRole('link', { name: folderName }))
      .or(this.page.getByText(folderName, { exact: true }).first());

    await expect(folderCard).toBeVisible({ timeout: 5000 });
    await folderCard.click();

    // Wait for navigation to folder content (libraries list)
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Create a new folder under the current project
   * @param folder - Folder data with name and optional description
   */
  async createFolder(folder: FolderData): Promise<void> {
    // Click create folder button
    await this.createFolderButton.click();

    // Wait for modal to appear
    await expect(this.folderNameInput).toBeVisible({ timeout: 5000 });

    // Fill in folder details
    await this.folderNameInput.fill(folder.name);
    
    // Note: Folder modal doesn't have description field in NewFolderModal.tsx
    // if (folder.description) {
    //   await expect(this.folderDescriptionInput).toBeVisible({ timeout: 3000 });
    //   await this.folderDescriptionInput.fill(folder.description);
    // }

    // Submit the form
    await this.submitButton.click();

    // Wait for modal to close
    await expect(this.folderNameInput).not.toBeVisible({ timeout: 10000 });
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Create a new library in the current context (folder or project)
   * @param library - Library data with name and optional description
   */
  async createLibrary(library: LibraryData): Promise<void> {
    // Click create library button
    await this.createLibraryButton.click();

    // Wait for modal to appear
    await expect(this.libraryNameInput).toBeVisible({ timeout: 5000 });

    // Fill in library details
    await this.libraryNameInput.fill(library.name);
    
    if (library.description) {
      // Wait for description field to be visible
      await expect(this.libraryDescriptionInput).toBeVisible({ timeout: 3000 });
      await this.libraryDescriptionInput.fill(library.description);
    }

    // Submit the form
    await this.submitButton.click();

    // Wait for modal to close
    await expect(this.libraryNameInput).not.toBeVisible({ timeout: 10000 });
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Open an existing library by name
   * @param libraryName - Name of the library to open
   */
  async openLibrary(libraryName: string): Promise<void> {
    // Find and click the library by its name
    const libraryCard = this.page.getByRole('button', { name: libraryName })
      .or(this.page.getByRole('link', { name: libraryName }))
      .or(this.page.getByText(libraryName, { exact: true }).first());

    await expect(libraryCard).toBeVisible({ timeout: 5000 });
    await libraryCard.click();

    // Wait for navigation to library detail page
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Navigate back to project from library view
   */
  async navigateBackToProject(): Promise<void> {
    // Use breadcrumb or back button, or navigate via URL
    const backButton = this.page.getByRole('button', { name: /back/i })
      .or(this.page.locator('[aria-label*="back"]'));
    
    // Try to click back button if visible, otherwise navigate via URL
    if (await backButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await backButton.click();
    } else {
      // Extract projectId from current URL and navigate to project root
      const currentUrl = this.page.url();
      const match = currentUrl.match(/\/([^/]+)(?:\/|$)/);
      if (match && match[1]) {
        await this.page.goto(`/${match[1]}`);
      }
    }
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Assert library exists in the current view
   * @param libraryName - Name of the library to verify
   */
  async expectLibraryExists(libraryName: string): Promise<void> {
    const libraryItem = this.page.getByText(libraryName, { exact: true });
    await expect(libraryItem).toBeVisible();
  }

  /**
   * Assert folder exists in the current view
   * @param folderName - Name of the folder to verify
   */
  async expectFolderExists(folderName: string): Promise<void> {
    // Locate folder in sidebar (tree) to avoid strict mode violation
    const sidebar = this.page.getByRole('tree');
    const folderItem = sidebar.getByText(folderName, { exact: true });
    await expect(folderItem).toBeVisible();
  }

  /**
   * Assert successful library creation
   */
  async expectLibraryCreated(): Promise<void> {
    // Library creation closes modal and refreshes the list
    // Wait for modal to close (library name input should not be visible)
    await expect(this.libraryNameInput).not.toBeVisible({ timeout: 10000 });
    // Wait for page to refresh
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Assert successful folder creation
   */
  async expectFolderCreated(): Promise<void> {
    // Folder creation closes modal and refreshes the list
    // Wait for modal to close (folder name input should not be visible)
    await expect(this.folderNameInput).not.toBeVisible({ timeout: 10000 });
    // Wait for page to refresh
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Wait for libraries page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    // Project detail page doesn't have headings, wait for URL or toolbar/empty state
    // Wait for page to stabilize first
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    
    // Wait for either create library button (toolbar) or empty state text or sidebar folder
    // Note: Use sidebar.getByText to avoid strict mode violation (Resources Folder appears in both sidebar and folder card)
    const sidebar = this.page.getByRole('tree');
    await expect(
      this.createLibraryButton
        .or(this.page.getByText(/no folders or libraries/i))
        .or(sidebar.getByText(/resources folder/i))
    ).toBeVisible({ timeout: 15000 });
    
    await this.page.waitForLoadState('networkidle', { timeout: 10000 });
  }
}

