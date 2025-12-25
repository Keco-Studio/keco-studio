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
 */
export function generateUniqueEmail(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `test-user-${timestamp}-${random}@example.com`;
}

/**
 * Generate unique registration data for new user signup tests
 */
export function generateRegistrationData(): RegistrationData {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const password = 'TestPassword123!';

  return {
    email: `test-user-${timestamp}-${random}@example.com`,
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
    email: 'seed-empty@example.com',
    password: 'Password123!',
  } as UserCredentials,

  /**
   * Seeded user with existing project data
   * Used for testing project-related flows
   */
  seedWithProject: {
    email: 'seed-project@example.com',
    password: 'Password123!',
  } as UserCredentials,

  /**
   * Seeded user with existing library data
   * Used for testing library-related flows
   */
  seedWithLibrary: {
    email: 'seed-library@example.com',
    password: 'Password123!',
  } as UserCredentials,

  /**
   * Invalid credentials for negative testing
   */
  invalid: {
    email: 'nonexistent@example.com',
    password: 'WrongPassword!',
  } as UserCredentials,

  /**
   * User with invalid password for error testing
   */
  wrongPassword: {
    email: 'seed-empty@example.com',
    password: 'IncorrectPassword!',
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
