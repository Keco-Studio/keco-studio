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

    // Main projects page elements
    this.projectsHeading = page.getByRole('heading', { name: /projects/i });
    this.createProjectButton = page.getByRole('button', { name: /create project/i });
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
    await this.page.goto('/projects');
    await expect(this.projectsHeading).toBeVisible();
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

    // Click create project button
    await this.createProjectButton.click();

    // Wait for modal to appear
    await expect(this.projectNameInput).toBeVisible({ timeout: 5000 });

    // Fill in project details
    await this.projectNameInput.fill(project.name);
    
    if (project.description) {
      // Wait for description field to be visible and fill it
      await expect(this.projectDescriptionInput).toBeVisible({ timeout: 3000 });
      await this.projectDescriptionInput.fill(project.description);
    }

    // Submit the form
    await this.submitProjectButton.click();

    // Wait for modal to close and navigation to complete
    await expect(this.projectNameInput).not.toBeVisible({ timeout: 10000 });
    
    // Wait for network to be idle and all API calls to complete
    await this.page.waitForLoadState('networkidle', { timeout: 30000 });
    
    // Additional wait to ensure authorization checks are complete
    // In CI environments, Supabase auth state may take longer to stabilize
    await this.page.waitForTimeout(3000);
  }

  /**
   * Open an existing project by name
   * @param projectName - Name of the project to open
   */
  async openProject(projectName: string): Promise<void> {
    // Find and click the project by its name
    // Use title attribute for reliable matching (handles truncated names in sidebar)
    const sidebar = this.page.locator('aside');
    const projectByTitle = sidebar.locator(`[title="${projectName}"]`);
    const titleExists = await projectByTitle.count() > 0;
    
    let projectCard;
    if (titleExists) {
      // Found in sidebar by title attribute
      projectCard = projectByTitle.first();
    } else {
      // Try other strategies (for project cards in main content area)
      projectCard = this.page.getByRole('button', { name: projectName })
        .or(this.page.getByRole('link', { name: projectName }))
        .or(this.page.getByText(projectName).first());
    }

    await expect(projectCard).toBeVisible();
    await projectCard.click();

    // Wait for navigation to project detail page
    await this.page.waitForLoadState('networkidle');
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

  /**
   * Assert successful project creation
   */
  async expectProjectCreated(): Promise<void> {
    // Project creation navigates to /{projectId} page
    // Wait for URL to change from /projects to a project detail page
    await this.page.waitForURL((url) => {
      const path = url.pathname;
      // Match pattern: /{projectId} (not /projects)
      return path !== '/projects' && /^\/[^\/]+$/.test(path);
    }, { timeout: 30000 });
    
    // Wait for page to stabilize and all API calls to complete
    // This is important after adding authorization checks
    await this.page.waitForLoadState('networkidle', { timeout: 30000 });
    
    // Additional wait to ensure authorization checks are complete
    // In CI environments, Supabase auth state may take longer to stabilize
    await this.page.waitForTimeout(2000);
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
  async deleteProject(projectName: string): Promise<void> {
    // Find the project in the sidebar
    // Note: Project names may be truncated in display, but full name is in title attribute
    const sidebar = this.page.locator('aside');
    
    // Strategy 1: Try to find by title attribute (contains full name)
    const projectByTitle = sidebar.locator(`[title="${projectName}"]`);
    const titleExists = await projectByTitle.count() > 0;
    
    let projectItem;
    if (titleExists) {
      // Use title attribute (most reliable for truncated names)
      projectItem = projectByTitle.first();
    } else {
      // Strategy 2: Use partial text match (without exact: true)
      projectItem = sidebar.getByText(projectName);
    }
    
    // Wait for project to be visible
    await expect(projectItem).toBeVisible({ timeout: 5000 });
    
    // Right-click on the project to open context menu
    await projectItem.click({ button: 'right' });
    
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
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Assert project is deleted (not visible in sidebar)
   * @param projectName - Name of the project to verify deletion
   */
  async expectProjectDeleted(projectName: string): Promise<void> {
    const sidebar = this.page.locator('aside');
    
    // Check by title attribute (more reliable for truncated names)
    const projectByTitle = sidebar.locator(`[title="${projectName}"]`);
    await expect(projectByTitle).not.toBeVisible({ timeout: 5000 });
    
    // Also check by partial text match as a backup
    const projectByText = sidebar.getByText(projectName);
    await expect(projectByText).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Wait for projects page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    await expect(this.projectsHeading).toBeVisible();
    await this.page.waitForLoadState('networkidle');
  }
}

