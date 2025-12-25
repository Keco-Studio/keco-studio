/**
 * Project test fixtures for E2E happy path tests
 * 
 * Projects serve as the top-level container in the system hierarchy:
 * Project → Folder → Library
 */

export interface ProjectData {
  name: string;
  description?: string;
}

/**
 * Generate unique project data for tests
 * Uses timestamp to ensure uniqueness across test runs
 */
export function generateProjectData(): ProjectData {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6);
  
  return {
    name: `Test Project ${random}`,
    description: `E2E test project created at ${timestamp}`,
  };
}

/**
 * Pre-defined test projects for various scenarios
 */
export const projects = {
  /**
   * Standard test project for happy path
   */
  happyPath: {
    name: 'Livestock Management Project',
    description: 'End-to-end test project for livestock asset management',
  } as ProjectData,

  /**
   * Simple project for basic testing
   */
  basic: {
    name: 'Basic Test Project',
    description: 'A simple project for basic testing',
  } as ProjectData,
};

