import { expect, type Page, type Locator } from '@playwright/test';

/**
 * User credentials interface for authentication operations
 */
export interface UserCredentials {
  email: string;
  password: string;
}

/**
 * Registration data interface extending UserCredentials
 */
export interface RegistrationData extends UserCredentials {
  username: string;
  confirmPassword: string;
}

/**
 * LoginPage - Page Object Model for the authentication page
 * 
 * This class encapsulates all interactions with the combined Login/Register page,
 * following Playwright best practices with stable selectors.
 */
export class LoginPage {
  readonly page: Page;

  // Login form elements
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;

  // Register form elements
  readonly usernameInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly registerButton: Locator;

  // Navigation elements
  readonly signUpNowButton: Locator;
  readonly loginNowButton: Locator;

  // Headings
  readonly loginHeading: Locator;
  readonly registerHeading: Locator;

  // Messages
  readonly successMessage: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;

    // Login form selectors using stable getByLabel and getByRole
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password', { exact: true });
    this.loginButton = page.getByRole('button', { name: 'Login', exact: true });

    // Register form selectors
    this.usernameInput = page.getByLabel('Username');
    this.confirmPasswordInput = page.getByLabel('Confirm Password');
    this.registerButton = page.getByRole('button', { name: 'Register', exact: true });

    // Navigation buttons between login/register views
    this.signUpNowButton = page.getByRole('button', { name: /sign up now/i });
    this.loginNowButton = page.getByRole('button', { name: /login now/i });

    // Headings to verify current view
    this.loginHeading = page.getByRole('heading', { name: /login/i });
    this.registerHeading = page.getByRole('heading', { name: /register/i });

    // Feedback messages
    this.successMessage = page.locator('[class*="success"]');
    this.errorMessage = page.locator('[class*="error"]');
  }

  /**
   * Navigate to the authentication page
   */
  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.loginHeading).toBeVisible();
  }

  /**
   * Switch from login view to register view
   */
  async switchToRegister(): Promise<void> {
    await this.signUpNowButton.click();
    await expect(this.registerHeading).toBeVisible();
  }

  /**
   * Switch from register view to login view
   */
  async switchToLogin(): Promise<void> {
    await this.loginNowButton.click();
    await expect(this.loginHeading).toBeVisible();
  }

  /**
   * Register a new user account
   * @param user - Registration data including email, username, password, and confirmPassword
   */
  async register(user: RegistrationData): Promise<void> {
    await this.emailInput.fill(user.email);
    await this.usernameInput.fill(user.username);
    await this.passwordInput.fill(user.password);
    await this.confirmPasswordInput.fill(user.confirmPassword);
    await this.registerButton.click();
  }

  /**
   * Login with existing user credentials
   * @param user - User credentials with email and password
   */
  async login(user: UserCredentials): Promise<void> {
    await this.emailInput.fill(user.email);
    await this.passwordInput.fill(user.password);
    await this.loginButton.click();
  }

  /**
   * Assert successful registration message is displayed
   */
  async expectRegistrationSuccess(): Promise<void> {
    await expect(this.successMessage).toContainText(/sign-up succeeded/i);
  }

  /**
   * Assert successful login message or redirect to dashboard
   */
  async expectLoginSuccess(): Promise<void> {
    // After successful login, user is redirected to the projects dashboard
    await expect(this.page.getByRole('heading', { name: /projects/i })).toBeVisible();
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
   * Check if login form is currently displayed
   */
  async isLoginViewVisible(): Promise<boolean> {
    return this.loginHeading.isVisible();
  }

  /**
   * Check if register form is currently displayed
   */
  async isRegisterViewVisible(): Promise<boolean> {
    return this.registerHeading.isVisible();
  }
}

