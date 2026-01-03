/**
 * Pre-seeded data fixtures for destructive testing
 * 
 * These data structures correspond to the seeded accounts in supabase/seed.sql
 * Each account has a complete data hierarchy: Project → Folder → Library → Asset
 */

/**
 * Destructive Test User 1 - Complete data set
 */
export const destructData1 = {
  project: {
    name: 'Destruct Test Project 1',
    description: 'Project for deletion testing',
  },
  folder: {
    name: 'Test Folder 1',
    description: 'Folder for deletion testing',
  },
  library: {
    name: 'Test Library 1',
    description: 'Library for deletion testing',
  },
  rootLibrary: {
    name: 'Root Library 1',
    description: 'Root-level library for deletion testing',
  },
  asset: {
    name: 'Test Asset 1',
  },
};

/**
 * Destructive Test User 2 - Complete data set
 */
export const destructData2 = {
  project: {
    name: 'Destruct Test Project 2',
    description: 'Project for deletion testing',
  },
  folder: {
    name: 'Test Folder 2',
    description: 'Folder for deletion testing',
  },
  library: {
    name: 'Test Library 2',
    description: 'Library for deletion testing',
  },
  rootLibrary: {
    name: 'Root Library 2',
    description: 'Root-level library for deletion testing',
  },
  asset: {
    name: 'Test Asset 2',
  },
};

