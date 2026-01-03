import type { UserCredentials, RegistrationData } from '../pages/login.page';

/**
 * Test user fixtures for E2E authentication tests
 * 
 * NOTE: These are seeded test accounts. In a real environment,
 * ensure these users exist in your test database or use a seeding strategy.
 */

/**
 * Generate a unique email for registration tests
 * Uses timestamp to ensure uniqueness across test runs
 * Note: Using mailinator.com for CI compatibility (allows test emails)
 */
export function generateUniqueEmail(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `test-user-${timestamp}-${random}@mailinator.com`;
}

/**
 * Generate unique registration data for new user signup tests
 */
export function generateRegistrationData(): RegistrationData {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const password = 'TestPassword123!';

  return {
    email: `test-user-${timestamp}-${random}@mailinator.com`,
    username: `testuser_${random}`,
    password,
    confirmPassword: password,
  };
}

/**
 * Pre-defined test users for various test scenarios
 */
export const users = {
  /**
   * Standard test user with valid credentials
   * Used for basic login flow testing
   */
  normal: {
    email: 'user@test.com',
    password: '123456',
  } as UserCredentials,

  /**
   * Seeded empty user - no projects, libraries, or assets
   * Used for testing initial state and creation flows
   */
  seedEmpty: {
    email: 'seed-empty@mailinator.com',
    password: 'Password123!',
  } as UserCredentials,

  /**
   * Seeded empty user 2 - no projects, libraries, or assets
   * Used for parallel testing or when first empty account is in use
   */
  seedEmpty2: {
    email: 'seed-empty-2@mailinator.com',
    password: 'Password123!',
  } as UserCredentials,

  /**
   * Seeded empty user 3 - no projects, libraries, or assets
   * Used for parallel testing or when other empty accounts are in use
   */
  seedEmpty3: {
    email: 'seed-empty-3@mailinator.com',
    password: 'Password123!',
  } as UserCredentials,

  /**
   * Seeded empty user 4 - no projects, libraries, or assets
   * Used for parallel testing or when other empty accounts are in use
   */
  seedEmpty4: {
    email: 'seed-empty-4@mailinator.com',
    password: 'Password123!',
  } as UserCredentials,

  /**
   * Seeded user with existing project data
   * Used for testing project-related flows
   */
  seedWithProject: {
    email: 'seed-project@mailinator.com',
    password: 'Password123!',
  } as UserCredentials,

  /**
   * Seeded user with existing library data
   * Used for testing library-related flows
   */
  seedWithLibrary: {
    email: 'seed-library@mailinator.com',
    password: 'Password123!',
  } as UserCredentials,

  /**
   * Invalid credentials for negative testing
   */
  invalid: {
    email: 'nonexistent@mailinator.com',
    password: 'WrongPassword!',
  } as UserCredentials,

  /**
   * User with invalid password for error testing
   */
  wrongPassword: {
    email: 'seed-empty@mailinator.com',
    password: 'IncorrectPassword!',
  } as UserCredentials,

  /**
   * Destructive test user 1 - Pre-populated with complete test data
   * Includes: Project → Folder → Library → Asset
   * Used for deletion testing without depending on creation flows
   */
  seedDestruct1: {
    email: 'seed-destruct-1@mailinator.com',
    password: 'Password123!',
  } as UserCredentials,

  /**
   * Destructive test user 2 - Pre-populated with complete test data
   * Includes: Project → Folder → Library → Asset
   * Used for parallel deletion testing or when first destructive account is in use
   */
  seedDestruct2: {
    email: 'seed-destruct-2@mailinator.com',
    password: 'Password123!',
  } as UserCredentials,
};

/**
 * Registration test data with mismatched passwords
 * Used for testing password confirmation validation
 */
export const invalidRegistration = {
  mismatchedPasswords: {
    email: generateUniqueEmail(),
    username: 'testuser',
    password: 'Password123!',
    confirmPassword: 'DifferentPassword!',
  } as RegistrationData,

  emptyFields: {
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
  } as RegistrationData,
};
