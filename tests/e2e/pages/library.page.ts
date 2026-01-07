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
  
  // Sidebar add button (for creating library/folder directly under project)
  readonly sidebarAddButton: Locator;
  readonly addLibraryMenuButton: Locator;
  readonly addFolderMenuButton: Locator;

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
    
    // Sidebar "Create new library" button (in folder treeitem)
    // This button appears in the sidebar tree under each folder
    // Uses data-testid for stable selection
    this.createLibraryButton = page.locator('button[data-testid="sidebar-create-library-button"]')
      .or(page.getByRole('treeitem').locator('button[class*="createButton"]').filter({ hasText: /^Create new library$/ }).first());
    
    // Sidebar add button (for creating library/folder directly under project)
    this.sidebarAddButton = page.locator('button[title="Add new folder or library"]')
      .or(page.getByRole('button', { name: /add/i }).filter({ has: page.locator('img[alt="Add library"]') }));
    
    // AddLibraryMenu button (appears after clicking sidebar add button)
    // Note: AddLibraryMenu is rendered via createPortal to document.body
    // Use more flexible selectors that work with the portal
    this.addLibraryMenuButton = page.getByRole('button', { name: /create new library/i })
      .filter({ hasNotText: /resources folder/i }) // Exclude sidebar buttons
      .last(); // Use last() to get the portal menu button
    
    // AddLibraryMenu "Create new folder" button
    this.addFolderMenuButton = page.getByRole('button', { name: /create new folder/i })
      .last(); // Use last() to get the portal menu button if there are duplicates

    // Folder form inputs
    // Note: NewFolderModal uses a plain input with placeholder, not a labeled input
    this.folderNameInput = page.getByPlaceholder(/enter folder name/i);
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
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 });
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
    await this.page.waitForLoadState('load', { timeout: 15000 });
    // Additional wait to ensure authorization checks are complete
    await this.page.waitForTimeout(1000);
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
    await this.page.waitForLoadState('load', { timeout: 15000 });
    // Additional wait to ensure authorization checks are complete
    await this.page.waitForTimeout(1000);
  }

  /**
   * Create a library directly under project (not in a folder)
   * This uses the sidebar add button -> AddLibraryMenu -> Create new library flow
   * @param library - Library data with name and optional description
   */
  async createLibraryUnderProject(library: LibraryData): Promise<void> {
    // Step 1: Click the sidebar add button (title="Add new folder or library")
    await expect(this.sidebarAddButton).toBeVisible({ timeout: 5000 });
    await this.sidebarAddButton.click();

    // Step 2: Wait for AddLibraryMenu to appear and click "Create new library"
    // Increase timeout to allow menu animation to complete
    await expect(this.addLibraryMenuButton).toBeVisible({ timeout: 10000 });
    await this.addLibraryMenuButton.click();

    // Step 3: Wait for library creation modal to appear
    await expect(this.libraryNameInput).toBeVisible({ timeout: 5000 });

    // Step 4: Fill in library details
    await this.libraryNameInput.fill(library.name);
    
    if (library.description) {
      // Wait for description field to be visible
      await expect(this.libraryDescriptionInput).toBeVisible({ timeout: 3000 });
      await this.libraryDescriptionInput.fill(library.description);
    }

    // Step 5: Submit the form
    await this.submitButton.click();

    // Step 6: Wait for modal to close
    await expect(this.libraryNameInput).not.toBeVisible({ timeout: 10000 });
    await this.page.waitForLoadState('load', { timeout: 15000 });
    // Additional wait to ensure authorization checks are complete
    await this.page.waitForTimeout(1000);
  }

  /**
   * Create a folder directly under project (not in another folder)
   * This uses the sidebar add button -> AddLibraryMenu -> Create new folder flow
   * @param folder - Folder data with name
   */
  async createFolderUnderProject(folder: FolderData): Promise<void> {
    // Step 1: Click the sidebar add button (title="Add new folder or library")
    await expect(this.sidebarAddButton).toBeVisible({ timeout: 5000 });
    await this.sidebarAddButton.click();

    // Step 2: Wait for AddLibraryMenu to appear and click "Create new folder"
    // Increase timeout to allow menu animation to complete
    await expect(this.addFolderMenuButton).toBeVisible({ timeout: 10000 });
    await this.addFolderMenuButton.click();

    // Step 3: Wait for folder creation modal to appear
    await expect(this.folderNameInput).toBeVisible({ timeout: 5000 });

    // Step 4: Fill in folder name
    await this.folderNameInput.fill(folder.name);

    // Step 5: Submit the form
    await this.submitButton.click();

    // Step 6: Wait for modal to close
    await expect(this.folderNameInput).not.toBeVisible({ timeout: 10000 });
    await this.page.waitForLoadState('load', { timeout: 15000 });
    // Additional wait to ensure authorization checks are complete
    await this.page.waitForTimeout(1000);
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
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 });
  }

  /**
   * Click the predefine button for a library in the sidebar
   * @param libraryName - Name of the library
   */
  async clickPredefineButton(libraryName: string): Promise<void> {
    // Find the library item in the sidebar tree using title attribute (handles truncated names)
    const sidebar = this.page.getByRole('tree');
    const libraryItem = sidebar.locator(`[title="${libraryName}"]`);
    
    // The predefine button is in the same row as the library name
    // Find the button with aria-label="Library sections" that is near the library name
    // Strategy: Find the library row container, then find the predefine button within it
    const libraryRow = libraryItem.locator('..').locator('..'); // Navigate up to the library row container
    
    // Find the predefine button by aria-label
    const predefineButton = libraryRow
      .locator('button[aria-label="Library sections"]')
      .or(libraryRow.getByRole('button', { name: /library sections/i }));
    
    await expect(predefineButton).toBeVisible({ timeout: 5000 });
    await predefineButton.click();
    
    // Wait for navigation to predefine page
    // Use flexible URL matching (removed $ anchor to allow trailing slash/query params)
    // Increased timeout for CI environments where navigation may be slower
    await this.page.waitForURL(/\/predefine/, { timeout: 15000 });
    
    // Verify page content as additional check (more reliable than URL matching)
    const predefineHeading = this.page.getByRole('heading', { name: /predefine/i });
    await expect(predefineHeading).toBeVisible({ timeout: 5000 });
    
    await this.page.waitForLoadState('load', { timeout: 10000 });
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
      const match = currentUrl.match(/https?:\/\/[^/]+\/([^/]+)/);
      if (match && match[1]) {
        await this.page.goto(`/${match[1]}`);
      }
    }
    await this.page.waitForLoadState('load', { timeout: 10000 });
    
    // Wait for sidebar tree to be visible and interactive
    const sidebar = this.page.getByRole('tree');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    
    // Additional wait for tree content to render
    // In CI environments or after navigation, sidebar may need extra time to load libraries
    await this.page.waitForTimeout(3000);
    
    // console.log('[DEBUG] Navigated back to project, sidebar should be loaded');
  }

  /**
   * Navigate back to library page from predefine page
   * Note: In predefine page, sidebar doesn't show library tree, so we navigate via URL
   */
  async navigateBackToLibraryFromPredefine(): Promise<void> {
    // Extract projectId and libraryId from current URL
    // Expected URL format: /[projectId]/[libraryId]/predefine
    const currentUrl = this.page.url();
    const match = currentUrl.match(/\/([^/]+)\/([^/]+)\/predefine$/);
    
    if (match && match.length >= 3) {
      const projectId = match[1];
      const libraryId = match[2];
      await this.page.goto(`/${projectId}/${libraryId}`);
      await this.page.waitForLoadState('load', { timeout: 10000 });
    } else {
      throw new Error(`Unable to extract projectId and libraryId from URL: ${currentUrl}`);
    }
  }

  /**
   * Assert library exists in the current view
   * @param libraryName - Name of the library to verify
   */
  async expectLibraryExists(libraryName: string): Promise<void> {
    // Use title attribute to handle truncated names in sidebar
    const sidebar = this.page.getByRole('tree');
    const libraryItem = sidebar.locator(`[title="${libraryName}"]`);
    await expect(libraryItem).toBeVisible();
  }

  /**
   * Assert folder exists in the current view
   * @param folderName - Name of the folder to verify
   */
  async expectFolderExists(folderName: string): Promise<void> {
    // Locate folder in sidebar (tree) to avoid strict mode violation
    // Use title attribute to handle truncated names
    const sidebar = this.page.getByRole('tree');
    const folderItem = sidebar.locator(`[title="${folderName}"]`);
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
    await this.page.waitForLoadState('load', { timeout: 10000 });
  }

  /**
   * Assert successful folder creation
   */
  async expectFolderCreated(): Promise<void> {
    // Folder creation closes modal and refreshes the list
    // Wait for modal to close (folder name input should not be visible)
    await expect(this.folderNameInput).not.toBeVisible({ timeout: 10000 });
    // Wait for page to refresh
    await this.page.waitForLoadState('load', { timeout: 10000 });
  }

  /**
   * Delete a library by its name (from sidebar using context menu)
   * @param libraryName - Name of the library to delete
   */
  async deleteLibrary(libraryName: string): Promise<void> {
    // Wait for sidebar tree to be fully loaded
    const sidebar = this.page.getByRole('tree');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    
    // Additional wait for tree content to fully render
    await this.page.waitForTimeout(2000);
    
    // Debug: Log all text content in sidebar to help diagnose issues
    const sidebarText = await sidebar.textContent();
    // console.log(`[DEBUG] Sidebar content: ${sidebarText?.substring(0, 500)}...`);
    
    // Find the library in the sidebar tree using title attribute (handles truncated names)
    const libraryItem = sidebar.locator(`[title="${libraryName}"]`);
    
    // Check if library exists before trying to make it visible
    const libraryCount = await libraryItem.count();
    // console.log(`[DEBUG] Found ${libraryCount} instances of "${libraryName}" in sidebar`);
    
    // Wait for library to be visible
    await expect(libraryItem).toBeVisible({ timeout: 15000 });
    
    // Right-click on the library to open context menu
    await libraryItem.click({ button: 'right' });
    
    // Wait for context menu to appear
    const contextMenu = this.page.locator('[class*="contextMenu"]');
    await expect(contextMenu).toBeVisible({ timeout: 15000 });
    
    // Set up dialog handler BEFORE clicking delete
    this.page.once('dialog', async dialog => {
      await dialog.accept();
    });
    
    // Click the Delete button in the context menu
    const deleteButton = contextMenu.getByRole('button', { name: /^delete$/i })
      .or(contextMenu.locator('button[class*="deleteItem"]'));
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();
    
    // Wait for deletion to complete
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Assert library is deleted (not visible in sidebar)
   * @param libraryName - Name of the library to verify deletion
   */
  async expectLibraryDeleted(libraryName: string): Promise<void> {
    const sidebar = this.page.getByRole('tree');
    // Use title attribute to handle truncated names
    const libraryItem = sidebar.locator(`[title="${libraryName}"]`);
    await expect(libraryItem).not.toBeVisible({ timeout: 30000 });
  }

  /**
   * Delete a folder by its name (from sidebar using context menu)
   * @param folderName - Name of the folder to delete
   */
  async deleteFolder(folderName: string): Promise<void> {
    // Wait for sidebar tree to be fully loaded
    const sidebar = this.page.getByRole('tree');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    
    // Additional wait for tree content to fully render
    await this.page.waitForTimeout(1000);
    
    // Find the folder in the sidebar tree using title attribute (handles truncated names)
    const folderItem = sidebar.locator(`[title="${folderName}"]`);
    
    // Wait for folder to be visible
    await expect(folderItem).toBeVisible({ timeout: 15000 });
    
    // Right-click on the folder to open context menu
    await folderItem.click({ button: 'right' });
    
    // Wait for context menu to appear
    const contextMenu = this.page.locator('[class*="contextMenu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    
    // Set up dialog handler BEFORE clicking delete
    this.page.once('dialog', async dialog => {
      await dialog.accept();
    });
    
    // Click the Delete button in the context menu
    const deleteButton = contextMenu.getByRole('button', { name: /^delete$/i })
      .or(contextMenu.locator('button[class*="deleteItem"]'));
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();
    
    // Wait for deletion to complete
    await this.page.waitForTimeout(1000);
  }

  /**
   * Assert folder is deleted (not visible in sidebar)
   * @param folderName - Name of the folder to verify deletion
   */
  async expectFolderDeleted(folderName: string): Promise<void> {
    const sidebar = this.page.getByRole('tree');
    // Use title attribute to handle truncated names
    const folderItem = sidebar.locator(`[title="${folderName}"]`);
    await expect(folderItem).not.toBeVisible({ timeout: 15000 });
  }

  /**
   * Wait for libraries page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    // Project detail page doesn't have headings, wait for URL or toolbar/empty state
    // Wait for page to stabilize first
    await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    
    // Wait for either sidebar folder or empty state text
    // Note: Use sidebar.getByText to avoid strict mode violation (Resources Folder appears in both sidebar and folder card)
    // Don't use createLibraryButton here as it may not exist if folder is not expanded
    const sidebar = this.page.getByRole('tree');
    // await expect(
    //   sidebar.getByText(/resources folder/i)
    //     .or(this.page.getByText(/no folders or libraries/i))
    // ).toBeVisible({ timeout: 30000 });
    
    await this.page.waitForLoadState('load', { timeout: 15000 });
    
    // Additional wait to ensure authorization checks are complete
    await this.page.waitForTimeout(1000);
  }
}

