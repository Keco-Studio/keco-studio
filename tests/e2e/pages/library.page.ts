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
  private lastCreatedLibraryName: string | null = null;

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

  private isProjectScopedPath(pathname: string): boolean {
    if (pathname === '/projects' || pathname === '/' || pathname.startsWith('/auth')) {
      return false;
    }
    // /{projectId} and nested routes such as /{projectId}/{libraryId}
    return /^\/[^/]+(\/.*)?$/.test(pathname);
  }

  private async waitForSidebarAdminRole(): Promise<void> {
    const roleTimeout = process.env.CI === 'true' ? 30000 : 20000;

    await expect
      .poll(() => this.isProjectScopedPath(new URL(this.page.url()).pathname), {
        timeout: roleTimeout,
        intervals: [300, 500, 1000, 2000],
      })
      .toBe(true);

    await expect(this.sidebarAddButton).toBeVisible({ timeout: roleTimeout });
  }

  /** Right-click a sidebar tree row (library or folder) to open the context menu. */
  async rightClickTreeItem(title: string): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const sidebar = this.page.getByRole('tree');
    await expect(sidebar).toBeVisible({ timeout: 15000 });
    const item = sidebar.locator(`[title="${title}"]`).first();
    await expect(item).toBeVisible({ timeout: 15000 });
    await item.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(300);
    await item.click({ button: 'right', force: true, timeout: 15000 });
  }

  /** Start inline rename from the sidebar context menu (Library info / Rename). */
  async openInlineRename(
    title: string,
    menuAction: RegExp = /^library info$|^rename$/i
  ): Promise<Locator> {
    await this.rightClickTreeItem(title);
    const contextMenu = this.page.locator('[class*="contextMenu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    await contextMenu.getByRole('button', { name: menuAction }).click();
    const renameInput = this.page.getByRole('tree').getByRole('textbox', { name: 'Rename' });
    await expect(renameInput).toBeVisible({ timeout: 5000 });
    return renameInput;
  }

  renameInput(): Locator {
    return this.page.getByRole('tree').getByRole('textbox', { name: 'Rename' });
  }

  constructor(page: Page) {
    this.page = page;

    // Page headings
    this.foldersHeading = page.getByRole('heading', { name: /folders/i });
    this.librariesHeading = page.getByRole('heading', { name: /libraries/i });

    // Action buttons
    this.createFolderButton = page.getByRole('button', { name: /create folder/i });

    // Sidebar folder "+" opens Folder actions menu (icon only).
    this.createLibraryButton = page.getByRole('tree').getByRole('button', { name: /folder actions/i }).first();

    // Folder pages expose the action either in the toolbar or in the empty state.
    this.folderPageCreateLibraryButton = page
      .getByRole('button', { name: 'Create Library', exact: true })
      .first();

    // Sidebar add button (for creating library/folder directly under project)
    this.sidebarAddButton = page.locator('button[title="Add new folder or library"]')
      .or(page.getByRole('button', { name: /add/i }).filter({ has: page.locator('img[alt="Add library"]') }));

    // AddLibraryMenu button (appears after clicking sidebar add button)
    // Note: AddLibraryMenu is rendered via createPortal to document.body
    // Use more flexible selectors that work with the portal
    // Label reads "Create new table" (still creates a library record under the hood).
    this.addLibraryMenuButton = page.getByRole('button', { name: /create new table/i })
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
    const sidebarTree = this.page.getByRole('tree');
    const folderLabel = sidebarTree.locator(`[title="${folderName}"]`).first();
    const folderTreeItem = sidebarTree
      .getByRole('treeitem')
      .filter({ has: this.page.locator(`[title="${folderName}"]`) })
      .first();

    await expect(folderLabel).toBeVisible({ timeout: 15000 });
    await expect(folderTreeItem).toBeVisible({ timeout: 15000 });
    await folderTreeItem.click();

    await this.page.waitForURL(/\/folder\/[^/]+$/, { timeout: 15000 });
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

    // Submit the form (scope to the modal to avoid stale element references)
    const folderModal = this.page.locator('[class*="backdrop"]').filter({ has: this.folderNameInput });
    const createBtn = folderModal.getByRole('button', { name: 'Create', exact: true });
    await expect(createBtn).toBeVisible({ timeout: 5000 });
    await expect(createBtn).toBeEnabled({ timeout: 5000 });
    await createBtn.click();

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
    this.lastCreatedLibraryName = library.name;
    await this.libraryNameInput.fill(library.name);

    if (library.description) {
      // Wait for description field to be visible
      await expect(this.libraryDescriptionInput).toBeVisible({ timeout: 3000 });
      await this.libraryDescriptionInput.fill(library.description);
    }

    // Submit the form using the generic submit button
    // Use force: true because React may re-render the button during form state changes
    await expect(this.submitButton).toBeVisible({ timeout: 5000 });
    await expect(this.submitButton).toBeEnabled({ timeout: 5000 });
    await this.submitButton.click({ force: true });

    // Wait for modal to close
    await expect(this.libraryNameInput).not.toBeVisible({ timeout: 10000 });
    await this.page.waitForLoadState('load', { timeout: 15000 });
    // Additional wait to ensure authorization checks are complete
    await this.page.waitForTimeout(1000);
  }

  /**
   * Create a library directly under project (not in a folder)
   * This uses the sidebar add button -> AddLibraryMenu -> Create new table flow
   * @param library - Library data with name and optional description
   */
  async createLibraryUnderProject(library: LibraryData): Promise<void> {
    // Step 1: Click the sidebar add button (title="Add new folder or library")
    // Note: This button is conditionally rendered only when userRole === 'admin'.
    // The user role is fetched asynchronously via /api/projects/{projectId}/role,
    // so we need a longer timeout to allow the API call to complete and the button to render.
    await this.waitForSidebarAdminRole();
    await this.sidebarAddButton.click();

    // Step 2: Wait for AddLibraryMenu to appear and click "Create new table"
    // Increase timeout to allow menu animation to complete
    await expect(this.addLibraryMenuButton).toBeVisible({ timeout: 10000 });
    await this.addLibraryMenuButton.click();

    // Step 3: Wait for library creation modal to appear
    await expect(this.libraryNameInput).toBeVisible({ timeout: 5000 });
    // Wait for any menu-close animation to finish before interacting with the modal
    await this.page.waitForTimeout(500);

    // Step 4: Fill in library details
    this.lastCreatedLibraryName = library.name;
    await this.libraryNameInput.fill(library.name);

    if (library.description) {
      // Wait for description field to be visible
      await expect(this.libraryDescriptionInput).toBeVisible({ timeout: 3000 });
      await this.libraryDescriptionInput.fill(library.description);
    }

    // Step 5: Submit the form using the portal modal button
    // Use force: true because React may re-render the button during form state changes
    const newLibraryModal = this.page.locator('[class*="backdrop"]').filter({ has: this.page.locator('#library-name') });
    const createBtn = newLibraryModal.getByRole('button', { name: 'Create', exact: true });
    await expect(createBtn).toBeVisible({ timeout: 5000 });
    await expect(createBtn).toBeEnabled({ timeout: 5000 });
    await createBtn.click({ force: true });

    // If the modal is still visible after a short wait, try clicking again (handles rare click interception)
    await this.page.waitForTimeout(1000);
    if (await this.libraryNameInput.isVisible()) {
      const retryBtn = newLibraryModal.getByRole('button', { name: 'Create', exact: true });
      if (await retryBtn.isVisible() && await retryBtn.isEnabled()) {
        await retryBtn.click({ force: true });
      }
    }

    // Step 6: Wait for creation to settle.
    // In CI, modal close can lag behind data refresh, so treat either signal as success:
    // 1) create modal closes, or 2) target library appears in sidebar.
    const sidebar = this.page.locator('aside');
    const createdLibraryInSidebar = sidebar.locator(`[title="${library.name}"]:visible`);
    await expect
      .poll(
        async () => {
          const modalVisible = await this.page.locator('#library-name:visible').count();
          const libraryVisible = await createdLibraryInSidebar.count();
          return modalVisible === 0 || libraryVisible > 0;
        },
        { timeout: 45000 }
      )
      .toBeTruthy();

    await this.page.waitForLoadState('load', { timeout: 15000 }).catch(() => { });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
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
    await this.waitForSidebarAdminRole();
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

    // Step 5: Submit the form using the generic submit button
    // Use force: true because React may re-render the button during form state changes
    await expect(this.submitButton).toBeVisible({ timeout: 5000 });
    await expect(this.submitButton).toBeEnabled({ timeout: 5000 });
    await this.submitButton.click({ force: true });

    // If the modal is still visible after a short wait, try clicking again (handles rare click interception)
    await this.page.waitForTimeout(1000);
    if (await this.folderNameInput.isVisible()) {
      const retryBtn = this.submitButton;
      if (await retryBtn.isVisible() && await retryBtn.isEnabled()) {
        await retryBtn.click({ force: true });
      }
    }

    // Step 6: Wait for creation to settle.
    // In CI, modal close can lag behind data refresh, so treat either signal as success:
    // 1) create modal closes, or 2) target folder appears in sidebar.
    const sidebar = this.page.locator('aside');
    const createdFolderInSidebar = sidebar.locator(`[title="${folder.name}"]:visible`);
    await expect
      .poll(
        async () => {
          const modalVisible = await this.page.locator('[placeholder="Enter folder name"]:visible').count();
          const folderVisible = await createdFolderInSidebar.count();
          return modalVisible === 0 || folderVisible > 0;
        },
        { timeout: 45000 }
      )
      .toBeTruthy();

    // If modal/backdrop is still present after data appears, close it explicitly.
    // Otherwise it can intercept subsequent clicks in CI/headed runs.
    const stillVisibleModalInput = this.page.locator('[placeholder="Enter folder name"]:visible').first();
    if (await stillVisibleModalInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      const modal = this.page.locator('[class*="backdrop"]').filter({ has: stillVisibleModalInput }).first();
      const closeButton = modal.locator('button[aria-label="Close"]').first();
      if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await closeButton.click();
      } else {
        await this.page.keyboard.press('Escape').catch(() => { });
      }
      await expect(this.page.locator('[placeholder="Enter folder name"]:visible')).toHaveCount(0, {
        timeout: 10000,
      });
    }

    await this.page.waitForLoadState('load', { timeout: 15000 }).catch(() => { });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
    // Additional wait to ensure authorization checks are complete
    await this.page.waitForTimeout(1000);
  }

  /**
   * Open an existing library by name
   * @param libraryName - Name of the library to open
   */
  async openLibrary(libraryName: string): Promise<void> {
    // Prefer sidebar tree item by title attribute (avoids clicking disabled breadcrumb buttons).
    const sidebarLibraryItem = this.page.locator('aside').locator(`[title="${libraryName}"]`).first();
    const sidebarVisible = await sidebarLibraryItem.isVisible({ timeout: 3000 }).catch(() => false);
    if (sidebarVisible) {
      await sidebarLibraryItem.click();
    } else {
      // Fallback for pages where sidebar item isn't present yet.
      const libraryCard = this.page
        .getByRole('button', { name: libraryName })
        .or(this.page.getByRole('link', { name: libraryName }))
        .or(this.page.getByText(libraryName, { exact: true }).first());
      await expect(libraryCard).toBeVisible({ timeout: 5000 });
      await libraryCard.click();
    }

    // Wait for navigation to library detail page
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 });
  }

  /**
   * Open current schema entry (table header right-side "+" button) for a library.
   * This replaces the old direct `/predefine` route entry.
   * @param libraryName - Name of the library
   */
  async clickPredefineButton(libraryName: string): Promise<void> {
    await this.openLibrary(libraryName);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });

    const addColumnButton = this.page.getByRole('button', { name: /add new column/i });
    await expect(addColumnButton).toBeVisible({ timeout: 15000 });
    await addColumnButton.click();

    const addModal = this.page
      .locator('[class*="popup"]')
      .filter({ has: this.page.getByRole('heading', { name: /add column/i }) })
      .first();
    await expect(addModal).toBeVisible({ timeout: 5000 });
  }

  /**
   * Add a column using the table right-side "+" (schema entry) flow.
   * @param libraryName - Name of the target library
   * @param columnName - New column name
   * @param dataTypeLabel - Data type label shown in dropdown, e.g. "String"
   */
  async addColumnFromTableSchemaEntry(
    libraryName: string,
    columnName: string,
    dataTypeLabel: string,
  ): Promise<void> {
    await this.clickPredefineButton(libraryName);

    const addModal = this.page
      .locator('[class*="popup"]')
      .filter({ has: this.page.getByRole('heading', { name: /add column/i }) })
      .first();
    await expect(addModal).toBeVisible({ timeout: 5000 });

    await addModal.locator('#add-column-name').fill(columnName);
    await addModal.locator('#add-column-type').click();

    const dropdown = this.page.locator('[class*="dataTypeDropdown"]').last();
    const searchInput = dropdown.locator('input[placeholder="Search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill(dataTypeLabel);

    const option = this.page
      .locator('.ant-select-item-option')
      .filter({ hasText: new RegExp(dataTypeLabel, 'i') })
      .first();
    await expect(option).toBeVisible({ timeout: 10000 });
    await option.click();

    await addModal.getByRole('button', { name: /^add$/i }).click();
    await expect(addModal).not.toBeVisible({ timeout: 10000 });
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
    // Use aside locator to find sidebar, then use title attribute to handle truncated names
    const sidebar = this.page.locator('aside');
    const libraryItem = sidebar.locator(`[title="${libraryName}"]`);
    await expect(libraryItem).toBeVisible({ timeout: 10000 });
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
    // In CI, modal close animation/API completion can lag.
    // Treat either signal as success:
    // 1) create modal closes, or 2) created library appears in sidebar.
    const sidebar = this.page.locator('aside');
    const createdLibraryInSidebar = this.lastCreatedLibraryName
      ? sidebar.locator(`[title="${this.lastCreatedLibraryName}"]:visible`)
      : sidebar.locator('[title]:visible');

    await expect
      .poll(
        async () => {
          const modalVisible = await this.page.locator('#library-name:visible').count();
          const libraryVisible = await createdLibraryInSidebar.count();
          return modalVisible === 0 || libraryVisible > 0;
        },
        { timeout: 30000 }
      )
      .toBeTruthy();

    // If modal/backdrop is still present after data appears, close it explicitly.
    // Otherwise it can intercept subsequent sidebar clicks in CI.
    const stillVisibleModalInput = this.page.locator('#library-name:visible').first();
    if (await stillVisibleModalInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      const modal = this.page.locator('[class*="backdrop"]').filter({ has: this.page.locator('#library-name:visible') }).first();
      const closeButton = modal.locator('button[aria-label="Close"]').first();
      if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await closeButton.click();
      } else {
        await this.page.keyboard.press('Escape').catch(() => { });
      }
      await expect(this.page.locator('#library-name:visible')).toHaveCount(0, { timeout: 10000 });
    }

    // Wait for page to refresh
    await this.page.waitForLoadState('load', { timeout: 10000 }).catch(() => { });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
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
      await this.page.waitForLoadState('networkidle').catch(() => { });
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

      await this.page.waitForLoadState('networkidle').catch(() => { });
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
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
  }

  /**
   * Open the library Version Control sidebar.
   * Uses discrete open attempts (not rapid toggle retries) because the TopBar
   * control toggles open/closed — re-clicking while opening closes it again.
   */
  async openVersionControlSidebar(): Promise<void> {
    const toggle = this.page.getByTestId('library-version-control-toggle');
    const sidebar = this.page.getByTestId('library-version-history-sidebar');

    await expect(toggle).toBeVisible({ timeout: 15000 });

    if (await sidebar.isVisible().catch(() => false)) {
      await expect(sidebar.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      return;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      if (await sidebar.isVisible().catch(() => false)) break;
      await toggle.click({ force: true });
      try {
        await expect(sidebar).toBeVisible({ timeout: 5000 });
        break;
      } catch {
        // Click may have been a no-op (listener not ready) or a close from a prior open.
        await this.page.waitForTimeout(400);
      }
    }

    await expect(sidebar).toBeVisible({ timeout: 10000 });
    await expect(sidebar.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
  }
}
