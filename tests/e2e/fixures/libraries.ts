/**
 * Library test fixtures for E2E tests
 * 
 * Libraries contain Predefined Templates and Assets.
 * Can be created either:
 * - Directly under a Project (P → L)
 * - Under a Folder (P → F → L)
 */

export interface LibraryData {
  name: string;
  description?: string;
}

/**
 * Generate unique library data for tests
 */
export function generateLibraryData(): LibraryData {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6);
  
  return {
    name: `Test Library ${random}`,
    description: `E2E test library created at ${timestamp}`,
  };
}

/**
 * Pre-defined test libraries for various scenarios
 */
export const libraries = {
  /**
   * Primary library for happy path - contains the main predefined template
   */
  livestock: {
    name: 'Livestock Library',
    description: 'Library for managing livestock assets',
  } as LibraryData,

  /**
   * Reference library - used as reference source for the main library
   * Must be created first to be referenced by livestock library
   */
  breed: {
    name: 'Breed Library',
    description: 'Reference library for livestock breeds',
  } as LibraryData,

  /**
   * Direct library under project (not in folder)
   */
  directLibrary: {
    name: 'Direct Library',
    description: 'Library created directly under project',
  } as LibraryData,
};

