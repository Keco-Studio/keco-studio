/**
 * Folder test fixtures for E2E tests
 * 
 * Note: When a project is created, a default "Resource Folder" is automatically created.
 * Most tests should use this default folder rather than creating new ones.
 */

export interface FolderData {
  name: string;
  description?: string;
}

/**
 * Default folder that is auto-created with each project
 * This is the expected default folder name in the system
 */
export const DEFAULT_RESOURCE_FOLDER = 'Resources Folder';

/**
 * Generate unique folder data for tests
 */
export function generateFolderData(): FolderData {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6);
  
  return {
    name: `Test Folder ${random}`,
    description: `E2E test folder created at ${timestamp}`,
  };
}

/**
 * Pre-defined test folders
 */
export const folders = {
  /**
   * Additional folder for organizing libraries
   */
  additional: {
    name: 'Equipment Folder',
    description: 'Folder for organizing equipment-related libraries',
  } as FolderData,
};

