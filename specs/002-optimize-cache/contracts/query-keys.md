# Contract: Query Keys

**Feature**: Optimize Cache Invalidation Strategy  
**Version**: 1.0.0  
**Date**: 2026-01-26

## Purpose

This contract defines the standard query key structure for all React Query cache operations in Keco Studio. All components must use these exact key formats to ensure cache consistency and enable targeted updates.

## Query Key Factory

**Location**: `/lib/utils/queryKeys.ts`

### Implementation

```typescript
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
```

## Key Patterns

### Individual Entities (Flat Keys)

**Pattern**: `['entityType', id]`

**Examples**:
- `['project', '123e4567-e89b-12d3-a456-426614174000']`
- `['library', '789e4567-e89b-12d3-a456-426614174001']`
- `['folder', '456e4567-e89b-12d3-a456-426614174002']`
- `['asset', '012e4567-e89b-12d3-a456-426614174003']`

**Rationale**: 
- Simple and unambiguous
- Easy to target with `queryClient.setQueryData(key, data)`
- Consistent across all entity types

---

### Entity Lists (Hierarchical Keys)

**Pattern**: `['parentType', parentId?, 'childrenType']`

**Examples**:
- `['projects']` - all projects (no parent)
- `['project', projectId, 'folders']` - folders in project
- `['project', projectId, 'libraries']` - root libraries in project
- `['folder', folderId, 'libraries']` - libraries in folder
- `['library', libraryId, 'assets']` - assets in library

**Rationale**:
- Expresses parent-child relationship clearly
- Supports partial matching: `{ queryKey: ['project', id] }` matches all queries starting with that prefix
- Enables batch updates with `queryClient.setQueriesData`

---

### Entity Metadata (Hierarchical with Suffix)

**Pattern**: `['entityType', id, 'metadataType']`

**Examples**:
- `['library', libraryId, 'schema']` - field definitions
- `['library', libraryId, 'summary']` - statistics
- `['project', projectId, 'collaborators']` - team members

**Rationale**:
- Distinguishes metadata from main entity data
- Allows independent caching (e.g., schema might be stale while library data is fresh)
- Descriptive suffix makes purpose clear

---

## Partial Matching

Query keys support partial matching for batch operations:

```typescript
// Match all queries for a specific project
{ queryKey: ['project', projectId] }
// Matches:
//   - ['project', projectId]
//   - ['project', projectId, 'folders']
//   - ['project', projectId, 'libraries']
//   - ['project', projectId, 'collaborators']

// Match all folder-related queries
{ queryKey: ['folder'] }
// Matches:
//   - ['folder', folderId1]
//   - ['folder', folderId2]
//   - ['folder', folderId3, 'libraries']
```

**Usage**:
```typescript
// Invalidate all data for a project
queryClient.invalidateQueries({ 
  queryKey: ['project', projectId] 
});

// Update all projects lists (e.g., after creating project)
queryClient.setQueriesData(
  { queryKey: ['projects'] },
  (old: Project[] | undefined) => {
    return [...(old || []), newProject];
  }
);
```

## Key Naming Conventions

### ✅ DO:
- Use plural for lists: `projects`, `folders`, `libraries`, `assets`
- Use singular for entities: `project`, `folder`, `library`, `asset`
- Use descriptive suffixes: `schema`, `summary`, `collaborators`
- Use consistent casing: all lowercase
- Use hyphens for multi-word keys (if needed): `asset-count`

### ❌ DON'T:
- Mix naming styles: `project_list` vs `projectList` vs `projects`
- Use abbreviations: `proj`, `lib`, `fld` (except commonly understood ones)
- Include redundant type info: `projectEntity` (just `project`)
- Use arbitrary suffixes: `data`, `info`, `details` (be specific)

## Migration Strategy

### Phase 1: New Query Key Utility
1. Create `/lib/utils/queryKeys.ts`
2. Define all keys following this contract
3. Export typed factory functions

### Phase 2: Gradual Adoption
1. New queries use `queryKeys` factory
2. Existing queries can still use hardcoded keys temporarily
3. Gradually refactor existing queries

### Phase 3: Enforcement
1. Add ESLint rule (if possible) to require `queryKeys` import
2. Search codebase for hardcoded query keys
3. Refactor all to use factory

## Validation

### Before Release
- [ ] All new queries use `queryKeys` factory
- [ ] No hardcoded query keys in new code
- [ ] Keys follow naming conventions
- [ ] Partial matching works as expected

### Testing
```typescript
// Test partial matching
const projectKey = queryKeys.project('test-id');
const foldersKey = queryKeys.projectFolders('test-id');

// Should match
expect(foldersKey).toEqual(['project', 'test-id', 'folders']);
// Should be partial match of project
expect(foldersKey[0]).toBe(projectKey[0]);
expect(foldersKey[1]).toBe(projectKey[1]);
```

## Examples

### Reading from Cache

```typescript
import { queryKeys } from '@/lib/utils/queryKeys';

// Get single project
const project = queryClient.getQueryData(queryKeys.project(projectId));

// Get folders list
const folders = queryClient.getQueryData(queryKeys.projectFolders(projectId));

// Get library assets
const assets = queryClient.getQueryData(queryKeys.libraryAssets(libraryId));
```

### Writing to Cache

```typescript
// Update single project name
queryClient.setQueryData(
  queryKeys.project(projectId),
  (old) => ({ ...old, name: newName })
);

// Append to folders list
queryClient.setQueryData(
  queryKeys.projectFolders(projectId),
  (old) => [...(old || []), newFolder]
);

// Update project name in all projects lists
queryClient.setQueriesData(
  { queryKey: queryKeys.projects() },
  (old: Project[] | undefined) => {
    if (!old) return old;
    return old.map(p => 
      p.id === projectId ? { ...p, name: newName } : p
    );
  }
);
```

### Invalidating Cache

```typescript
// Invalidate single entity
queryClient.invalidateQueries({ 
  queryKey: queryKeys.library(libraryId) 
});

// Invalidate all project data
queryClient.invalidateQueries({ 
  queryKey: ['project', projectId] 
});

// Invalidate all libraries (all projects, all folders)
queryClient.invalidateQueries({ 
  queryKey: ['library'] 
});
```

## Version History

- **1.0.0** (2026-01-26): Initial contract definition

## References

- [React Query Keys Guide](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)
- [Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys)

