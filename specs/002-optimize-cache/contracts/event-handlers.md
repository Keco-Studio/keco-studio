# Contract: Event Handlers

**Feature**: Optimize Cache Invalidation Strategy  
**Version**: 1.0.0  
**Date**: 2026-01-26

## Purpose

This contract defines the standard patterns for custom event handlers during the migration from global invalidation to targeted cache mutations. Events will be maintained for backward compatibility while gradually optimizing listeners to use cache mutations instead of full refetches.

## Event Types

### Project Events

**`projectCreated`**
```typescript
window.dispatchEvent(new CustomEvent('projectCreated', {
  detail: { projectId: string }
}));
```

**`projectUpdated`**
```typescript
window.dispatchEvent(new CustomEvent('projectUpdated', {
  detail: { projectId: string }
}));
```

**`projectDeleted`**
```typescript
window.dispatchEvent(new CustomEvent('projectDeleted', {
  detail: { projectId: string }
}));
```

---

### Library Events

**`libraryCreated`**
```typescript
window.dispatchEvent(new CustomEvent('libraryCreated', {
  detail: {
    libraryId: string;
    projectId: string;
    folderId: string | null;  // null if root library
  }
}));
```

**`libraryUpdated`**
```typescript
window.dispatchEvent(new CustomEvent('libraryUpdated', {
  detail: {
    libraryId: string;
    projectId?: string;  // optional for backward compatibility
  }
}));
```

**`libraryDeleted`**
```typescript
window.dispatchEvent(new CustomEvent('libraryDeleted', {
  detail: {
    libraryId: string;
    projectId: string;
    folderId: string | null;
  }
}));
```

---

### Folder Events

**`folderCreated`**
```typescript
window.dispatchEvent(new CustomEvent('folderCreated', {
  detail: {
    folderId: string;
    projectId: string;
  }
}));
```

**`folderUpdated`**
```typescript
window.dispatchEvent(new CustomEvent('folderUpdated', {
  detail: {
    folderId: string;
    projectId?: string;  // optional for backward compatibility
  }
}));
```

**`folderDeleted`**
```typescript
window.dispatchEvent(new CustomEvent('folderDeleted', {
  detail: {
    folderId: string;
    projectId: string;
  }
}));
```

---

### Asset Events

**`assetCreated`**
```typescript
window.dispatchEvent(new CustomEvent('assetCreated', {
  detail: {
    assetId: string;
    libraryId: string;
  }
}));
```

**`assetUpdated`**
```typescript
window.dispatchEvent(new CustomEvent('assetUpdated', {
  detail: {
    assetId: string;
    libraryId: string;
  }
}));
```

**`assetDeleted`**
```typescript
window.dispatchEvent(new CustomEvent('assetDeleted', {
  detail: {
    assetId: string;
    libraryId: string;
  }
}));
```

---

## Event Handler Patterns

### ❌ BEFORE: Global Invalidation (Current Pattern)

```typescript
// Sidebar.tsx - BEFORE OPTIMIZATION
useEffect(() => {
  const handleLibraryUpdated = (event: CustomEvent) => {
    // Problem: Invalidates ALL folders and libraries, causing full refetch
    queryClient.invalidateQueries({ 
      queryKey: ['folders-libraries', currentIds.projectId] 
    });
  };
  
  window.addEventListener('libraryUpdated', handleLibraryUpdated);
  return () => window.removeEventListener('libraryUpdated', handleLibraryUpdated);
}, [currentIds.projectId, queryClient]);
```

**Problems**:
- Refetches all folders AND all libraries (even though only 1 library name changed)
- 2-3 network requests when 0 are needed
- Slow: 300-500ms latency

---

### ✅ AFTER: Targeted Cache Mutation (Optimized Pattern)

```typescript
// Sidebar.tsx - AFTER OPTIMIZATION
useEffect(() => {
  const handleLibraryUpdated = async (event: CustomEvent) => {
    const { libraryId } = event.detail;
    if (!libraryId) return;
    
    // Option 1: If we have the updated data, use it
    // (Edit modals will include updated data in future enhancement)
    const updatedLibrary = event.detail.updatedLibrary;
    if (updatedLibrary) {
      // Update individual library cache
      queryClient.setQueryData(
        queryKeys.library(libraryId),
        updatedLibrary
      );
      
      // Update in all library lists
      queryClient.setQueriesData(
        { queryKey: ['library'] },
        (oldList: Library[] | undefined) => {
          if (!oldList) return oldList;
          return oldList.map(lib =>
            lib.id === libraryId ? { ...lib, name: updatedLibrary.name } : lib
          );
        }
      );
      return;
    }
    
    // Option 2: If we don't have data, targeted invalidation
    // Only invalidate the specific library, not all libraries
    queryClient.invalidateQueries({ 
      queryKey: queryKeys.library(libraryId) 
    });
  };
  
  window.addEventListener('libraryUpdated', handleLibraryUpdated);
  return () => window.removeEventListener('libraryUpdated', handleLibraryUpdated);
}, [queryClient]);
```

**Benefits**:
- 0 network requests if data provided (instant)
- 1 network request if targeted invalidation (down from 2-3)
- Fast: <100ms latency

---

## Component-Specific Handler Patterns

### Sidebar Event Handlers

**11 events to optimize**:
1. `projectCreated` - append to projects list
2. `projectUpdated` - update project name in tree
3. `libraryCreated` - append to appropriate list (root or folder)
4. `libraryUpdated` - update library name in tree
5. `libraryDeleted` - remove from tree
6. `folderCreated` - append to folders list
7. `folderUpdated` - update folder name in tree
8. `folderDeleted` - remove from tree
9. `assetCreated` - append to library's assets list
10. `assetUpdated` - update asset name in list
11. `assetDeleted` - remove from assets list

**Pattern Template**:
```typescript
// Sidebar.tsx - Optimized event handlers
useEffect(() => {
  const handlers = {
    // Create events: Append to list
    handleLibraryCreated: (e: CustomEvent) => {
      const { libraryId, projectId, folderId } = e.detail;
      
      // Determine which list to update
      const listKey = folderId
        ? queryKeys.folderLibraries(folderId)
        : queryKeys.projectLibraries(projectId);
      
      // Refetch just the list (or append if we have data)
      queryClient.invalidateQueries({ queryKey: listKey });
    },
    
    // Update events: Update entity name
    handleLibraryUpdated: (e: CustomEvent) => {
      const { libraryId } = e.detail;
      
      // Invalidate just this library, not all libraries
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.library(libraryId) 
      });
    },
    
    // Delete events: Remove from lists
    handleLibraryDeleted: (e: CustomEvent) => {
      const { libraryId, projectId, folderId } = e.detail;
      
      // Remove from appropriate list
      const listKey = folderId
        ? queryKeys.folderLibraries(folderId)
        : queryKeys.projectLibraries(projectId);
      
      queryClient.setQueryData(listKey, (old: Library[] | undefined) => {
        if (!old) return old;
        return old.filter(lib => lib.id !== libraryId);
      });
      
      // Clean up individual cache
      queryClient.removeQueries({ 
        queryKey: queryKeys.library(libraryId) 
      });
    },
  };
  
  // Register all handlers
  Object.entries(handlers).forEach(([name, handler]) => {
    const eventName = name.replace('handle', '').replace(/([A-Z])/g, (m) => 
      m.toLowerCase()
    );
    window.addEventListener(eventName, handler as EventListener);
  });
  
  // Cleanup
  return () => {
    Object.entries(handlers).forEach(([name, handler]) => {
      const eventName = name.replace('handle', '').replace(/([A-Z])/g, (m) => 
        m.toLowerCase()
      );
      window.removeEventListener(eventName, handler as EventListener);
    });
  };
}, [queryClient]);
```

---

### ProjectPage Event Handlers

**7 events to optimize**:
1. `folderCreated` - only if event.detail.projectId matches
2. `folderDeleted` - only if event.detail.projectId matches
3. `folderUpdated` - only if event.detail.projectId matches
4. `libraryCreated` - only if event.detail.projectId matches
5. `libraryDeleted` - only if event.detail.projectId matches
6. `libraryUpdated` - only if event.detail.projectId matches
7. `projectUpdated` - only if event.detail.projectId matches

**❌ BEFORE**:
```typescript
// ProjectPage.tsx - BEFORE
useEffect(() => {
  const handleFolderCreated = (event: CustomEvent) => {
    const eventProjectId = event.detail?.projectId;
    if (!eventProjectId || eventProjectId === projectId) {
      fetchData();  // ❌ Refetches EVERYTHING: project + all folders + all libraries
    }
  };
  
  window.addEventListener('folderCreated', handleFolderCreated);
  return () => window.removeEventListener('folderCreated', handleFolderCreated);
}, [fetchData, projectId]);
```

**✅ AFTER**:
```typescript
// ProjectPage.tsx - AFTER
useEffect(() => {
  const handleFolderCreated = (event: CustomEvent) => {
    const eventProjectId = event.detail?.projectId;
    if (eventProjectId !== projectId) return;
    
    // Only refetch folders list, not project or libraries
    queryClient.invalidateQueries({ 
      queryKey: queryKeys.projectFolders(projectId) 
    });
  };
  
  window.addEventListener('folderCreated', handleFolderCreated);
  return () => window.removeEventListener('folderCreated', handleFolderCreated);
}, [projectId, queryClient]);
```

---

### LibraryPage Event Handlers

**3 asset events + 1 library event**:

**✅ OPTIMIZED**:
```typescript
// LibraryPage.tsx - OPTIMIZED
useEffect(() => {
  const handleAssetCreated = (event: CustomEvent) => {
    const { libraryId: eventLibraryId } = event.detail;
    if (eventLibraryId !== libraryId) return;
    
    // Refetch just assets list, not schema or library info
    queryClient.invalidateQueries({ 
      queryKey: queryKeys.libraryAssets(libraryId) 
    });
  };
  
  const handleLibraryUpdated = (event: CustomEvent) => {
    const { libraryId: eventLibraryId } = event.detail;
    if (eventLibraryId !== libraryId) return;
    
    // Only refetch library info, not assets or schema
    queryClient.invalidateQueries({ 
      queryKey: queryKeys.library(libraryId) 
    });
    queryClient.invalidateQueries({ 
      queryKey: queryKeys.librarySummary(libraryId) 
    });
  };
  
  window.addEventListener('assetCreated', handleAssetCreated);
  window.addEventListener('libraryUpdated', handleLibraryUpdated);
  
  return () => {
    window.removeEventListener('assetCreated', handleAssetCreated);
    window.removeEventListener('libraryUpdated', handleLibraryUpdated);
  };
}, [libraryId, queryClient]);
```

---

## Migration Strategy

### Phase 1: Enhance Events (Optional)

Add updated data to event details to enable instant cache updates:

```typescript
// EditLibraryModal.tsx - Enhanced event
window.dispatchEvent(new CustomEvent('libraryUpdated', {
  detail: {
    libraryId,
    projectId,
    updatedLibrary: { id, name, description, ... }  // ✨ NEW
  }
}));
```

**Benefits**:
- Listeners can update cache directly without refetch
- 0 network requests for name edits
- Truly instant

**Trade-offs**:
- Slightly larger event payloads
- More work in edit modals
- Worth it for high-frequency operations (name edits)

### Phase 2: Optimize Handlers

Refactor event handlers to:
1. Check if updated data is provided → use `setQueryData`
2. Otherwise → use targeted `invalidateQueries` (specific query key)
3. Never use broad invalidation (`['folders-libraries', projectId]`)

### Phase 3: Remove Events (Optional)

Once all components use cache mutations:
1. Edit modals update cache directly (no event dispatch)
2. Remove all event listeners
3. Simpler, more maintainable code

**Note**: Keep events for now - migration is gradual and events provide debugging visibility.

---

## Testing Event Handlers

### Unit Test: Optimized Event Handler

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

describe('Sidebar event handlers', () => {
  let queryClient: QueryClient;
  
  beforeEach(() => {
    queryClient = new QueryClient();
  });
  
  it('handleLibraryUpdated invalidates only specific library', () => {
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    
    // Simulate event
    window.dispatchEvent(new CustomEvent('libraryUpdated', {
      detail: { libraryId: '123' }
    }));
    
    // Should invalidate only the specific library
    expect(invalidateSpy).toHaveBeenCalledWith({ 
      queryKey: ['library', '123'] 
    });
    
    // Should NOT invalidate all libraries
    expect(invalidateSpy).not.toHaveBeenCalledWith({ 
      queryKey: ['folders-libraries', expect.anything()] 
    });
  });
  
  it('handleLibraryDeleted removes from cache', () => {
    // Pre-populate cache
    queryClient.setQueryData(['project', 'p1', 'libraries'], [
      { id: '1', name: 'Lib 1' },
      { id: '2', name: 'Lib 2' },
    ]);
    
    // Simulate delete event
    window.dispatchEvent(new CustomEvent('libraryDeleted', {
      detail: { libraryId: '1', projectId: 'p1', folderId: null }
    }));
    
    // Library should be removed from list
    const cached = queryClient.getQueryData(['project', 'p1', 'libraries']);
    expect(cached).toEqual([{ id: '2', name: 'Lib 2' }]);
  });
});
```

---

## Version History

- **1.0.0** (2026-01-26): Initial contract definition

## References

- [Custom Events MDN](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent)
- [React Query Invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)

