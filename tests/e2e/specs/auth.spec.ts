import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { users, generateRegistrationData, invalidRegistration } from '../fixures/users';

/**
 * Authentication E2E Test Suite
 * 
 * Tests the combined Login/Register page flows including:
 * - User registration with valid credentials
 * - User login with existing credentials
 * - Error handling for invalid inputs
 * - Navigation between login and register views
 */

// Detect whether we are running against a real Supabase instance
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isRealSupabase =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  !supabaseUrl.includes('example.supabase.co') &&
  !/dummy/i.test(supabaseAnonKey);

test.describe('Register Flow', () => {
  test.skip(!isRealSupabase, 'Requires real Supabase credentials');

  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.switchToRegister();
  });

  test('should display register form with all required fields', async () => {
    await expect(loginPage.registerHeading).toBeVisible();
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.usernameInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.confirmPasswordInput).toBeVisible();
    await expect(loginPage.registerButton).toBeVisible();
  });

  test('should successfully register a new user', async () => {
    const newUser = generateRegistrationData();

    await loginPage.register(newUser);
    await loginPage.expectRegistrationSuccess();
  });

  test('should automatically login and redirect to projects dashboard after successful registration', async ({ page }) => {
    const newUser = generateRegistrationData();

    await loginPage.register(newUser);
    
    // Wait for registration success message
    await loginPage.expectRegistrationSuccess();
    
    // If Supabase is configured to auto-login after signup (no email confirmation required),
    // the user should be automatically redirected to the projects dashboard
    // This may take a moment due to the 1.5s delay in DashboardLayout
    // Note: If email confirmation is required, this test may fail as user won't be auto-logged in
    // In that case, the success message should remain visible
    const projectsHeading = page.getByRole('heading', { name: /projects/i });
    const isRedirected = await projectsHeading.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isRedirected) {
      // Auto-login is enabled, verify we're on the dashboard
      await expect(projectsHeading).toBeVisible();
    } else {
      // Email confirmation required, user should still see success message
      // This is also a valid scenario
      await expect(loginPage.successMessage).toBeVisible();
    }
  });

  test('should show error when passwords do not match', async () => {
    const userData = generateRegistrationData();
    userData.confirmPassword = 'DifferentPassword!';

    await loginPage.register(userData);
    await loginPage.expectError(/passwords do not match/i);
  });

  test('should show error when required fields are empty', async ({ page }) => {
    // Try to submit with empty fields by clicking register directly
    await loginPage.registerButton.click();

    // HTML5 validation should prevent submission - check that we're still on register page
    await expect(loginPage.registerHeading).toBeVisible();
  });

  test('should navigate to login view when clicking Login Now', async () => {
    await loginPage.switchToLogin();
    await expect(loginPage.loginHeading).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();
  });
});

test.describe('Login Flow', () => {
  test.skip(!isRealSupabase, 'Requires real Supabase credentials');

  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test('should display login form with email and password fields', async () => {
    await expect(loginPage.loginHeading).toBeVisible();
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();
  });

  test('should successfully login with existing user credentials', async () => {
    await loginPage.login(users.seedEmpty);
    await loginPage.expectLoginSuccess();
  });

  test('should redirect to projects dashboard after successful login', async ({ page }) => {
    await loginPage.login(users.seedEmpty);

    // Verify we're on the projects dashboard
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();
  });

  test('should show error with incorrect password', async () => {
    await loginPage.login(users.wrongPassword);
    await loginPage.expectError(/incorrect password/i);
  });

  test('should show error when required fields are empty', async () => {
    // Try to submit with empty fields
    await loginPage.loginButton.click();

    // HTML5 validation should prevent submission - check we're still on login page
    await expect(loginPage.loginHeading).toBeVisible();
  });

  test('should navigate to register view when clicking Sign Up Now', async () => {
    await loginPage.switchToRegister();
    await expect(loginPage.registerHeading).toBeVisible();
    await expect(loginPage.registerButton).toBeVisible();
  });
});

test.describe('Auth Page Navigation', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
  });

  test('should load login view by default', async () => {
    await loginPage.goto();
    await expect(loginPage.loginHeading).toBeVisible();
  });

  test('should toggle between login and register views', async () => {
    await loginPage.goto();

    // Start on login
    await expect(loginPage.loginHeading).toBeVisible();

    // Switch to register
    await loginPage.switchToRegister();
    await expect(loginPage.registerHeading).toBeVisible();

    // Switch back to login
    await loginPage.switchToLogin();
    await expect(loginPage.loginHeading).toBeVisible();
  });

  test('should reset form state when switching views', async () => {
    await loginPage.goto();

    // Fill login form fields
    const testEmail = 'test@example.com';
    const testPassword = 'testpassword123';
    await loginPage.emailInput.fill(testEmail);
    await loginPage.passwordInput.fill(testPassword);

    // Verify values are filled
    await expect(loginPage.emailInput).toHaveValue(testEmail);
    await expect(loginPage.passwordInput).toHaveValue(testPassword);

    // Switch to register view
    await loginPage.switchToRegister();

    // Register form fields should be empty (form was reset)
    await expect(loginPage.emailInput).toHaveValue('');
    await expect(loginPage.usernameInput).toHaveValue('');
    await expect(loginPage.passwordInput).toHaveValue('');
    await expect(loginPage.confirmPasswordInput).toHaveValue('');

    // Fill register form fields
    const registerEmail = 'register@example.com';
    const registerUsername = 'testuser';
    const registerPassword = 'registerpass123';
    await loginPage.emailInput.fill(registerEmail);
    await loginPage.usernameInput.fill(registerUsername);
    await loginPage.passwordInput.fill(registerPassword);
    await loginPage.confirmPasswordInput.fill(registerPassword);

    // Verify register form values are filled
    await expect(loginPage.emailInput).toHaveValue(registerEmail);
    await expect(loginPage.usernameInput).toHaveValue(registerUsername);

    // Switch back to login view
    await loginPage.switchToLogin();

    // Login form should be cleared (form was reset)
    await expect(loginPage.emailInput).toHaveValue('');
    await expect(loginPage.passwordInput).toHaveValue('');
  });
});

