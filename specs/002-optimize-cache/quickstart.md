# Quick Start: Implementing Cache Optimization

**Feature**: Optimize Cache Invalidation Strategy  
**Audience**: Developers implementing this feature  
**Prerequisites**: Familiarity with React Query, TypeScript, Next.js

## Overview

This guide walks through implementing targeted cache mutations to replace global invalidation patterns. Follow these steps in order for a smooth migration.

## Phase 1: Foundation (Days 1-2)

### Step 1: Create Query Keys Utility

**File**: `/lib/utils/queryKeys.ts`

```typescript
/**
 * Centralized query key factory for React Query caches.
 * Import and use these instead of hardcoded keys.
 */
export const queryKeys = {
  // Projects
  projects: () => ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  projectFolders: (projectId: string) => ['project', projectId, 'folders'] as const,
  projectLibraries: (projectId: string) => ['project', projectId, 'libraries'] as const,
  
  // Folders
  folder: (id: string) => ['folder', id] as const,
  folderLibraries: (folderId: string) => ['folder', folderId, 'libraries'] as const,
  
  // Libraries
  library: (id: string) => ['library', id] as const,
  libraryAssets: (libraryId: string) => ['library', libraryId, 'assets'] as const,
  librarySchema: (libraryId: string) => ['library', libraryId, 'schema'] as const,
  librarySummary: (libraryId: string) => ['library', libraryId, 'summary'] as const,
  
  // Assets
  asset: (id: string) => ['asset', id] as const,
};
```

**Test**:
```bash
# Create simple test file
npx tsx -e "
  import { queryKeys } from './lib/utils/queryKeys';
  console.log(queryKeys.project('test-id'));
  console.log(queryKeys.libraryAssets('lib-id'));
"
```

---

### Step 2: Create Cache Mutation Hooks

**File**: `/lib/hooks/useCacheMutations.ts`

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { queryKeys } from '@/lib/utils/queryKeys';
import {
  updateProject,
  updateLibrary,
  updateFolder,
} from '@/lib/services/*Service';
import { updateAsset } from '@/lib/services/libraryAssetsService';

/**
 * Hook for updating entity names with optimistic updates.
 * Handles project, library, folder, and asset name changes.
 */
export function useUpdateEntityName() {
  const queryClient = useQueryClient();
  const supabase = useSupabase();
  
  return useMutation({
    mutationFn: async ({ 
      id, 
      name, 
      entityType 
    }: { 
      id: string; 
      name: string; 
      entityType: 'project' | 'library' | 'folder' | 'asset';
    }) => {
      switch (entityType) {
        case 'project':
          return await updateProject(supabase, id, { name });
        case 'library':
          return await updateLibrary(supabase, id, { name });
        case 'folder':
          return await updateFolder(supabase, id, { name });
        case 'asset':
          return await updateAsset(supabase, id, name, {});
        default:
          throw new Error(`Unknown entity type: ${entityType}`);
      }
    },
    
    onMutate: async ({ id, name, entityType }) => {
      // Get appropriate query key
      const entityKey = 
        entityType === 'project' ? queryKeys.project(id) :
        entityType === 'library' ? queryKeys.library(id) :
        entityType === 'folder' ? queryKeys.folder(id) :
        queryKeys.asset(id);
      
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: entityKey });
      
      // Snapshot previous value
      const previousEntity = queryClient.getQueryData(entityKey);
      
      // Optimistically update individual entity
      queryClient.setQueryData(entityKey, (old: any) => ({
        ...old,
        name
      }));
      
      // Optimistically update in all lists
      queryClient.setQueriesData(
        { queryKey: [entityType] },
        (oldList: any[] | undefined) => {
          if (!oldList) return oldList;
          return oldList.map((item) =>
            item.id === id ? { ...item, name } : item
          );
        }
      );
      
      return { previousEntity, entityKey, entityType, id };
    },
    
    onError: (err, variables, context) => {
      if (!context) return;
      
      // Rollback individual entity
      if (context.previousEntity) {
        queryClient.setQueryData(context.entityKey, context.previousEntity);
      }
      
      // Rollback in lists
      queryClient.setQueriesData(
        { queryKey: [context.entityType] },
        (oldList: any[] | undefined) => {
          if (!oldList || !context.previousEntity) return oldList;
          return oldList.map((item) =>
            item.id === context.id ? context.previousEntity : item
          );
        }
      );
      
      console.error(`Failed to update ${context.entityType} name:`, err);
    },
    
    onSuccess: (data, variables, context) => {
      if (!context) return;
      
      // Dispatch event for backward compatibility
      window.dispatchEvent(new CustomEvent(`${context.entityType}Updated`, {
        detail: { [`${context.entityType}Id`]: context.id }
      }));
    },
  });
}

// Add more hooks: useAddEntityToList, useRemoveEntityFromList
// (See contracts/cache-mutations.md for full implementations)
```

**Test**:
```typescript
// Create test file: lib/hooks/__tests__/useCacheMutations.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateEntityName } from '../useCacheMutations';

describe('useUpdateEntityName', () => {
  it('updates cache optimistically', async () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: any) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
    
    queryClient.setQueryData(['project', '123'], { id: '123', name: 'Old' });
    
    const { result } = renderHook(() => useUpdateEntityName(), { wrapper });
    
    result.current.mutate({
      id: '123',
      name: 'New',
      entityType: 'project'
    });
    
    const cached = queryClient.getQueryData(['project', '123']);
    expect(cached).toEqual({ id: '123', name: 'New' });
  });
});
```

---

## Phase 2: Edit Modals (Days 3-5)

### Pattern: Convert Edit Modal

**BEFORE** (`EditProjectModal.tsx`):
```typescript
const handleSubmit = async () => {
  await updateProject(supabase, projectId, { name, description });
  
  // Dispatch event - other components will call invalidateQueries
  window.dispatchEvent(new CustomEvent('projectUpdated', { 
    detail: { projectId } 
  }));
  
  onClose();
};
```

**AFTER** (`EditProjectModal.tsx`):
```typescript
import { useUpdateEntityName } from '@/lib/hooks/useCacheMutations';

export function EditProjectModal({ projectId, onClose }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const updateName = useUpdateEntityName();
  const queryClient = useQueryClient();
  const supabase = useSupabase();
  
  const handleSubmit = async () => {
    // Update name with optimistic cache mutation
    await updateName.mutateAsync({
      id: projectId,
      name,
      entityType: 'project'
    });
    
    // Update description separately (not high-frequency, no optimistic update needed)
    if (description !== initialDescription) {
      await updateProject(supabase, projectId, { description });
      
      // Update description in cache
      queryClient.setQueryData(
        queryKeys.project(projectId),
        (old: any) => ({ ...old, description })
      );
      
      // Event still dispatched by useUpdateEntityName hook
    }
    
    onClose();
  };
  
  return (
    <Modal>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      <button onClick={handleSubmit} disabled={updateName.isPending}>
        {updateName.isPending ? 'Saving...' : 'Save'}
      </button>
      {updateName.isError && <ErrorMessage error={updateName.error} />}
    </Modal>
  );
}
```

**Convert All 4 Modals**:
1. ✅ `EditProjectModal.tsx`
2. ✅ `EditLibraryModal.tsx`
3. ✅ `EditFolderModal.tsx`
4. ✅ `EditAssetModal.tsx`

**Test Each Modal**:
```bash
# Open DevTools Network tab
# Edit entity name
# Verify: Only 1 POST/PUT request (the update)
# Verify: 0 GET requests (no refetch)
# Verify: UI updates instantly
```

---

## Phase 3: Page Components (Days 6-8)

### Pattern: Convert Page Event Handlers

**BEFORE** (`ProjectPage.tsx`):
```typescript
const fetchData = useCallback(async () => {
  // Fetches EVERYTHING
  const [projectData, foldersData, librariesData] = await Promise.all([
    getProject(supabase, projectId),
    listFolders(supabase, projectId),
    listLibraries(supabase, projectId, null),
  ]);
  setProject(projectData);
  setFolders(foldersData);
  setLibraries(librariesData);
}, [projectId, supabase]);

useEffect(() => {
  const handleLibraryUpdated = () => {
    fetchData();  // ❌ Refetches everything
  };
  
  window.addEventListener('libraryUpdated', handleLibraryUpdated);
  return () => window.removeEventListener('libraryUpdated', handleLibraryUpdated);
}, [fetchData]);
```

**AFTER** (`ProjectPage.tsx`):
```typescript
// Use React Query for data fetching
const { data: project } = useQuery({
  queryKey: queryKeys.project(projectId),
  queryFn: () => getProject(supabase, projectId),
});

const { data: folders = [] } = useQuery({
  queryKey: queryKeys.projectFolders(projectId),
  queryFn: () => listFolders(supabase, projectId),
});

const { data: libraries = [] } = useQuery({
  queryKey: queryKeys.projectLibraries(projectId),
  queryFn: () => listLibraries(supabase, projectId, null),
});

// Optimized event handler
useEffect(() => {
  const handleLibraryUpdated = (event: CustomEvent) => {
    const { libraryId } = event.detail;
    
    // Only invalidate specific library, not all folders/libraries
    queryClient.invalidateQueries({ 
      queryKey: queryKeys.library(libraryId) 
    });
  };
  
  window.addEventListener('libraryUpdated', handleLibraryUpdated);
  return () => window.removeEventListener('libraryUpdated', handleLibraryUpdated);
}, [queryClient]);
```

**Convert 3 Pages**:
1. ✅ `[projectId]/page.tsx` (7 events)
2. ✅ `[libraryId]/page.tsx` (3 events)
3. ✅ `folder/[folderId]/page.tsx` (4 events)

**Test Each Page**:
```bash
# Edit library name from modal
# Verify: Project page doesn't refetch folders/libraries
# Verify: Only the updated library name changes
# Verify: No network requests on project page
```

---

## Phase 4: Sidebar Optimization (Days 9-10)

### Pattern: Optimize Sidebar Event Handlers

**BEFORE**:
```typescript
useEffect(() => {
  const handleLibraryUpdated = () => {
    // ❌ Invalidates all folders and libraries
    queryClient.invalidateQueries({ 
      queryKey: ['folders-libraries', currentIds.projectId] 
    });
  };
  
  window.addEventListener('libraryUpdated', handleLibraryUpdated);
  return () => window.removeEventListener('libraryUpdated', handleLibraryUpdated);
}, [currentIds.projectId, queryClient]);
```

**AFTER**:
```typescript
useEffect(() => {
  const handleLibraryUpdated = (event: CustomEvent) => {
    const { libraryId } = event.detail;
    if (!libraryId) return;
    
    // ✅ Only invalidate specific library
    queryClient.invalidateQueries({ 
      queryKey: queryKeys.library(libraryId) 
    });
  };
  
  window.addEventListener('libraryUpdated', handleLibraryUpdated);
  return () => window.removeEventListener('libraryUpdated', handleLibraryUpdated);
}, [queryClient]);
```

**Refactor All 11 Event Handlers**:
1. projectCreated
2. projectUpdated  
3. libraryCreated
4. libraryUpdated
5. libraryDeleted
6. folderCreated
7. folderUpdated
8. folderDeleted
9. assetCreated
10. assetUpdated
11. assetDeleted

**See**: `contracts/event-handlers.md` for complete patterns

**Test Sidebar**:
```bash
# Edit entity names from different locations
# Verify: Sidebar tree updates instantly
# Verify: Only edited entity changes
# Verify: No network requests in Sidebar
```

---

## Phase 5: Testing & Validation (Week 3)

### Performance Testing

**Baseline Measurements** (before optimization):
```bash
# Open DevTools Network tab
# Clear network log
# Edit project name
# Count network requests: _____ requests
# Measure time to UI update: _____ ms
```

**After Optimization**:
```bash
# Edit project name
# Count network requests: Should be 1 (update only)
# Measure time to UI update: Should be <100ms
```

**Validation Criteria**:
- [  ] Edit project name: 1 request (was 3-4) = **75% reduction**
- [  ] Edit library name: 1 request (was 2-3) = **67% reduction**
- [  ] Create library: 1 request (was 3-4) = **75% reduction**
- [  ] Delete asset: 1 request (was 2-3) = **67% reduction**
- [  ] UI update latency: <100ms (was 300-500ms) = **60% faster**

---

### E2E Testing

**Test Scenarios**:
1. **CRUD Operations**:
   - [ ] Create project/folder/library/asset
   - [ ] Edit names for all entity types
   - [ ] Delete entities
   - [ ] Navigate between pages

2. **Multi-User Collaboration**:
   - [ ] Two users edit same project
   - [ ] Real-time updates still work
   - [ ] No cache conflicts

3. **Real-time Features**:
   - [ ] Collaborative editing in LibraryPage
   - [ ] Asset table updates
   - [ ] Presence indicators

4. **Edge Cases**:
   - [ ] Network error during optimistic update → rollback works
   - [ ] Rapid successive edits → no race conditions
   - [ ] Delete entity while viewing it → navigation works

**Run E2E Tests**:
```bash
npm run test:e2e
```

---

### Memory Testing

**Baseline** (before):
```bash
# Chrome DevTools > Memory > Take Heap Snapshot
# Navigate through app (open 3-4 projects/libraries)
# Take another snapshot
# Compare memory usage: _____ MB
```

**After Optimization**:
```bash
# Same navigation pattern
# Memory usage: Should be within 50% of baseline
# Acceptable: 85KB → 130KB (50% increase)
```

---

## Troubleshooting

### Issue: Cache gets stale

**Symptoms**: UI shows old data after update

**Solution**:
```typescript
// Add manual refetch after mutation
onSettled: () => {
  queryClient.invalidateQueries({ queryKey: entityKey });
}
```

---

### Issue: Optimistic update doesn't rollback

**Symptoms**: UI shows wrong data after error

**Check**:
1. Is `previousEntity` being saved correctly?
2. Is `onError` being called?
3. Is `queryClient.setQueryData` in onError working?

**Debug**:
```typescript
onError: (err, variables, context) => {
  console.log('Rollback context:', context);  // Should have previousEntity
  console.log('Error:', err);
  // ... rollback logic
}
```

---

### Issue: Real-time updates conflict with cache mutations

**Symptoms**: UI flickers or shows inconsistent data

**Solution**: Ensure real-time handlers use same cache mutation patterns

```typescript
// Real-time subscription handler
supabase
  .channel(`library-assets:${libraryId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'library_assets',
  }, (payload) => {
    // Update cache, don't invalidate
    queryClient.setQueryData(
      queryKeys.libraryAssets(libraryId),
      (old: AssetRow[] | undefined) => {
        if (!old) return old;
        return old.map(asset =>
          asset.id === payload.new.id ? { ...asset, ...payload.new } : asset
        );
      }
    );
  })
  .subscribe();
```

---

## Rollback Plan

If issues arise:

1. **Revert single component**: 
   - Restore old event handler (use `invalidateQueries`)
   - Keep query keys and hooks (not harmful)

2. **Revert entire feature**:
   ```bash
   git revert <commit-hash>
   # Or cherry-pick good commits
   ```

3. **Gradual rollback**:
   - Keep optimized edit modals (safest, highest impact)
   - Revert page components if issues
   - Sidebar can use hybrid approach

---

## Next Steps

After Phase 5 complete:

- [ ] Update documentation with new patterns
- [ ] Share learnings with team
- [ ] Consider removing event system (optional)
- [ ] Monitor production metrics

---

## Resources

- [Full Specification](./spec.md)
- [Implementation Plan](./plan.md)
- [Data Model](./data-model.md)
- [Contracts](./contracts/)
- [React Query Docs](https://tanstack.com/query/latest/docs/framework/react/overview)

---

## Support

Questions? Check:
1. Contracts (./contracts/*.md) for API details
2. Research (./research.md) for design decisions
3. Team chat for implementation help

