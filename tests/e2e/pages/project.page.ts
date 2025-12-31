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
    const projectCard = this.page.getByRole('button', { name: projectName })
      .or(this.page.getByRole('link', { name: projectName }))
      .or(this.page.getByText(projectName, { exact: true }).first());

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
    const projectItem = this.page.getByText(projectName, { exact: true });
    await expect(projectItem).toBeVisible();
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
    return this.page.getByText(projectName, { exact: true });
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
   * Wait for projects page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    await expect(this.projectsHeading).toBeVisible();
    await this.page.waitForLoadState('networkidle');
  }
}

