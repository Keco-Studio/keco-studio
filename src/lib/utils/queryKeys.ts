/**
 * Centralized query key factory for React Query caches.
 * 
 * Usage:
 *   useQuery({ queryKey: queryKeys.project(projectId), ... })
 *   queryClient.setQueryData(queryKeys.library(libId), newData)
 *   queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
 * 
 * Benefits:
 *   - Type-safe keys with const assertions
 *   - Single source of truth (easy to refactor)
 *   - IDE auto-completion
 *   - Prevents typos and inconsistencies
 */
export const queryKeys = {
  // ========== Projects ==========
  
  /**
   * All projects for current user
   * Returns: Project[]
   */
  projects: () => ['projects'] as const,
  
  /**
   * Single project by ID
   * Returns: Project
   */
  project: (id: string) => ['project', id] as const,
  
  /**
   * All folders in a project
   * Returns: Folder[]
   */
  projectFolders: (projectId: string) => 
    ['project', projectId, 'folders'] as const,
  
  /**
   * Root libraries in a project (folder_id = null)
   * Returns: Library[]
   */
  projectLibraries: (projectId: string) => 
    ['project', projectId, 'libraries'] as const,
  
  // ========== Folders ==========
  
  /**
   * Single folder by ID
   * Returns: Folder
   */
  folder: (id: string) => ['folder', id] as const,
  
  /**
   * All libraries in a folder
   * Returns: Library[]
   */
  folderLibraries: (folderId: string) => 
    ['folder', folderId, 'libraries'] as const,
  
  // ========== Libraries ==========
  
  /**
   * Single library by ID
   * Returns: Library
   */
  library: (id: string) => ['library', id] as const,
  
  /**
   * All assets in a library (with properties)
   * Returns: AssetRow[]
   */
  libraryAssets: (libraryId: string) => 
    ['library', libraryId, 'assets'] as const,
  
  /**
   * Library field schema (sections + properties)
   * Returns: { sections: Section[], properties: Property[] }
   */
  librarySchema: (libraryId: string) => 
    ['library', libraryId, 'schema'] as const,
  
  /**
   * Library summary statistics
   * Returns: { id, name, description, assetCount, lastUpdated }
   */
  librarySummary: (libraryId: string) => 
    ['library', libraryId, 'summary'] as const,
  
  // ========== Assets ==========
  
  /**
   * Single asset by ID (name only, no properties)
   * Returns: Asset
   */
  asset: (id: string) => ['asset', id] as const,
  
  // ========== Collaboration ==========
  
  /**
   * Collaborators for a project
   * Returns: Collaborator[]
   */
  projectCollaborators: (projectId: string) => 
    ['project', projectId, 'collaborators'] as const,
};

/**
 * Type helpers for query key inference
 */
export type QueryKey<T extends (...args: any[]) => readonly any[]> = 
  ReturnType<T>;

export type ProjectKey = ReturnType<typeof queryKeys.project>;
export type LibraryKey = ReturnType<typeof queryKeys.library>;
export type FolderKey = ReturnType<typeof queryKeys.folder>;
export type AssetKey = ReturnType<typeof queryKeys.asset>;







