import { expect, type Page, type Locator } from '@playwright/test';
import type { ProjectData } from '../fixures/projects';

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
    // - Sidebar when empty: "Create Project" (span text)
    // - Sidebar when has projects: icon button title="New Project", accessible name from img alt="Add project"
    this.createProjectButton = page.getByRole('button', { 
      name: /^(new project|create project|create first project|add project)$/i 
    });
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
    // Projects page has no "Projects" heading; wait for create button (may show "Loading projects..." first)
    await expect(this.createProjectButton.first()).toBeVisible({ timeout: 20000 });
    await this.page.waitForTimeout(1000);
  }

  /**
   * Create a new project
   * @param project - Project data with name and optional description
   */
  async createProject(project: ProjectData): Promise<void> {
    // Verify authentication state before creating project
    // This prevents 401 errors in CI environments
    await this.page.waitForFunction(
      () => {
        try {
          const keys = Object.keys(sessionStorage);
          for (const key of keys) {
            if (key.includes('sb-') && key.includes('auth-token')) {
              const value = sessionStorage.getItem(key);
              if (value && value.length > 10) {
                return true;
              }
            }
          }
          return false;
        } catch {
          return false;
        }
      },
      { timeout: 15000 }
    );

    // Always navigate to /projects page to ensure we're in the right place
    // After login, user might be redirected to a project detail page, so we need to go to projects list
    const currentUrl = this.page.url();
    if (!currentUrl.includes('/projects')) {
      await this.page.goto('/projects', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    } else {
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // Ensure we're on /projects (wait for URL in case of redirect)
    await this.page.waitForURL(/\/projects/, { timeout: 15000 }).catch(() => {});
    // Projects page: wait for create button (may show "Loading projects..." first; sidebar uses "Add project" when has projects)
    await expect(this.createProjectButton.first()).toBeVisible({ timeout: 25000 });
    await this.page.waitForTimeout(1000);

    // Click the first visible create project button
    await this.createProjectButton.first().click();

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
   * Open an existing project by name.
   * Polls the sidebar until the project row appears (list refresh can lag in CI).
   */
  async openProject(projectName: string, timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? (process.env.CI === 'true' ? 45000 : 20000);
    const sidebar = this.page.locator('aside');
    const projectByTitle = sidebar.locator(`[title="${projectName}"]`).first();

    // Ensure projects list is reachable when creation bounced back to /projects.
    if (!this.isProjectDetailPath(new URL(this.page.url()).pathname)) {
      await this.page.goto('/projects', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }

    let foundInSidebar = false;
    try {
      await expect
        .poll(
          async () => {
            if ((await projectByTitle.count()) === 0) return false;
            await projectByTitle.scrollIntoViewIfNeeded().catch(() => {});
            return projectByTitle.isVisible().catch(() => false);
          },
          { timeout, intervals: [500, 1000, 2000] }
        )
        .toBe(true);
      foundInSidebar = true;
    } catch {
      foundInSidebar = false;
    }

    if (foundInSidebar) {
      await projectByTitle.click();
    } else {
      const projectCard = this.page
        .getByRole('button', { name: projectName })
        .or(this.page.getByRole('link', { name: projectName }))
        .or(this.page.getByText(projectName, { exact: true }).first());
      await expect(projectCard).toBeVisible({ timeout: Math.min(timeout, 15000) });
      await projectCard.click();
    }

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
    // Use title attribute for reliable matching (handles truncated names)
    const sidebar = this.page.locator('aside');
    const projectByTitle = sidebar.locator(`[title="${projectName}"]`);
    await expect(projectByTitle).toBeVisible();
  }

  private isProjectDetailPath(pathname: string): boolean {
    return pathname !== '/projects' && /^\/[^\/]+$/.test(pathname);
  }

  /** Right-click a project row in the sidebar to open the context menu. */
  async rightClickSidebarProject(projectName: string): Promise<void> {
    const sidebar = this.page.locator('aside');
    const projectItem = sidebar.locator(`[title="${projectName}"]`).first();
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

    // Project creation should navigate to /{projectId}. In CI, client routing can lag or bounce
    // back to /projects while auth/collaborator rows settle.
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
    // Use title attribute for reliable matching (handles truncated names)
    const sidebar = this.page.locator('aside');
    return sidebar.locator(`[title="${projectName}"]`).first();
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
    const sidebar = this.page.locator('aside');
    await expect(sidebar).toBeVisible({ timeout: 15000 });
    await this.page.waitForTimeout(1000);

    const deleteAllMatching = options?.deleteAllMatching ?? false;
    const getVisibleProjectItems = () => sidebar.locator(`[title="${projectName}"]:visible`);

    while (true) {
      const projectItem = getVisibleProjectItems().first();
      const visibleCount = await getVisibleProjectItems().count();
      if (visibleCount === 0) break;

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
        .poll(async () => await getVisibleProjectItems().count(), { timeout: 30000 })
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
    const sidebar = this.page.locator('aside');
    const getVisibleProjectItems = () => sidebar.locator(`[title="${projectName}"]:visible`);

    await expect
      .poll(async () => await getVisibleProjectItems().count(), { timeout: 30000 })
      .toBe(0);
  }

  /**
   * Wait for projects page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForURL(/\/projects/, { timeout: 10000 });
    await expect(this.createProjectButton.first()).toBeVisible({ timeout: 15000 });
    await this.page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
  }
}

