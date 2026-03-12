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
  
  // Folder page "Create Library" button (visible in folder preview page header)
  readonly folderPageCreateLibraryButton: Locator;
  
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
    
    // Sidebar "Create new library" button (on folder row in tree)
    // Button has aria-label="Create new library", no text content (icon only). Only visible for admin.
    this.createLibraryButton = page.getByRole('tree').getByRole('button', { name: /create new library/i }).first();
    
    // Folder page "Create Library" button in header (LibraryToolbar)
    // This button appears in the folder preview page header (LibraryToolbar component)
    // Strategy: Use getByLabel to find button with aria-label="Create Library"
    // Only the LibraryToolbar button has aria-label="Create Library"
    // The empty state button doesn't have aria-label, only text content
    this.folderPageCreateLibraryButton = page.getByLabel('Create Library');
    
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
   * Create a new library in the current folder context
   * Uses the "Create Library" button on the folder preview page
   * @param library - Library data with name and optional description
   */
  async createLibrary(library: LibraryData): Promise<void> {
    // Wait for the folder page "Create Library" button to be visible
    // This button appears in the folder preview page header
    await expect(this.folderPageCreateLibraryButton).toBeVisible({ timeout: 15000 });
    await this.folderPageCreateLibraryButton.click();

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
    // Note: This button is conditionally rendered only when userRole === 'admin'.
    // The user role is fetched asynchronously via /api/projects/{projectId}/role,
    // so we need a longer timeout to allow the API call to complete and the button to render.
    await expect(this.sidebarAddButton).toBeVisible({ timeout: 15000 });
    await this.sidebarAddButton.click();

    // Step 2: Wait for AddLibraryMenu to appear and click "Create new library"
    // Increase timeout to allow menu animation to complete
    await expect(this.addLibraryMenuButton).toBeVisible({ timeout: 10000 });
    await this.addLibraryMenuButton.click();

    // Step 3: Wait for library creation modal to appear
    await expect(this.libraryNameInput).toBeVisible({ timeout: 5000 });
    // Wait for any menu-close animation to finish before interacting with the modal
    await this.page.waitForTimeout(500);

    // Step 4: Fill in library details
    await this.libraryNameInput.fill(library.name);
    
    if (library.description) {
      // Wait for description field to be visible
      await expect(this.libraryDescriptionInput).toBeVisible({ timeout: 3000 });
      await this.libraryDescriptionInput.fill(library.description);
    }

    // Step 5: Submit the form (scope to the portal-rendered modal backdrop)
    // NewLibraryModal renders via createPortal to document.body with class*="backdrop"
    const newLibraryModal = this.page.locator('[class*="backdrop"]').filter({ has: this.page.locator('#library-name') });
    const createBtn = newLibraryModal.getByRole('button', { name: 'Create', exact: true });
    await expect(createBtn).toBeVisible({ timeout: 5000 });
    await expect(createBtn).toBeEnabled({ timeout: 5000 });
    await createBtn.click();

    // If the modal is still visible after a short wait, try clicking again (handles rare click interception)
    await this.page.waitForTimeout(1000);
    if (await this.libraryNameInput.isVisible()) {
      const retryBtn = newLibraryModal.getByRole('button', { name: 'Create', exact: true });
      if (await retryBtn.isVisible() && await retryBtn.isEnabled()) {
        await retryBtn.click();
      }
    }

    // Step 6: Wait for modal to close (increase timeout for slower API responses)
    await expect(this.libraryNameInput).not.toBeVisible({ timeout: 30000 });
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
    // Note: This button is conditionally rendered only when userRole === 'admin'.
    // The user role is fetched asynchronously via /api/projects/{projectId}/role,
    // so we need a longer timeout to allow the API call to complete and the button to render.
    await expect(this.sidebarAddButton).toBeVisible({ timeout: 15000 });
    await this.sidebarAddButton.click();

    // Step 2: Wait for AddLibraryMenu to appear and click "Create new folder"
    // Increase timeout to allow menu animation to complete
    await expect(this.addFolderMenuButton).toBeVisible({ timeout: 10000 });
    await this.addFolderMenuButton.click();

    // Step 3: Wait for folder creation modal to appear
    await expect(this.folderNameInput).toBeVisible({ timeout: 5000 });
    // Wait for any menu-close animation to finish before interacting with the modal
    await this.page.waitForTimeout(500);

    // Step 4: Fill in folder name
    await this.folderNameInput.fill(folder.name);

    // Step 5: Submit the form (scope to the portal-rendered modal backdrop)
    // NewFolderModal renders via createPortal to document.body with class*="backdrop"
    const folderModal = this.page.locator('[class*="backdrop"]').filter({ has: this.folderNameInput });
    const createBtn = folderModal.getByRole('button', { name: 'Create', exact: true });
    await expect(createBtn).toBeVisible({ timeout: 5000 });
    await expect(createBtn).toBeEnabled({ timeout: 5000 });
    await createBtn.click();

    // If the modal is still visible after a short wait, try clicking again (handles rare click interception)
    await this.page.waitForTimeout(1000);
    if (await this.folderNameInput.isVisible()) {
      const retryBtn = folderModal.getByRole('button', { name: 'Create', exact: true });
      if (await retryBtn.isVisible() && await retryBtn.isEnabled()) {
        await retryBtn.click();
      }
    }

    // Step 6: Wait for modal to close (increase timeout for slower API responses)
    await expect(this.folderNameInput).not.toBeVisible({ timeout: 30000 });
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
    // Do not depend on sidebar "Library sections" button (it may not exist in current UI/CI).
    // Ensure we are on target library page first, then navigate directly to /predefine.
    const sidebar = this.page.locator('aside');
    const targetLibraryItem = sidebar.locator(`[title="${libraryName}"]`).first();
    if (await targetLibraryItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await targetLibraryItem.click();
      await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    }

    const currentPath = new URL(this.page.url()).pathname;
    const match = currentPath.match(/^\/([^/]+)\/([^/]+)(?:\/.*)?$/);
    if (!match || !match[1] || !match[2]) {
      // One more attempt to land on library page via sidebar item.
      await expect(targetLibraryItem).toBeVisible({ timeout: 10000 });
      await targetLibraryItem.click();
      await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    }

    const normalizedPath = new URL(this.page.url()).pathname;
    const normalizedMatch = normalizedPath.match(/^\/([^/]+)\/([^/]+)(?:\/.*)?$/);
    if (!normalizedMatch || !normalizedMatch[1] || !normalizedMatch[2]) {
      throw new Error(`Unable to resolve project/library ids from URL before opening predefine: ${this.page.url()}`);
    }

    const projectId = normalizedMatch[1];
    const libraryId = normalizedMatch[2];
    await this.page.goto(`/${projectId}/${libraryId}/predefine`);
    
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
  async deleteLibrary(
    libraryName: string,
    options?: { deleteAllMatching?: boolean }
  ): Promise<void> {
    // Use aside container instead of strict tree visibility.
    // In some CI/headed runs, tree exists but may be temporarily hidden.
    const sidebar = this.page.locator('aside');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    
    // Additional wait for tree content to fully render
    await this.page.waitForTimeout(2000);

    const deleteAllMatching = options?.deleteAllMatching ?? false;

    const getVisibleLibraryItems = () => sidebar.locator(`[title="${libraryName}"]:visible`);

    // Delete one or all matching libraries (useful for CI environments with leftover seed data).
    while (true) {
      const libraryItem = getVisibleLibraryItems().first();
      const visibleCount = await getVisibleLibraryItems().count();
      if (visibleCount === 0) break;

      await expect(libraryItem).toBeVisible({ timeout: 15000 });

      // Right-click on the target library to open context menu
      await libraryItem.click({ button: 'right' });

      // Wait for context menu to appear
      const contextMenu = this.page.locator('[class*="contextMenu"]');
      await expect(contextMenu).toBeVisible({ timeout: 15000 });

      // Backward compatibility: accept native dialogs if any old flow still triggers them
      this.page.once('dialog', async dialog => {
        await dialog.accept();
      });

      // Click the Delete action in context menu
      const deleteButton = contextMenu
        .getByRole('button', { name: /^delete$/i })
        .or(contextMenu.locator('button[class*="deleteItem"]'));
      await expect(deleteButton).toBeVisible({ timeout: 5000 });
      await deleteButton.click();

      // Current app flow uses custom delete confirm dialog, click final "Delete" if present
      const confirmDeleteButton = this.page
        .locator('div[class*="confirmDialog"]')
        .getByRole('button', { name: /^delete$/i })
        .first();
      if (await confirmDeleteButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmDeleteButton.click();
      }

      // Wait until at least one matching item disappears
      await expect
        .poll(async () => await getVisibleLibraryItems().count(), { timeout: 30000 })
        .toBeLessThan(visibleCount);

      // Allow cache invalidation + rerender to settle
      await this.page.waitForLoadState('networkidle').catch(() => {});
      await this.page.waitForTimeout(500);

      if (!deleteAllMatching) break;
    }
  }

  /**
   * Assert library is deleted (not visible in sidebar)
   * @param libraryName - Name of the library to verify deletion
   */
  async expectLibraryDeleted(libraryName: string): Promise<void> {
    const sidebar = this.page.locator('aside');
    // Use title attribute to handle truncated names
    const libraryItem = sidebar.locator(`[title="${libraryName}"]`);
    await expect(libraryItem).not.toBeVisible({ timeout: 30000 });
  }

  /**
   * Delete a folder by its name (from sidebar using context menu)
   * @param folderName - Name of the folder to delete
   */
  async deleteFolder(
    folderName: string,
    options?: { deleteAllMatching?: boolean }
  ): Promise<void> {
    // Use aside container instead of strict tree visibility.
    const sidebar = this.page.locator('aside');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    
    // Additional wait for tree content to fully render
    await this.page.waitForTimeout(1000);

    const deleteAllMatching = options?.deleteAllMatching ?? false;
    const getVisibleFolderItems = () => sidebar.locator(`[title="${folderName}"]:visible`);

    while (true) {
      const folderItem = getVisibleFolderItems().first();
      const visibleCount = await getVisibleFolderItems().count();
      if (visibleCount === 0) break;

      await expect(folderItem).toBeVisible({ timeout: 15000 });

      // Right-click on the target folder to open context menu
      await folderItem.click({ button: 'right' });

      const contextMenu = this.page.locator('[class*="contextMenu"]');
      await expect(contextMenu).toBeVisible({ timeout: 5000 });

      // Backward compatibility for any native confirm flow
      this.page.once('dialog', async dialog => {
        await dialog.accept();
      });

      const deleteButton = contextMenu
        .getByRole('button', { name: /^delete$/i })
        .or(contextMenu.locator('button[class*="deleteItem"]'));
      await expect(deleteButton).toBeVisible({ timeout: 5000 });
      await deleteButton.click();

      // Current flow uses custom confirm dialog
      const confirmDeleteButton = this.page
        .locator('div[class*="confirmDialog"]')
        .getByRole('button', { name: /^delete$/i })
        .first();
      if (await confirmDeleteButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmDeleteButton.click();
      }

      await expect
        .poll(async () => await getVisibleFolderItems().count(), { timeout: 30000 })
        .toBeLessThan(visibleCount);

      await this.page.waitForLoadState('networkidle').catch(() => {});
      await this.page.waitForTimeout(500);

      if (!deleteAllMatching) break;
    }
  }

  /**
   * Assert folder is deleted (not visible in sidebar)
   * @param folderName - Name of the folder to verify deletion
   */
  async expectFolderDeleted(folderName: string): Promise<void> {
    const sidebar = this.page.locator('aside');
    // Use title attribute to handle truncated names
    const folderItem = sidebar.locator(`[title="${folderName}"]`);
    await expect(folderItem).not.toBeVisible({ timeout: 15000 });
  }

  /**
   * Wait for libraries page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await this.page.waitForLoadState('load', { timeout: 15000 });
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }
}

