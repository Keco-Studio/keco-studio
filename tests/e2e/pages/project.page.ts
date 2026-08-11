import { expect, type Page, type Locator } from '@playwright/test';
import type { ProjectData } from '../fixures/projects';
import { waitForSupabaseAuthStorage } from '../utils/auth-storage';

/**
 * ProjectPage - Page Object Model for Project management
 * 
 * Handles all interactions with the Projects list and project creation flow.
 * Entry point after successful login.
 */
export class ProjectPage {
  readonly page: Page;
  private lastCreatedProjectName: string | null = null;

  // Project list elements
  readonly projectsHeading: Locator;
  readonly createProjectButton: Locator;
  readonly projectList: Locator;

  // Project creation modal/form elements
  readonly projectNameInput: Locator;
  readonly projectDescriptionInput: Locator;
  readonly submitProjectButton: Locator;
  readonly cancelProjectButton: Locator;

  // Success/error feedback
  readonly successMessage: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;

    // Projects page has no "Projects" heading; it shows "Create first project" or project list.
    // Keep locator for tests that may check URL/other indicators; do not use for visibility.
    this.projectsHeading = page.getByRole('heading', { name: /projects/i });
    // Button text/accessible name varies:
    // - Empty state (main): "Create first project"
    // - Sidebar project selector: "Create new"
    // - Legacy: "New Project" / "Add project" / "Create Project"
    this.createProjectButton = page
      .getByTestId('project-selector-create')
      .or(
        page.getByRole('button', {
          name: /^(new project|create project|create first project|add project|create new)$/i,
        })
      );
    this.projectList = page.locator('[role="list"], [data-testid="project-list"]');

    // Project form inputs - using getByLabel for accessibility
    this.projectNameInput = page.getByLabel(/project name/i).or(page.locator('#project-name'));
    this.projectDescriptionInput = page.locator('#project-description')
      .or(page.getByLabel(/add notes|project description/i));
    
    // Form action buttons
    this.submitProjectButton = page.getByRole('button', { name: /^(create|creating|submit)$/i });
    this.cancelProjectButton = page.getByRole('button', { name: /cancel/i });

    // Feedback messages
    this.successMessage = page.locator('[class*="success"], [role="alert"]').filter({ hasText: /success/i });
    this.errorMessage = page.locator('[class*="error"], [role="alert"]').filter({ hasText: /error/i });
  }

  /**
   * Navigate to the projects page
   */
  async goto(): Promise<void> {
    await this.page.goto('/projects', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    // /projects may auto-redirect into the first project's Recent page when projects exist.
    await expect(
      this.page
        .getByTestId('project-selector-trigger')
        .or(this.createProjectButton.first())
        .first()
    ).toBeVisible({ timeout: 20000 });
    await this.page.waitForTimeout(1000);
  }

  private async openCreateProjectModal(): Promise<void> {
    const selectorTrigger = this.page.getByTestId('project-selector-trigger');
    const selectorCreate = this.page.getByTestId('project-selector-create');

    // Prefer the compact project selector (available after /projects auto-redirects to Recent).
    if (await selectorTrigger.isVisible({ timeout: 5000 }).catch(() => false)) {
      await selectorTrigger.click();
      await expect(selectorCreate).toBeVisible({ timeout: 10000 });
      await selectorCreate.click();
      return;
    }

    // Empty-state /projects page still exposes a dedicated create button.
    await expect(this.createProjectButton.first()).toBeVisible({ timeout: 25000 });
    await this.createProjectButton.first().click();
  }

  /**
   * Create a new project
   * @param project - Project data with name and optional description
   */
  async createProject(project: ProjectData): Promise<void> {
    // Verify authentication state before creating project
    // This prevents 401 errors in CI environments
    await waitForSupabaseAuthStorage(this.page, 15000);

    // Ensure sidebar/app shell is loaded. /projects redirects to /{id}/recent when projects exist.
    const currentUrl = this.page.url();
    if (!this.isProjectDetailPath(new URL(currentUrl).pathname) && !currentUrl.includes('/projects')) {
      await this.page.goto('/projects', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    } else {
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // Wait until either we stay on /projects (empty) or land in a project shell with the selector.
    await expect
      .poll(
        async () => {
          const pathname = new URL(this.page.url()).pathname;
          if (this.isProjectDetailPath(pathname)) return true;
          if (pathname.includes('/projects')) return true;
          return false;
        },
        { timeout: 20000, intervals: [300, 500, 1000] }
      )
      .toBe(true);

    await this.openCreateProjectModal();

    // Wait for modal to appear
    await expect(this.projectNameInput).toBeVisible({ timeout: 5000 });

    // Fill in project details and submit.
    // Re-query inputs/buttons each time to tolerate modal remounts in CI.
    const fillVisibleInputWithRetry = async (selector: string, value: string) => {
      let lastError: unknown = null;
      for (let i = 0; i < 3; i += 1) {
        try {
          const input = this.page.locator(`${selector}:visible`).first();
          await expect(input).toBeVisible({ timeout: 5000 });
          await input.click({ timeout: 3000 });
          await input.press('Control+a').catch(() => {});
          await input.fill(value, { timeout: 10000 });
          return;
        } catch (error) {
          lastError = error;
          await this.page.waitForTimeout(300);
        }
      }
      throw lastError;
    };

    this.lastCreatedProjectName = project.name;
    await fillVisibleInputWithRetry('#project-name', project.name);

    if (project.description) {
      const descriptionInput = this.page.locator('#project-description:visible').first();
      const hasDescriptionInput = await descriptionInput.isVisible({ timeout: 1500 }).catch(() => false);
      if (hasDescriptionInput) {
        await fillVisibleInputWithRetry('#project-description', project.description);
      }
    }

    const visibleProjectNameInput = this.page.locator('#project-name:visible').first();
    const modal = visibleProjectNameInput.locator('xpath=ancestor::div[contains(@class,"modal")][1]');
    const modalSubmitButton = modal
      .getByRole('button', { name: /^(create|creating)$/i })
      .or(modal.locator('button[class*="primary"]'));

    if (await modalSubmitButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await modalSubmitButton.click();
    } else {
      await visibleProjectNameInput.press('Enter');
    }

    // Success path: modal closes (no visible project-name input).
    await expect
      .poll(async () => await this.page.locator('#project-name:visible').count(), { timeout: 10000 })
      .toBe(0);
    
    // Wait for page to load
    await this.page.waitForLoadState('load', { timeout: 15000 });
    
    // Additional wait to ensure authorization checks are complete
    // In CI environments, Supabase auth state may take longer to stabilize
    await this.page.waitForTimeout(2000);
  }

  /**
   * Open an existing project by name via the sidebar project selector.
   */
  async openProject(projectName: string, timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? (process.env.CI === 'true' ? 45000 : 20000);

    if (!this.isProjectDetailPath(new URL(this.page.url()).pathname)) {
      await this.page.goto('/projects', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    const trigger = this.page.getByTestId('project-selector-trigger');
    await expect(trigger).toBeVisible({ timeout });
    await trigger.click();

    const option = this.page
      .getByRole('menuitemradio')
      .filter({ hasText: projectName })
      .first();
    await expect(option).toBeVisible({ timeout });
    await option.click();

    await expect
      .poll(() => this.isProjectDetailPath(new URL(this.page.url()).pathname), {
        timeout,
        intervals: [300, 500, 1000],
      })
      .toBe(true);

    await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  }

  /**
   * Assert project exists in the list
   * @param projectName - Name of the project to verify
   */
  async expectProjectExists(projectName: string): Promise<void> {
    const trigger = this.page.getByTestId('project-selector-trigger');
    await expect(trigger).toBeVisible({ timeout: 15000 });
    await trigger.click();
    const option = this.page.getByRole('menuitemradio').filter({ hasText: projectName }).first();
    await expect(option).toBeVisible({ timeout: 15000 });
    // Close menu without changing selection.
    await this.page.keyboard.press('Escape').catch(() => {});
  }

  private isProjectDetailPath(pathname: string): boolean {
    if (!pathname || pathname === '/') return false;
    const blockedPrefixes = [
      '/projects',
      '/script-system',
      '/simulation-system',
      '/accept-invitation',
      '/mcp',
      '/login',
      '/signup',
    ];
    if (blockedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return false;
    }
    // /{projectId} and nested studio routes such as /{projectId}/recent
    return /^\/[^/]+(\/.*)?$/.test(pathname);
  }

  /** Right-click a project row in the sidebar selector to open the context menu. */
  async rightClickSidebarProject(projectName: string): Promise<void> {
    const trigger = this.page.getByTestId('project-selector-trigger');
    await expect(trigger).toBeVisible({ timeout: 15000 });
    await trigger.click();
    const projectItem = this.page
      .getByRole('menuitemradio')
      .filter({ hasText: projectName })
      .first();
    await expect(projectItem).toBeVisible({ timeout: 15000 });
    await projectItem.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(300);
    await projectItem.click({ button: 'right', force: true, timeout: 15000 });
  }

  /**
   * Assert successful project creation
   */
  async expectProjectCreated(projectName?: string): Promise<void> {
    const timeout = process.env.CI === 'true' ? 45000 : 30000;
    const resolvedName = projectName ?? this.lastCreatedProjectName;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(1000, deadline - Date.now());

    // Project creation should navigate to /{projectId}/recent (or /{projectId}).
    // In CI, client routing can lag or bounce back to /projects while auth/collaborator rows settle.
    try {
      await this.page.waitForURL(
        (url) => this.isProjectDetailPath(url.pathname),
        { timeout: remainingMs(), waitUntil: 'commit' }
      );
    } catch {
      if (!resolvedName) {
        throw new Error('Project creation did not navigate away from /projects');
      }
      await this.openProject(resolvedName, remainingMs());
    }

    await expect
      .poll(() => this.isProjectDetailPath(new URL(this.page.url()).pathname), {
        timeout: remainingMs(),
        intervals: [300, 500, 1000],
      })
      .toBe(true);

    await this.page
      .waitForLoadState('domcontentloaded', { timeout: Math.min(10000, remainingMs()) })
      .catch(() => {});

    // Project page may briefly redirect back to /projects while data settles; re-open if needed.
    if (!this.isProjectDetailPath(new URL(this.page.url()).pathname) && resolvedName) {
      await this.openProject(resolvedName, remainingMs());
      await expect
        .poll(() => this.isProjectDetailPath(new URL(this.page.url()).pathname), {
          timeout: remainingMs(),
          intervals: [300, 500, 1000],
        })
        .toBe(true);
    }
  }

  /**
   * Get project by name for further interaction
   * @param projectName - Name of the project
   */
  getProjectByName(projectName: string): Locator {
    return this.page.getByRole('menuitemradio').filter({ hasText: projectName }).first();
  }

  /**
   * Assert error message is displayed
   * @param expectedText - Optional text to match in error message
   */
  async expectError(expectedText?: string | RegExp): Promise<void> {
    await expect(this.errorMessage).toBeVisible();
    if (expectedText) {
      await expect(this.errorMessage).toContainText(expectedText);
    }
  }

  /**
   * Delete a project by its name (from sidebar using context menu)
   * @param projectName - Name of the project to delete
   */
  async deleteProject(
    projectName: string,
    options?: { deleteAllMatching?: boolean }
  ): Promise<void> {
    const trigger = this.page.getByTestId('project-selector-trigger');
    await expect(trigger).toBeVisible({ timeout: 15000 });
    await this.page.waitForTimeout(1000);

    const deleteAllMatching = options?.deleteAllMatching ?? false;
    const getVisibleProjectItems = () =>
      this.page.getByRole('menuitemradio').filter({ hasText: projectName });

    while (true) {
      await trigger.click();
      const projectItem = getVisibleProjectItems().first();
      const visibleCount = await getVisibleProjectItems().count();
      if (visibleCount === 0) {
        await this.page.keyboard.press('Escape').catch(() => {});
        break;
      }

      await expect(projectItem).toBeVisible({ timeout: 15000 });
      await projectItem.click({ button: 'right' });

      const contextMenu = this.page.locator('[class*="contextMenu"]');
      await expect(contextMenu).toBeVisible({ timeout: 5000 });

      // Backward compatibility for native dialog based delete flows.
      this.page.once('dialog', async (dialog) => {
        await dialog.accept();
      });

      const deleteButton = contextMenu
        .getByRole('button', { name: /^delete$/i })
        .or(contextMenu.locator('button[class*="deleteItem"]'));
      await expect(deleteButton).toBeVisible({ timeout: 5000 });
      await deleteButton.click();

      // Current flow uses custom confirmation dialog.
      const confirmDeleteButton = this.page
        .locator('div[class*="confirmDialog"]')
        .getByRole('button', { name: /^delete$/i })
        .first();
      if (await confirmDeleteButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmDeleteButton.click();
      }

      await expect
        .poll(async () => {
          const open = await this.page.getByTestId('project-selector-create').isVisible().catch(() => false);
          if (!open) await trigger.click().catch(() => {});
          return getVisibleProjectItems().count();
        }, { timeout: 30000 })
        .toBeLessThan(visibleCount);

      await this.page.waitForLoadState('networkidle').catch(() => {});
      await this.page.waitForTimeout(500);

      if (!deleteAllMatching) break;
    }
  }

  /**
   * Assert project is deleted (not visible in sidebar)
   * @param projectName - Name of the project to verify deletion
   */
  async expectProjectDeleted(projectName: string): Promise<void> {
    const trigger = this.page.getByTestId('project-selector-trigger');
    await expect
      .poll(async () => {
        if (!(await trigger.isVisible().catch(() => false))) return 0;
        await trigger.click().catch(() => {});
        const count = await this.page
          .getByRole('menuitemradio')
          .filter({ hasText: projectName })
          .count();
        await this.page.keyboard.press('Escape').catch(() => {});
        return count;
      }, { timeout: 30000 })
      .toBe(0);
  }

  /**
   * Wait for projects page / project shell to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    await expect(
      this.page
        .getByTestId('project-selector-trigger')
        .or(this.createProjectButton.first())
        .first()
    ).toBeVisible({ timeout: 15000 });
    await this.page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
  }
}
