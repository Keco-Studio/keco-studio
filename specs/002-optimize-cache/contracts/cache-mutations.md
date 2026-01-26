# Contract: Cache Mutations

**Feature**: Optimize Cache Invalidation Strategy  
**Version**: 1.0.0  
**Date**: 2026-01-26

## Purpose

This contract defines standard patterns for React Query cache mutations. All components must follow these patterns to ensure cache consistency, enable optimistic updates, and maintain proper error handling.

## Core Principles

1. **Direct Updates Over Invalidation**: Use `setQueryData` for known updates instead of `invalidateQueries`
2. **Optimistic Updates for Instant UX**: Update cache before server confirms (with rollback)
3. **Batch Updates for Consistency**: Use `setQueriesData` to update related caches atomically
4. **Error Resilience**: Always handle failures with rollback or fallback
5. **Event Compatibility**: Maintain existing event system during migration

## Cache Mutation Hooks

**Location**: `/lib/hooks/useCacheMutations.ts`

### Hook: useUpdateEntityName

Updates an entity's name with optimistic update and rollback.

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/utils/queryKeys';

interface UpdateNameParams {
  id: string;
  name: string;
  entityType: 'project' | 'library' | 'folder' | 'asset';
}

/**
 * Hook for updating entity names with optimistic update.
 * 
 * Features:
 * - Instant UI feedback (optimistic)
 * - Automatic rollback on error
 * - Updates individual cache + all lists
 * - Dispatches event for backward compatibility
 * 
 * Usage:
 *   const updateName = useUpdateEntityName();
 *   updateName.mutate({ id, name, entityType: 'project' });
 */
export function useUpdateEntityName() {
  const queryClient = useQueryClient();
  const supabase = useSupabase();
  
  return useMutation({
    mutationFn: async ({ id, name, entityType }: UpdateNameParams) => {
      // Call appropriate service function
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
    
    // OPTIMISTIC UPDATE: Before mutation starts
    onMutate: async ({ id, name, entityType }) => {
      // Get query key for this entity
      const entityKey = 
        entityType === 'project' ? queryKeys.project(id) :
        entityType === 'library' ? queryKeys.library(id) :
        entityType === 'folder' ? queryKeys.folder(id) :
        queryKeys.asset(id);
      
      // Cancel any outgoing refetches (prevent race conditions)
      await queryClient.cancelQueries({ queryKey: entityKey });
      
      // Snapshot previous value for rollback
      const previousEntity = queryClient.getQueryData(entityKey);
      
      // Optimistically update individual entity cache
      queryClient.setQueryData(entityKey, (old: any) => ({
        ...old,
        name
      }));
      
      // Optimistically update in all lists
      // Use partial matching to update project in projects list, library in libraries lists, etc.
      queryClient.setQueriesData(
        { queryKey: [entityType] },
        (oldList: any[] | undefined) => {
          if (!oldList) return oldList;
          return oldList.map((item) =>
            item.id === id ? { ...item, name } : item
          );
        }
      );
      
      // Return context for potential rollback
      return { previousEntity, entityKey, entityType, id };
    },
    
    // ON ERROR: Rollback optimistic update
    onError: (err, variables, context) => {
      if (!context) return;
      
      // Restore previous value
      if (context.previousEntity) {
        queryClient.setQueryData(context.entityKey, context.previousEntity);
      }
      
      // Also rollback in lists
      queryClient.setQueriesData(
        { queryKey: [context.entityType] },
        (oldList: any[] | undefined) => {
          if (!oldList) return oldList;
          if (!context.previousEntity) return oldList;
          return oldList.map((item) =>
            item.id === context.id ? context.previousEntity : item
          );
        }
      );
      
      console.error(`Failed to update ${context.entityType} name:`, err);
    },
    
    // ON SUCCESS: Dispatch event for backward compatibility
    onSuccess: (data, variables, context) => {
      if (!context) return;
      
      // Dispatch custom event for components still using event listeners
      window.dispatchEvent(new CustomEvent(`${context.entityType}Updated`, {
        detail: { [`${context.entityType}Id`]: context.id }
      }));
    },
    
    // ALWAYS: Settle queries after mutation completes or fails
    onSettled: (data, error, variables, context) => {
      // Optionally refetch to ensure cache is in sync with server
      // Comment this out if optimistic update + error rollback is sufficient
      // if (context) {
      //   queryClient.invalidateQueries({ queryKey: context.entityKey });
      // }
    }
  });
}
```

### Hook: useAddEntityToList

Adds new entity to parent's list without refetching.

```typescript
interface AddEntityParams {
  parentId: string;
  parentType: 'project' | 'folder' | 'library';
  childType: 'folder' | 'library' | 'asset';
  childData: any;
}

/**
 * Hook for adding entity to parent's list.
 * 
 * Features:
 * - Appends to list immediately after server insert
 * - No refetch needed
 * - Dispatches event
 * 
 * Usage:
 *   const addEntity = useAddEntityToList();
 *   addEntity.mutate({ parentId, parentType: 'project', childType: 'folder', childData });
 */
export function useAddEntityToList() {
  const queryClient = useQueryClient();
  const supabase = useSupabase();
  
  return useMutation({
    mutationFn: async ({ childType, childData }: AddEntityParams) => {
      // Call appropriate creation service
      switch (childType) {
        case 'folder':
          return await createFolder(supabase, childData);
        case 'library':
          return await createLibrary(supabase, childData);
        case 'asset':
          return await createAsset(supabase, childData);
        default:
          throw new Error(`Unknown child type: ${childType}`);
      }
    },
    
    onSuccess: (newEntity, variables) => {
      // Determine list query key based on parent-child relationship
      let listKey: readonly unknown[];
      
      if (variables.parentType === 'project' && variables.childType === 'folder') {
        listKey = queryKeys.projectFolders(variables.parentId);
      } else if (variables.parentType === 'project' && variables.childType === 'library') {
        listKey = queryKeys.projectLibraries(variables.parentId);
      } else if (variables.parentType === 'folder' && variables.childType === 'library') {
        listKey = queryKeys.folderLibraries(variables.parentId);
      } else if (variables.parentType === 'library' && variables.childType === 'asset') {
        listKey = queryKeys.libraryAssets(variables.parentId);
      } else {
        throw new Error(`Invalid parent-child relationship: ${variables.parentType} -> ${variables.childType}`);
      }
      
      // Append new entity to list
      queryClient.setQueryData(listKey, (old: any[] | undefined) => {
        return [...(old || []), newEntity];
      });
      
      // Dispatch event
      window.dispatchEvent(new CustomEvent(`${variables.childType}Created`, {
        detail: {
          [`${variables.childType}Id`]: newEntity.id,
          parentId: variables.parentId
        }
      }));
    }
  });
}
```

### Hook: useRemoveEntityFromList

Removes entity from parent's list and cleans up caches.

```typescript
interface RemoveEntityParams {
  id: string;
  entityType: 'project' | 'folder' | 'library' | 'asset';
  parentId?: string;
  parentType?: 'project' | 'folder' | 'library';
}

/**
 * Hook for removing entity from lists.
 * 
 * Features:
 * - Removes from all lists containing the entity
 * - Cleans up individual entity cache
 * - Dispatches event
 * 
 * Usage:
 *   const removeEntity = useRemoveEntityFromList();
 *   removeEntity.mutate({ id, entityType: 'library', parentId, parentType: 'project' });
 */
export function useRemoveEntityFromList() {
  const queryClient = useQueryClient();
  const supabase = useSupabase();
  
  return useMutation({
    mutationFn: async ({ id, entityType }: RemoveEntityParams) => {
      // Call appropriate deletion service
      switch (entityType) {
        case 'project':
          return await deleteProject(supabase, id);
        case 'folder':
          return await deleteFolder(supabase, id);
        case 'library':
          return await deleteLibrary(supabase, id);
        case 'asset':
          return await deleteAsset(supabase, id);
        default:
          throw new Error(`Unknown entity type: ${entityType}`);
      }
    },
    
    onSuccess: (data, variables) => {
      // Remove from all lists that might contain it
      // Use partial matching to update all relevant lists
      queryClient.setQueriesData(
        { queryKey: [variables.entityType] },
        (oldList: any[] | undefined) => {
          if (!oldList) return oldList;
          return oldList.filter((item) => item.id !== variables.id);
        }
      );
      
      // Remove individual entity cache
      const entityKey =
        variables.entityType === 'project' ? queryKeys.project(variables.id) :
        variables.entityType === 'library' ? queryKeys.library(variables.id) :
        variables.entityType === 'folder' ? queryKeys.folder(variables.id) :
        queryKeys.asset(variables.id);
      
      queryClient.removeQueries({ queryKey: entityKey });
      
      // For folders, also remove child libraries
      if (variables.entityType === 'folder') {
        queryClient.removeQueries({ 
          queryKey: queryKeys.folderLibraries(variables.id) 
        });
      }
      
      // For libraries, also remove assets and schema
      if (variables.entityType === 'library') {
        queryClient.removeQueries({ 
          queryKey: queryKeys.libraryAssets(variables.id) 
        });
        queryClient.removeQueries({ 
          queryKey: queryKeys.librarySchema(variables.id) 
        });
        queryClient.removeQueries({ 
          queryKey: queryKeys.librarySummary(variables.id) 
        });
      }
      
      // Dispatch event
      window.dispatchEvent(new CustomEvent(`${variables.entityType}Deleted`, {
        detail: {
          [`${variables.entityType}Id`]: variables.id,
          parentId: variables.parentId
        }
      }));
    }
  });
}
```

## Usage Patterns

### Pattern 1: Edit Modal with Optimistic Update

**EditProjectModal.tsx**:
```typescript
import { useUpdateEntityName } from '@/lib/hooks/useCacheMutations';

export function EditProjectModal({ projectId, onClose }: Props) {
  const [name, setName] = useState('');
  const updateName = useUpdateEntityName();
  
  const handleSubmit = async () => {
    await updateName.mutateAsync({
      id: projectId,
      name,
      entityType: 'project'
    });
    onClose();
  };
  
  return (
    <Modal>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={handleSubmit} disabled={updateName.isPending}>
        {updateName.isPending ? 'Saving...' : 'Save'}
      </button>
      {updateName.isError && <div>Error: {updateName.error.message}</div>}
    </Modal>
  );
}
```

### Pattern 2: Create Operation in Page Component

**ProjectPage.tsx**:
```typescript
import { useAddEntityToList } from '@/lib/hooks/useCacheMutations';

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const addEntity = useAddEntityToList();
  
  const handleCreateFolder = async (folderData: any) => {
    await addEntity.mutateAsync({
      parentId: projectId,
      parentType: 'project',
      childType: 'folder',
      childData: { ...folderData, project_id: projectId }
    });
  };
  
  return (
    <div>
      <button onClick={() => handleCreateFolder({ name: 'New Folder' })}>
        Create Folder
      </button>
    </div>
  );
}
```

### Pattern 3: Delete Operation with Navigation

**Sidebar.tsx**:
```typescript
import { useRemoveEntityFromList } from '@/lib/hooks/useCacheMutations';
import { useRouter, usePathname } from 'next/navigation';

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const removeEntity = useRemoveEntityFromList();
  
  const handleDeleteLibrary = async (libraryId: string, projectId: string) => {
    if (!confirm('Delete this library?')) return;
    
    await removeEntity.mutateAsync({
      id: libraryId,
      entityType: 'library',
      parentId: projectId,
      parentType: 'project'
    });
    
    // Navigate away if viewing deleted library
    if (pathname.includes(libraryId)) {
      router.push(`/${projectId}`);
    }
  };
  
  return <TreeView onDelete={handleDeleteLibrary} />;
}
```

## Error Handling

### Strategy 1: Optimistic with Rollback (Recommended)

```typescript
// On mutation start: Update cache optimistically
onMutate: async (variables) => {
  // 1. Cancel outgoing queries
  await queryClient.cancelQueries({ queryKey });
  
  // 2. Save previous value
  const previous = queryClient.getQueryData(queryKey);
  
  // 3. Update cache
  queryClient.setQueryData(queryKey, newValue);
  
  // 4. Return context for rollback
  return { previous };
},

// On error: Rollback
onError: (err, variables, context) => {
  if (context?.previous) {
    queryClient.setQueryData(queryKey, context.previous);
  }
  // Show error to user
  toast.error('Failed to save changes');
}
```

### Strategy 2: Pessimistic (Wait for Server)

```typescript
// Don't use onMutate
// Update cache only on success
onSuccess: (data) => {
  queryClient.setQueryData(queryKey, data);
}
```

**When to use each**:
- **Optimistic**: Name edits, simple updates (instant feedback is valuable)
- **Pessimistic**: Complex updates, operations with validation (safety is more important)

## Testing Patterns

### Unit Test: Cache Mutation Hook

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateEntityName } from '@/lib/hooks/useCacheMutations';

describe('useUpdateEntityName', () => {
  let queryClient: QueryClient;
  
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
  });
  
  it('updates cache optimistically', async () => {
    const wrapper = ({ children }: any) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
    
    // Pre-populate cache
    queryClient.setQueryData(['project', '123'], { 
      id: '123', 
      name: 'Old Name' 
    });
    
    const { result } = renderHook(() => useUpdateEntityName(), { wrapper });
    
    // Trigger mutation
    result.current.mutate({
      id: '123',
      name: 'New Name',
      entityType: 'project'
    });
    
    // Cache should be updated immediately (optimistic)
    const cached = queryClient.getQueryData(['project', '123']);
    expect(cached).toEqual({ id: '123', name: 'New Name' });
  });
  
  it('rolls back on error', async () => {
    // Mock service to fail
    jest.spyOn(projectService, 'updateProject')
      .mockRejectedValue(new Error('Network error'));
    
    const wrapper = ({ children }: any) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
    
    queryClient.setQueryData(['project', '123'], { 
      id: '123', 
      name: 'Old Name' 
    });
    
    const { result } = renderHook(() => useUpdateEntityName(), { wrapper });
    
    result.current.mutate({
      id: '123',
      name: 'New Name',
      entityType: 'project'
    });
    
    await waitFor(() => expect(result.current.isError).toBe(true));
    
    // Cache should be rolled back
    const cached = queryClient.getQueryData(['project', '123']);
    expect(cached).toEqual({ id: '123', name: 'Old Name' });
  });
});
```

## Migration Checklist

### For Each Edit Modal
- [ ] Import `useUpdateEntityName` hook
- [ ] Replace direct service call with `updateName.mutate()`
- [ ] Remove manual cache invalidation
- [ ] Keep event dispatch (for backward compatibility)
- [ ] Test optimistic update and rollback

### For Each Page Component
- [ ] Import appropriate cache mutation hooks
- [ ] Replace `fetchData()` calls with cache reads
- [ ] Use mutation hooks for create/delete operations
- [ ] Update event handlers to use cache mutations
- [ ] Test all CRUD operations

### For Sidebar
- [ ] Refactor all 11 event handlers
- [ ] Use cache mutations instead of `invalidateQueries`
- [ ] Test tree expand/collapse
- [ ] Verify real-time updates still work

## Version History

- **1.0.0** (2026-01-26): Initial contract definition

## References

- [React Query Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)
- [Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)
- [Updates from Mutation Responses](https://tanstack.com/query/latest/docs/framework/react/guides/updates-from-mutation-responses)

