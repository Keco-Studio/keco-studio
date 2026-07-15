# Keco Studio - Optimization Recommendations

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Related Documents**: [Architecture Document](./ARCHITECTURE.md)

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Recommendation Categories](#recommendation-categories)
3. [Key Optimization Recommendations](#key-optimization-recommendations)
4. [Implementation Priorities](#implementation-priorities)
5. [Optimization Roadmap](#optimization-roadmap)

---

## Overview

This document provides concrete optimization recommendations based on a comprehensive code review of the Keco Studio project. All recommendations are classified by **severity** (Critical, High, Medium, Low) and **type** (Performance, Maintainability, Security, Architecture).

### Severity Definitions

| Level | Definition | Impact |
|------|------|------|
| **Critical** | Issues that must be resolved immediately, affecting system stability or security | May cause system crashes, data loss, or security vulnerabilities |
| **High** | Important issues that severely impact development efficiency or user experience | Lead to development difficulties, high maintenance costs, poor user experience |
| **Medium** | Medium-priority issues with room for improvement | Affect code quality and maintainability |
| **Low** | Minor optimizations that can be improved gradually | Minor impact, but improvements are worthwhile |

---

## Recommendation Categories

### By Severity

| Severity | Count |
|---------|------|
| Critical | 3 |
| High | 8 |
| Medium | 6 |
| Low | 5 |
| **Total** | **22** |

### By Type

| Type | Count |
|------|------|
| Architecture | 5 |
| Maintainability | 8 |
| Performance | 5 |
| Security | 2 |
| Code Quality | 2 |

---

## Key Optimization Recommendations

### Critical Level

---

#### OPT-001: Oversized Component Refactoring - Sidebar.tsx (2330 lines)

**Severity**: Critical  
**Type**: Maintainability, Architecture  
**Affected Files**: `src/components/layout/Sidebar.tsx`

**Problem Description**:
The Sidebar component contains 2330 lines of code and integrates too many features:
- Project/library/folder navigation tree
- Version control sidebar
- Collaborator management
- Folder management
- Context menu
- Drag-and-drop sorting

**Current Problems**:
1. Modifying any feature risks introducing bugs
2. Hard to locate and fix bugs
3. Difficult to test (unit testing is nearly impossible)
4. Extremely high onboarding cost for new developers
5. Hard to reuse code

**Recommended Solution**:

**Split Structure**:
```
src/components/layout/
├── Sidebar.tsx (main container, under 200 lines)
├── sidebar/
│   ├── SidebarHeader.tsx
│   ├── ProjectNavigationTree.tsx (project tree)
│   ├── LibraryNavigationTree.tsx (library tree)
│   ├── FolderNavigationTree.tsx (folder tree)
│   ├── NavigationContextMenu.tsx (context menu)
│   ├── SidebarDragAndDrop.tsx (drag-and-drop logic)
│   ├── hooks/
│   │   ├── useSidebarNavigation.ts
│   │   ├── useSidebarDragDrop.ts
│   │   └── useSidebarContextMenu.ts
│   └── utils/
│       └── navigationUtils.ts
```

**Refactoring Steps**:
1. Create the new directory structure
2. Extract independent feature modules (without changing logic first)
3. Write unit tests covering each module
4. Gradually optimize each module's logic
5. Delete the old Sidebar.tsx

**Expected Benefits**:
- Each component <300 lines
- Testability improved by 90%
- Bug localization time reduced by 70%
- New feature development efficiency improved by 50%

**Estimated Effort**: 2 weeks

---

#### OPT-002: Oversized Component Refactoring - LibraryAssetsTable.tsx (2335 lines)

**Severity**: Critical  
**Type**: Maintainability, Architecture, Performance  
**Affected Files**: `src/components/libraries/LibraryAssetsTable.tsx`

**Problem Description**:
LibraryAssetsTable is the most complex component in the project, containing 2335 lines of code:
- Table rendering and layout
- Cell editing logic
- Drag-and-drop sorting
- Clipboard operations
- Batch editing
- Context menu
- Presence Avatars
- Reference field popup
- Countless useEffect and useState hooks

**Current Problems**:
1. Performance issues: large tables (>500 rows) render slowly
2. Chaotic state management: too many useState and useEffect hooks
3. Hard to trace data flow
4. Modifying one feature may break others
5. Nearly impossible to write unit tests

**Recommended Solution**:

**Split Strategy**:
```
src/components/libraries/
├── LibraryAssetsTable.tsx (main container, <200 lines)
├── table/
│   ├── TableCore.tsx (core table rendering)
│   ├── TableVirtualized.tsx (virtualized table, performance optimization)
│   ├── TableHeader.tsx (table header)
│   ├── TableRow.tsx (row component)
│   ├── TableCell.tsx (cell)
│   ├── CellEditor/ (cell editors)
│   │   ├── TextCellEditor.tsx
│   │   ├── NumberCellEditor.tsx
│   │   ├── BooleanCellEditor.tsx
│   │   ├── DateCellEditor.tsx
│   │   ├── ReferenceCellEditor.tsx
│   │   └── index.ts
│   ├── TableContextMenu.tsx
│   ├── TableToast.tsx
│   ├── BatchEditMenu.tsx
│   └── EmptyState.tsx
```

**Performance Optimization**:
```typescript
// 1. Use virtualized rendering (react-window or @tanstack/react-virtual recommended)
import { useVirtualizer } from '@tanstack/react-virtual';

// 2. Use React.memo to optimize row components
const TableRow = React.memo(({ row }) => {
  // ...
}, (prevProps, nextProps) => {
  return prevProps.row.id === nextProps.row.id 
    && prevProps.row.updatedAt === nextProps.row.updatedAt;
});

// 3. Use useMemo to optimize computations
const sortedRows = useMemo(() => {
  return rows.sort((a, b) => a.order - b.order);
}, [rows]);
```

**State Management Optimization**:
```typescript
// Use useReducer instead of multiple useState hooks
type TableState = {
  selectedCells: Set<string>;
  editingCell: { rowId: string; fieldId: string } | null;
  hoveredRow: string | null;
  contextMenu: { x: number; y: number; rowId: string } | null;
};

const [state, dispatch] = useReducer(tableReducer, initialState);
```

**Expected Benefits**:
- Rendering performance improved by 80% (virtualization)
- Code readability improved by 90%
- Bug localization time reduced by 80%
- Support for large tables (>10,000 rows)

**Estimated Effort**: 3 weeks

---

#### OPT-003: Enable TypeScript Strict Mode

**Severity**: Critical  
**Type**: Code Quality, Maintainability  
**Affected Files**: `tsconfig.json`, all TypeScript files

**Problem Description**:
```json
{
  "compilerOptions": {
    "strict": false  // ❌ The problem
  }
}
```

The project currently has TypeScript strict mode disabled, resulting in:
1. Large numbers of `any` types, losing type safety
2. Potential runtime errors (null/undefined)
3. Inaccurate IDE hints
4. High refactoring risk

**Problem Example**:
```typescript
// Current code (risky)
function updateAsset(asset: any) {  // ❌ any type
  return asset.name.toUpperCase();  // possible runtime error
}

// Should be
function updateAsset(asset: Asset | null) {  // ✅ explicit type
  return asset?.name.toUpperCase() ?? '';   // ✅ safe access
}
```

**Recommended Solution**:

**Enable Strict Mode in Steps**:
```json
// tsconfig.json
{
  "compilerOptions": {
    // Step 1: enable basic strict checks
    "noImplicitAny": true,           // disallow implicit any
    "strictNullChecks": true,        // strict null checks
    
    // Step 2: enable stricter checks
    "strictFunctionTypes": true,     // strict function types
    "strictBindCallApply": true,     // strict bind/call/apply
    
    // Step 3: fully enable
    "strict": true
  }
}
```

**Fix Steps**:
1. Enable `noImplicitAny` and fix all errors (estimated 200+)
2. Enable `strictNullChecks` and add null/undefined checks
3. Enable `strictFunctionTypes` and other options
4. Finally enable `strict: true`

**Common Fix Patterns**:
```typescript
// 1. Fixing any types
- function handleData(data: any)
+ function handleData(data: AssetRow | null)

// 2. Fixing null checks
- const name = user.profile.name;
+ const name = user?.profile?.name ?? 'Unknown';

// 3. Fixing type assertions
- const element = document.querySelector('.btn') as HTMLElement;
+ const element = document.querySelector('.btn');
+ if (element instanceof HTMLElement) { ... }
```

**Expected Benefits**:
- Runtime errors reduced by 60%
- IDE hint accuracy improved by 100%
- Increased refactoring confidence
- Improved code quality

**Estimated Effort**: 2 weeks

---

### High Level

---

#### OPT-004: Unify and Clean Up Directory Structure

**Severity**: High  
**Type**: Maintainability, Architecture  
**Affected Files**: Entire project

**Problem Description**:
The directory structure is disorganized, with duplicate directories:
1. `src/contexts/` and `src/lib/contexts/` coexist
2. `src/hooks/` and `src/lib/hooks/` coexist
3. Hooks inside components are scattered

**Current Structure**:
```
src/
├── contexts/          # ❌ old directory, only 1 file
│   └── YjsContext.tsx
├── hooks/             # ❌ old directory, only 1 file
│   └── useYjsRows.ts
└── lib/
    ├── contexts/      # ✅ new directory
    │   ├── AuthContext.tsx
    │   ├── LibraryDataContext.tsx
    │   └── ...
    └── hooks/         # ✅ new directory
        ├── useRealtimeSubscription.ts
        └── ...
```

**Recommended Solution**:

**Unified Directory Structure**:
```
src/
├── lib/
│   ├── contexts/           # all Contexts unified here
│   │   ├── AuthContext.tsx
│   │   ├── LibraryDataContext.tsx
│   │   ├── PresenceContext.tsx
│   │   ├── NavigationContext.tsx
│   │   └── YjsContext.tsx      # moved from src/contexts/
│   └── hooks/              # all global hooks unified here
│       ├── useRealtimeSubscription.ts
│       ├── usePresenceTracking.ts
│       ├── useYjsRows.ts       # moved from src/hooks/
│       └── ...
```

**Directories to Delete**:
- `src/contexts/` (delete after migration)
- `src/hooks/` (delete after migration)

**Update All Import Paths**:
```typescript
// Old path
- import { YjsContext } from '@/contexts/YjsContext';
// New path
+ import { YjsContext } from '@/lib/contexts/YjsContext';
```

**Expected Benefits**:
- Clearer code structure
- Less time spent finding files
- Avoid duplicate code
- Easier for new developers to understand

**Estimated Effort**: 1 week

---

#### OPT-005: Reduce Relative Import Paths, Standardize on Alias Imports

**Severity**: High  
**Type**: Maintainability  
**Affected Files**: 86 files use relative imports

**Problem Description**:
Many files use `../` relative imports, resulting in:
1. Import paths that are hard to understand
2. Many imports needing updates when files are moved
3. Poor code readability

**Problem Example**:
```typescript
// ❌ Hard-to-understand relative paths
import { something } from '../../../../lib/services/projectService';
import { another } from '../../../hooks/useData';
import { Component } from '../../components/Modal';

// ✅ Clear alias paths
import { something } from '@/lib/services/projectService';
import { another } from '@/lib/hooks/useData';
import { Component } from '@/components/Modal';
```

**Current Configuration**:
```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]  // ✅ configured, but underused
    }
  }
}
```

**Recommended Solution**:

**Batch-Replace Relative Imports**:
```bash
# Batch-replace via script (needs to be written)
npm run fix:imports
```

**Recommended Import Conventions**:
```typescript
// 1. External libraries
import React from 'react';
import { useQuery } from '@tanstack/react-query';

// 2. Internal modules (use alias)
import { projectService } from '@/lib/services/projectService';
import { useAuth } from '@/lib/contexts/AuthContext';
import { Button } from '@/components/ui/Button';

// 3. Relative imports (only for same directory or subdirectories)
import { TableRow } from './TableRow';
import { useTableData } from './hooks/useTableData';
```

**Expected Benefits**:
- Clearer import paths
- Easier to move files
- Improved code readability
- More accurate IDE autocompletion

**Estimated Effort**: 3 days

---

#### OPT-006: LibraryDataContext Has Too Many Responsibilities and Needs Splitting

**Severity**: High  
**Type**: Architecture, Maintainability  
**Affected Files**: `src/lib/contexts/LibraryDataContext.tsx` (668 lines)

**Problem Description**:
LibraryDataContext integrates too many responsibilities:
1. Yjs document management
2. IndexedDB persistence
3. Supabase Realtime subscription
4. Presence tracking
5. Asset CRUD operations
6. Batch operations
7. Cache management

**Current Problems**:
1. Single file is too large (668 lines)
2. Hard to test
3. Complex state management
4. Hard to understand data flow

**Recommended Solution**:

**Split Into Multiple Contexts**:
```
src/lib/contexts/
├── library-data/
│   ├── LibraryDataContext.tsx      # main Context (<100 lines)
│   ├── YjsDocumentContext.tsx      # Yjs document management
│   ├── RealtimeSyncContext.tsx     # Realtime sync
│   ├── AssetOperationsContext.tsx  # asset operations
│   └── hooks/
│       ├── useYjsDocument.ts
│       ├── useRealtimeSync.ts
│       └── useAssetOperations.ts
```

**Usage After Refactoring**:
```typescript
// Compose multiple Providers
<LibraryDataProvider libraryId={id}>
  <YjsDocumentProvider>
    <RealtimeSyncProvider>
      <AssetOperationsProvider>
        {children}
      </AssetOperationsProvider>
    </RealtimeSyncProvider>
  </YjsDocumentProvider>
</LibraryDataProvider>

// Or use a combined Provider
<CombinedLibraryProvider libraryId={id}>
  {children}
</CombinedLibraryProvider>
```

**Expected Benefits**:
- Each Context <150 lines
- Clear responsibilities
- Improved testability
- Improved reusability

**Estimated Effort**: 1.5 weeks

---

#### OPT-007: Implement Virtualized Table Rendering

**Severity**: High  
**Type**: Performance  
**Affected Files**: `src/components/libraries/LibraryAssetsTable.tsx`

**Problem Description**:
The table currently renders all rows, resulting in:
1. Large tables (>500 rows) rendering slowly
2. Janky scrolling
3. High memory usage
4. Possible browser freezes

**Performance Test Results** (estimated):
| Rows | Current Render Time | After Virtualization |
|------|------------|----------|
| 100  | 200ms      | 50ms     |
| 500  | 1000ms     | 80ms     |
| 1000 | 2000ms+    | 100ms    |
| 5000 | Freezes    | 150ms    |

**Recommended Solution**:

**Use a Virtualization Library**:
```bash
npm install @tanstack/react-virtual
```

**Implement a Virtualized Table**:
```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualizedTable({ rows }: { rows: AssetRow[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48, // row height 48px
    overscan: 10, // pre-render 10 rows
  });
  
  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={row.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <TableRow row={row} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Expected Benefits**:
- Rendering performance improved by 80%
- Support for tables with 10,000+ rows
- Memory usage reduced by 70%
- Smooth scrolling

**Estimated Effort**: 1 week

---

#### OPT-008: Optimize Yjs and Supabase Dual-State Synchronization

**Severity**: High  
**Type**: Architecture, Performance  
**Affected Files**: `src/lib/contexts/LibraryDataContext.tsx`, `src/lib/hooks/useRealtimeSubscription.ts`

**Problem Description**:
The current architecture uses a two-layer setup of Yjs (local CRDT) + Supabase Realtime (remote subscription), which has issues:
1. Dual sources of truth that may become inconsistent
2. Data out of sync during network interruptions
3. Complex conflict-resolution logic
4. Hard to debug

**Current Data Flow**:
```
User edit → Yjs Doc → component re-render
         ↓
    Supabase DB ← Realtime subscription → other clients
```

**Problem Scenarios**:
1. **Scenario 1**: User edits offline; Yjs has the data but the DB is not updated
2. **Scenario 2**: Realtime subscription fails; other users don't see updates
3. **Scenario 3**: Yjs and DB data conflict, and it's unclear which one wins

**Recommended Solution**:

**Option A: Standardize on Supabase Realtime (recommended)**
```typescript
// Remove Yjs and rely entirely on Supabase
// Pros: single source of truth, simple
// Cons: weaker offline support

// Use React Query + Realtime
const { data: assets } = useQuery({
  queryKey: ['library', libraryId, 'assets'],
  queryFn: () => libraryAssetsService.getAssets(libraryId),
});

useRealtimeSubscription({
  channel: `library:${libraryId}`,
  table: 'library_assets',
  onInsert: (payload) => {
    queryClient.setQueryData(['library', libraryId, 'assets'], (old) => [
      ...old,
      payload.new,
    ]);
  },
  onUpdate: (payload) => {
    queryClient.setQueryData(['library', libraryId, 'assets'], (old) =>
      old.map((asset) =>
        asset.id === payload.new.id ? payload.new : asset
      )
    );
  },
});
```

**Option B: Yjs + Supabase Provider (more complex but more powerful)**
```typescript
// Use a y-supabase provider (if one exists)
// or implement Yjs-to-Supabase sync yourself
import { SupabaseProvider } from 'y-supabase'; // assuming this library exists

const provider = new SupabaseProvider(
  yDoc,
  supabase,
  {
    table: 'library_assets',
    libraryId,
  }
);
```

**Option C: Keep the status quo but improve the sync logic**
```typescript
// Add sync status tracking
type SyncStatus = {
  yjsVersion: number;
  dbVersion: number;
  isSynced: boolean;
  pendingChanges: number;
};

// Add a conflict-resolution strategy
function resolveConflict(yjsData, dbData) {
  // Resolve conflicts using timestamps or version numbers
  return yjsData.updatedAt > dbData.updatedAt ? yjsData : dbData;
}
```

**Expected Benefits**:
- Improved data consistency
- Fewer sync bugs
- Simplified architecture
- Easier to debug

**Estimated Effort**: 
- Option A: 2 weeks
- Option B: 3-4 weeks
- Option C: 1 week

**Recommendation**: Option A (simplify the architecture)

---

#### OPT-009: Increase Unit Test Coverage

**Severity**: High  
**Type**: Code Quality, Maintainability  
**Affected Files**: Core business logic files (Services, Hooks, Utils)

**Problem Description**:
The project currently only has E2E tests and lacks unit tests:
1. High refactoring risk
2. Bug fixing is difficult
3. Core logic is not covered by tests
4. Slow test feedback (E2E tests are slow)

**Current Test Coverage**:
```
✅ E2E tests (Playwright): 10+ test specs
❌ Unit tests: 0%
❌ Integration tests: 0%
```

**Recommended Solution**:

**Install a Test Framework**:
```bash
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom
```

**Configure vitest**:
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Modules to Test First**:

**1. Services layer (business logic)**:
```typescript
// src/lib/services/__tests__/projectService.test.ts
import { describe, it, expect, vi } from 'vitest';
import { projectService } from '../projectService';

describe('projectService', () => {
  it('should create project with default library', async () => {
    const mockSupabase = createMockSupabase();
    const result = await projectService.createProject(mockSupabase, {
      name: 'Test Project',
    });
    expect(result).toHaveProperty('id');
    expect(result.name).toBe('Test Project');
  });
});
```

**2. Utils layer (utility functions)**:
```typescript
// src/lib/utils/__tests__/nameValidation.test.ts
import { describe, it, expect } from 'vitest';
import { validateProjectName } from '../nameValidation';

describe('validateProjectName', () => {
  it('should accept valid names', () => {
    expect(validateProjectName('My Project')).toBe(true);
  });
  
  it('should reject empty names', () => {
    expect(validateProjectName('')).toBe(false);
  });
  
  it('should reject names with special characters', () => {
    expect(validateProjectName('Project<>')).toBe(false);
  });
});
```

**3. Hooks layer (custom hooks)**:
```typescript
// src/lib/hooks/__tests__/useCollaboratorPermissions.test.ts
import { renderHook } from '@testing-library/react';
import { useCollaboratorPermissions } from '../useCollaboratorPermissions';

describe('useCollaboratorPermissions', () => {
  it('should return admin permissions for owner', () => {
    const { result } = renderHook(() =>
      useCollaboratorPermissions('project-id', 'owner-id')
    );
    expect(result.current.canEdit).toBe(true);
    expect(result.current.canDelete).toBe(true);
  });
});
```

**Test Coverage Targets**:
| Module | Target Coverage |
|------|-----------|
| Services | 80% |
| Utils | 90% |
| Hooks | 70% |
| Components | 50% |

**Expected Benefits**:
- Increased refactoring confidence
- Bugs discovered earlier
- Documentation value (tests as documentation)
- Improved development efficiency

**Estimated Effort**: 3-4 weeks

---

#### OPT-010: Unify the Error-Handling Strategy

**Severity**: High  
**Type**: Maintainability, User Experience  
**Affected Files**: All API routes, service layer, component layer

**Problem Description**:
Error handling is currently inconsistent:
1. Inconsistent error formats across API routes
2. Scattered client-side error handling
3. Error messages shown to users are unfriendly
4. Missing error logging and monitoring

**Current Problem Example**:
```typescript
// API route A
return NextResponse.json({ error: 'Not found' }, { status: 404 });

// API route B  
return NextResponse.json({ message: 'Error occurred' }, { status: 500 });

// API route C
throw new Error('Something went wrong');
```

**Recommended Solution**:

**1. Unified Error Types**:
```typescript
// src/lib/errors/AppError.ts
export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Predefined errors
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super('UNAUTHORIZED', 'Unauthorized access', 401);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}
```

**2. API Route Error-Handling Middleware**:
```typescript
// src/lib/api/errorHandler.ts
export function withErrorHandler(
  handler: (req: Request) => Promise<Response>
) {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (error) {
      if (error instanceof AppError) {
        return NextResponse.json(
          {
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
            },
          },
          { status: error.statusCode }
        );
      }
      
      // Unknown error
      console.error('Unexpected error:', error);
      return NextResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        },
        { status: 500 }
      );
    }
  };
}

// Usage
export const POST = withErrorHandler(async (req: Request) => {
  const user = await getUser();
  if (!user) throw new UnauthorizedError();
  
  // Business logic...
});
```

**3. Client-Side Error Handling**:
```typescript
// src/lib/hooks/useErrorHandler.ts
export function useErrorHandler() {
  const showError = (error: Error | AppError) => {
    if (error instanceof AppError) {
      message.error(error.message);
    } else {
      message.error('An unexpected error occurred');
    }
  };
  
  return { showError };
}

// Usage
const { showError } = useErrorHandler();

try {
  await projectService.createProject(...);
} catch (error) {
  showError(error as Error);
}
```

**4. Error Monitoring (Sentry recommended)**:
```typescript
// src/lib/monitoring/sentry.ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
});

// Send to Sentry in the error handler
if (error instanceof AppError) {
  Sentry.captureException(error, {
    tags: {
      errorCode: error.code,
      statusCode: error.statusCode,
    },
  });
}
```

**Expected Benefits**:
- Unified error handling
- Improved user experience
- Easier debugging
- Error monitoring and tracing

**Estimated Effort**: 1 week

---

#### OPT-011: Optimize React Query Caching Strategy

**Severity**: High  
**Type**: Performance  
**Affected Files**: All components using React Query

**Problem Description**:
The current React Query configuration may not be optimal:
1. Unreasonable cache time settings
2. Unclear cache-invalidation strategy
3. Optimistic updates underused
4. Possible duplicate requests

**Recommended Solution**:

**1. Optimize Query Configuration**:
```typescript
// src/lib/providers/QueryProvider.tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // data considered fresh for 5 minutes
      cacheTime: 10 * 60 * 1000, // cache retained for 10 minutes
      refetchOnWindowFocus: true, // refetch on window focus
      refetchOnMount: true,
      retry: 1, // retry once on failure
    },
    mutations: {
      retry: 0, // do not retry mutations
    },
  },
});
```

**2. Optimize the Query Keys Strategy**:
```typescript
// src/lib/utils/queryKeys.ts
export const queryKeys = {
  // Hierarchical query key structure
  projects: {
    all: ['projects'] as const,
    lists: () => [...queryKeys.projects.all, 'list'] as const,
    list: (filters: string) => [...queryKeys.projects.lists(), { filters }] as const,
    details: () => [...queryKeys.projects.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.projects.details(), id] as const,
  },
  libraries: {
    all: ['libraries'] as const,
    lists: () => [...queryKeys.libraries.all, 'list'] as const,
    list: (projectId: string) => [...queryKeys.libraries.lists(), projectId] as const,
    details: () => [...queryKeys.libraries.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.libraries.details(), id] as const,
    assets: (libraryId: string) => ['library-assets', libraryId] as const,
  },
} as const;
```

**3. Use Optimistic Updates**:
```typescript
// Example: optimistically updating an asset name
const updateAssetMutation = useMutation({
  mutationFn: (data: { assetId: string; name: string }) =>
    libraryAssetsService.updateAsset(data.assetId, { name: data.name }),
  
  // Optimistic update
  onMutate: async (newData) => {
    // Cancel in-flight queries
    await queryClient.cancelQueries({
      queryKey: queryKeys.libraries.assets(libraryId),
    });
    
    // Save previous data (for rollback)
    const previousAssets = queryClient.getQueryData(
      queryKeys.libraries.assets(libraryId)
    );
    
    // Optimistically update the cache
    queryClient.setQueryData(
      queryKeys.libraries.assets(libraryId),
      (old: Asset[]) =>
        old.map((asset) =>
          asset.id === newData.assetId
            ? { ...asset, name: newData.name }
            : asset
        )
    );
    
    return { previousAssets };
  },
  
  // Roll back on error
  onError: (err, newData, context) => {
    queryClient.setQueryData(
      queryKeys.libraries.assets(libraryId),
      context.previousAssets
    );
  },
  
  // Refetch after settling
  onSettled: () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.libraries.assets(libraryId),
    });
  },
});
```

**4. Prefetch Data**:
```typescript
// Prefetch next page of data
function ProjectList() {
  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.lists(),
    queryFn: projectService.getProjects,
  });
  
  // Prefetch project details on mouse hover
  const prefetchProject = (projectId: string) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.projects.detail(projectId),
      queryFn: () => projectService.getProject(projectId),
    });
  };
  
  return (
    <div>
      {projects.map((project) => (
        <div
          key={project.id}
          onMouseEnter={() => prefetchProject(project.id)}
        >
          {project.name}
        </div>
      ))}
    </div>
  );
}
```

**Expected Benefits**:
- Fewer duplicate requests
- Improved user experience (optimistic updates)
- Performance improvements
- Clearer cache management

**Estimated Effort**: 1 week

---

### Medium Level

---

#### OPT-012: Optimize Realtime Subscription Management

**Severity**: Medium  
**Type**: Performance, Maintainability  
**Affected Files**: `src/lib/hooks/useRealtimeSubscription.ts`

**Problem Description**:
Current Realtime subscriptions may have:
1. Subscriptions not cleaned up properly (memory leaks)
2. Duplicate subscriptions to the same channel
3. Too many subscriptions causing performance issues

**Recommended Solution**:

**1. Unified Subscription Manager**:
```typescript
// src/lib/realtime/SubscriptionManager.ts
class SubscriptionManager {
  private channels = new Map<string, RealtimeChannel>();
  
  subscribe(channelName: string, config: ChannelConfig) {
    // If already subscribed, return the existing channel
    if (this.channels.has(channelName)) {
      return this.channels.get(channelName)!;
    }
    
    const channel = supabase.channel(channelName);
    this.channels.set(channelName, channel);
    return channel;
  }
  
  unsubscribe(channelName: string) {
    const channel = this.channels.get(channelName);
    if (channel) {
      channel.unsubscribe();
      this.channels.delete(channelName);
    }
  }
  
  cleanup() {
    this.channels.forEach((channel) => channel.unsubscribe());
    this.channels.clear();
  }
}

export const subscriptionManager = new SubscriptionManager();
```

**2. Optimized Hook**:
```typescript
export function useRealtimeSubscription(config: SubscriptionConfig) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  
  useEffect(() => {
    channelRef.current = subscriptionManager.subscribe(
      config.channelName,
      config
    );
    
    return () => {
      if (channelRef.current) {
        subscriptionManager.unsubscribe(config.channelName);
      }
    };
  }, [config.channelName]);
}
```

**Expected Benefits**:
- Avoid memory leaks
- Avoid duplicate subscriptions
- Clearer subscription management

**Estimated Effort**: 3 days

---

#### OPT-013: Add Loading States and Error Boundaries

**Severity**: Medium  
**Type**: User Experience, Maintainability  
**Affected Files**: All components

**Problem Description**:
Missing unified Loading and Error UI:
1. Inconsistent loading states
2. Missing error boundaries
3. Poor user experience

**Recommended Solution**:

**1. Global Error Boundary**:
```typescript
// src/components/ErrorBoundary.tsx
'use client';

import React from 'react';
import { Result, Button } from 'antd';

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="Something went wrong"
          subTitle={this.state.error?.message}
          extra={
            <Button
              type="primary"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </Button>
          }
        />
      );
    }
    
    return this.props.children;
  }
}
```

**2. Loading Component**:
```typescript
// src/components/Loading.tsx
export function Loading({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div className={fullScreen ? 'loading-fullscreen' : 'loading'}>
      <Spin size="large" />
    </div>
  );
}
```

**3. Use Suspense**:
```typescript
// Use in layout
<Suspense fallback={<Loading fullScreen />}>
  <ErrorBoundary>
    {children}
  </ErrorBoundary>
</Suspense>
```

**Expected Benefits**:
- Improved user experience
- Unified error handling
- Cleaner code

**Estimated Effort**: 2 days

---

#### OPT-014: Optimize File Upload Logic

**Severity**: Medium  
**Type**: User Experience, Performance  
**Affected Files**: `src/lib/services/imageUploadService.ts`, `src/lib/services/mediaFileUploadService.ts`

**Problem Description**:
Current file uploads lack:
1. Upload progress display
2. File compression
3. Resumable uploads
4. Batch upload optimization

**Recommended Solution**:

**1. Add Upload Progress**:
```typescript
export async function uploadImageWithProgress(
  file: File,
  onProgress: (progress: number) => void
): Promise<string> {
  const fileName = `${Date.now()}-${file.name}`;
  
  const { data, error } = await supabase.storage
    .from('tiptap-images')
    .upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
      onUploadProgress: (progress) => {
        const percent = (progress.loaded / progress.total) * 100;
        onProgress(percent);
      },
    });
  
  if (error) throw error;
  return data.path;
}
```

**2. Image Compression**:
```typescript
import imageCompression from 'browser-image-compression';

export async function compressImage(file: File): Promise<File> {
  const options = {
    maxSizeMB: 1,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
  };
  
  return await imageCompression(file, options);
}
```

**3. Batch Upload Optimization**:
```typescript
export async function uploadMultipleFiles(
  files: File[],
  onProgress: (fileIndex: number, progress: number) => void
): Promise<string[]> {
  // Limit concurrency to 3
  const concurrency = 3;
  const results: string[] = [];
  
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((file, index) =>
        uploadImageWithProgress(file, (progress) => {
          onProgress(i + index, progress);
        })
      )
    );
    results.push(...batchResults);
  }
  
  return results;
}
```

**Expected Benefits**:
- Improved user experience
- Higher upload success rate
- Performance optimization

**Estimated Effort**: 1 week

---

#### OPT-015: Add Code Comments and Documentation

**Severity**: Medium  
**Type**: Maintainability  
**Affected Files**: All core modules

**Problem Description**:
Insufficient code comments:
1. Complex functions lack comments
2. Business logic is unclear
3. New developers struggle to understand the code

**Recommended Solution**:

**1. Add JSDoc Comments**:
```typescript
/**
 * Creates a new project and returns the project ID and default library ID
 * 
 * @param supabase - Supabase client instance
 * @param data - Project data
 * @param data.name - Project name (required)
 * @param data.description - Project description (optional)
 * @returns An object containing projectId and defaultLibraryId
 * @throws {ValidationError} When the project name is empty
 * @throws {UnauthorizedError} When the user is not logged in
 * 
 * @example
 * ```typescript
 * const result = await projectService.createProject(supabase, {
 *   name: 'My New Project',
 *   description: 'Project description'
 * });
 * console.log(result.projectId);
 * ```
 */
export async function createProject(
  supabase: SupabaseClient,
  data: { name: string; description?: string }
): Promise<{ projectId: string; defaultLibraryId: string }> {
  // Implementation...
}
```

**2. Add README Files**:
```markdown
# Project Service

## Overview
The project service is responsible for managing project creation, updates, deletion, and other operations.

## API

### createProject
Creates a new project...

## Usage Example
\`\`\`typescript
import { projectService } from '@/lib/services/projectService';

const project = await projectService.createProject(supabase, {
  name: 'My Project'
});
\`\`\`

## Related Modules
- `libraryService`: manages asset libraries within projects
- `collaborationService`: manages project collaborators
```

**3. Generate API Documentation**:
```bash
# Generate docs with TypeDoc
npm install --save-dev typedoc
npx typedoc --out docs/api src/lib/services
```

**Expected Benefits**:
- Improved code readability
- Faster onboarding for new developers
- Easier maintenance

**Estimated Effort**: 2 weeks

---

#### OPT-016: Optimize Database Query Performance

**Severity**: Medium  
**Type**: Performance  
**Affected Files**: All service files

**Problem Description**:
Possible database performance issues:
1. N+1 query problems
2. Missing necessary indexes
3. Database functions not used for optimization

**Recommended Solution**:

**1. Use JOINs to Avoid N+1 Queries**:
```typescript
// ❌ N+1 queries
const projects = await supabase.from('projects').select('*');
for (const project of projects) {
  const libraries = await supabase
    .from('libraries')
    .select('*')
    .eq('project_id', project.id);
  project.libraries = libraries;
}

// ✅ Single query with JOIN
const projects = await supabase
  .from('projects')
  .select(`
    *,
    libraries (
      id,
      name,
      description,
      created_at
    )
  `);
```

**2. Add Database Indexes**:
```sql
-- Check for missing indexes
-- library_assets is frequently queried by library_id
CREATE INDEX IF NOT EXISTS idx_library_assets_library_id 
  ON library_assets(library_id);

-- library_asset_values is frequently queried by asset_id
CREATE INDEX IF NOT EXISTS idx_library_asset_values_asset_id 
  ON library_asset_values(asset_id);

-- Add a composite index
CREATE INDEX IF NOT EXISTS idx_collaborators_project_user 
  ON project_collaborators(project_id, user_id)
  WHERE accepted_at IS NOT NULL;
```

**3. Use Database Functions**:
```sql
-- Create a function to fetch a library's full data (including field definitions and assets)
CREATE OR REPLACE FUNCTION get_library_full_data(p_library_id UUID)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'library', (SELECT row_to_json(l) FROM libraries l WHERE l.id = p_library_id),
    'fields', (SELECT json_agg(row_to_json(f)) FROM library_field_definitions f WHERE f.library_id = p_library_id),
    'assets', (SELECT json_agg(
      json_build_object(
        'id', a.id,
        'name', a.name,
        'values', (SELECT json_object_agg(v.field_id, v.value_json) FROM library_asset_values v WHERE v.asset_id = a.id)
      )
    ) FROM library_assets a WHERE a.library_id = p_library_id)
  ) INTO result;
  
  RETURN result;
END;
$$;
```

**Expected Benefits**:
- Query performance improved by 50-80%
- Reduced database load
- Improved user experience

**Estimated Effort**: 1 week

---

#### OPT-017: Implement Data Export

**Severity**: Medium  
**Type**: Feature, User Experience  
**Affected Files**: New feature

**Problem Description**:
Data export is currently missing, so users cannot:
1. Export asset data to Excel/CSV
2. Back up data
3. Use their data in other tools

**Recommended Solution**:

**1. Implement CSV Export**:
```typescript
// src/lib/utils/exportUtils.ts
export function exportToCSV(
  assets: AssetRow[],
  fields: FieldDefinition[]
): string {
  const headers = ['ID', 'Name', ...fields.map((f) => f.field_name)];
  const rows = assets.map((asset) => [
    asset.id,
    asset.name,
    ...fields.map((field) => {
      const value = asset.values[field.id];
      return formatValueForCSV(value, field.data_type);
    }),
  ]);
  
  const csv = [
    headers.join(','),
    ...rows.map((row) => row.map(escapeCsvValue).join(',')),
  ].join('\n');
  
  return csv;
}

function formatValueForCSV(value: any, dataType: string): string {
  if (value === null || value === undefined) return '';
  
  switch (dataType) {
    case 'date':
      return new Date(value).toLocaleDateString();
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'reference':
      return value.map((v: any) => v.name).join('; ');
    default:
      return String(value);
  }
}

function escapeCsvValue(value: any): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Trigger download
export function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}
```

**2. Implement Excel Export (using exceljs)**:
```typescript
import ExcelJS from 'exceljs';

export async function exportToExcel(
  assets: AssetRow[],
  fields: FieldDefinition[],
  libraryName: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(libraryName);
  
  // Set up columns
  worksheet.columns = [
    { header: 'ID', key: 'id', width: 36 },
    { header: 'Name', key: 'name', width: 30 },
    ...fields.map((field) => ({
      header: field.field_name,
      key: field.id,
      width: 20,
    })),
  ];
  
  // Add data
  assets.forEach((asset) => {
    const row: any = {
      id: asset.id,
      name: asset.name,
    };
    fields.forEach((field) => {
      row[field.id] = formatValueForExcel(
        asset.values[field.id],
        field.data_type
      );
    });
    worksheet.addRow(row);
  });
  
  // Download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${libraryName}_${Date.now()}.xlsx`;
  link.click();
}
```

**3. Add an Export Button**:
```typescript
// Add an export button in LibraryHeader
<Button
  icon={<DownloadOutlined />}
  onClick={() => {
    const csv = exportToCSV(assets, fields);
    downloadCSV(csv, `${library.name}_${Date.now()}.csv`);
  }}
>
  Export CSV
</Button>
```

**Expected Benefits**:
- Users can back up their data
- Supports data analysis
- Improved user satisfaction

**Estimated Effort**: 3-4 days

---

### Low Level

---

#### OPT-018: Enable ESLint Rule Optimizations

**Severity**: Low  
**Type**: Code Quality  
**Affected Files**: `eslint.config.js`, all TypeScript files

**Problem Description**:
The current ESLint configuration may not be strict enough; enabling more rules is recommended:
1. Unused variables
2. console.log statements
3. debugger statements
4. Magic numbers

**Recommended Solution**:
```javascript
// eslint.config.js
export default {
  extends: ['next/core-web-vitals', 'plugin:@typescript-eslint/recommended'],
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-magic-numbers': ['warn', { ignore: [0, 1, -1] }],
  },
};
```

**Estimated Effort**: 2 days

---

#### OPT-019: Add Performance Monitoring

**Severity**: Low  
**Type**: Performance, Monitoring  
**Affected Files**: New feature

**Problem Description**:
Missing performance monitoring, so it is impossible to:
1. Track page load times
2. Monitor API response times
3. Identify performance bottlenecks

**Recommended Solution**:

**Use Vercel Analytics (if deployed on Vercel)**:
```bash
npm install @vercel/analytics
```

```typescript
// app/layout.tsx
import { Analytics } from '@vercel/analytics/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

**Or use Google Analytics**:
```typescript
// lib/analytics.ts
export function trackPageView(url: string) {
  if (typeof window.gtag !== 'undefined') {
    window.gtag('config', 'GA_MEASUREMENT_ID', {
      page_path: url,
    });
  }
}

export function trackEvent(action: string, params?: any) {
  if (typeof window.gtag !== 'undefined') {
    window.gtag('event', action, params);
  }
}
```

**Estimated Effort**: 1 day

---

#### OPT-020: Optimize Bundle Size

**Severity**: Low  
**Type**: Performance  
**Affected Files**: `next.config.mjs`

**Problem Description**:
The bundle may be too large, affecting first-screen load time

**Recommended Solution**:

**1. Analyze the Bundle**:
```bash
npm install --save-dev @next/bundle-analyzer
```

```javascript
// next.config.mjs
import withBundleAnalyzer from '@next/bundle-analyzer';

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default bundleAnalyzer({
  // next config...
});
```

```bash
ANALYZE=true npm run build
```

**2. Optimize Imports**:
```typescript
// ❌ Import the entire library
import { Button, Modal, Table } from 'antd';

// ✅ Import only the components needed (if supported)
import Button from 'antd/lib/button';
import Modal from 'antd/lib/modal';
```

**3. Code Splitting**:
```typescript
// Dynamically import large components
const HeavyComponent = dynamic(
  () => import('@/components/HeavyComponent'),
  { loading: () => <Loading /> }
);
```

**Estimated Effort**: 2 days

---

#### OPT-021: Add Keyboard Shortcuts

**Severity**: Low  
**Type**: User Experience  
**Affected Files**: New feature

**Problem Description**:
Missing keyboard shortcuts, reducing power-user efficiency

**Recommended Solution**:

**Implement a Shortcut System**:
```typescript
// src/lib/hooks/useKeyboardShortcuts.ts
import { useEffect } from 'react';

type ShortcutConfig = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  handler: () => void;
};

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const isCtrl = !shortcut.ctrl || event.ctrlKey;
        const isShift = !shortcut.shift || event.shiftKey;
        const isMeta = !shortcut.meta || event.metaKey;
        const isKey = event.key.toLowerCase() === shortcut.key.toLowerCase();
        
        if (isCtrl && isShift && isMeta && isKey) {
          event.preventDefault();
          shortcut.handler();
          break;
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
}

// Usage
useKeyboardShortcuts([
  {
    key: 'n',
    ctrl: true,
    handler: () => setShowNewProjectModal(true),
  },
  {
    key: 's',
    ctrl: true,
    handler: () => saveProject(),
  },
]);
```

**Suggested Common Shortcuts**:
- `Ctrl+N`: New project/library
- `Ctrl+S`: Save
- `Ctrl+F`: Search
- `Ctrl+Z`: Undo
- `Ctrl+Shift+Z`: Redo
- `Delete`: Delete selected item
- `Esc`: Close popup

**Estimated Effort**: 3 days

---

#### OPT-022: Improve Mobile Responsive Design

**Severity**: Low  
**Type**: User Experience  
**Affected Files**: All component CSS

**Problem Description**:
The current design may primarily target desktop, with a poor mobile experience

**Recommended Solution**:

**1. Add Responsive Breakpoints**:
```css
/* globals.css */
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    left: -280px;
    transition: left 0.3s;
  }
  
  .sidebar.open {
    left: 0;
  }
  
  .table-container {
    overflow-x: auto;
  }
}
```

**2. Mobile-Optimized Components**:
```typescript
function MobileMenu() {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <>
      <Button
        className="mobile-menu-button"
        onClick={() => setIsOpen(true)}
      >
        <MenuOutlined />
      </Button>
      
      <Drawer
        open={isOpen}
        onClose={() => setIsOpen(false)}
        placement="left"
      >
        <Sidebar />
      </Drawer>
    </>
  );
}
```

**Estimated Effort**: 1 week

---

### Security Level

---

#### OPT-023: Strengthen File Upload Security

**Severity**: High (Security-related)  
**Type**: Security  
**Affected Files**: `src/lib/services/imageUploadService.ts`, `src/lib/services/mediaFileUploadService.ts`

**Problem Description**:
File uploads may carry security risks:
1. File type validation is not strict enough
2. File names are not sanitized (possible XSS)
3. File size is not strictly limited
4. No virus scanning

**Current Problem Example**:
```typescript
// ❌ Only checks the MIME type, which can be spoofed
if (file.type !== 'image/jpeg') {
  throw new Error('Invalid file type');
}
```

**Recommended Solution**:

**1. Strict File Validation**:
```typescript
// src/lib/utils/fileValidation.ts
import fileType from 'file-type';

export async function validateImageFile(file: File): Promise<boolean> {
  // 1. Check file size
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  if (file.size > MAX_SIZE) {
    throw new ValidationError('File size exceeds 10MB');
  }
  
  // 2. Check MIME type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    throw new ValidationError('Invalid file type');
  }
  
  // 3. Check file signature (actual file type)
  const buffer = await file.arrayBuffer();
  const type = await fileType.fromBuffer(buffer);
  
  if (!type || !allowedTypes.includes(type.mime)) {
    throw new ValidationError('File content does not match type');
  }
  
  // 4. Check file extension
  const ext = file.name.split('.').pop()?.toLowerCase();
  const allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  if (!ext || !allowedExts.includes(ext)) {
    throw new ValidationError('Invalid file extension');
  }
  
  return true;
}
```

**2. Sanitize File Names**:
```typescript
export function sanitizeFileName(fileName: string): string {
  // Remove dangerous characters
  return fileName
    .replace(/[^a-zA-Z0-9.-]/g, '_')  // replace special characters
    .replace(/\.{2,}/g, '.')          // remove multiple dots
    .slice(0, 100);                   // limit length
}

// Use a UUID as the file name
export function generateSafeFileName(originalName: string): string {
  const ext = originalName.split('.').pop();
  return `${crypto.randomUUID()}.${ext}`;
}
```

**3. Supabase Storage RLS Policies**:
```sql
-- Limit upload file size
CREATE POLICY "Limit upload size"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = 'library-media-files'
    AND octet_length(decode(encode(content, 'hex'), 'hex')) < 10485760  -- 10MB
  );

-- Restrict file types
CREATE POLICY "Restrict file types"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = 'library-media-files'
    AND (
      content_type = ANY(ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
      OR content_type = ANY(ARRAY['video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav'])
    )
  );
```

**4. Add a Content Security Policy (CSP)**:
```typescript
// next.config.mjs
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: `
      default-src 'self';
      script-src 'self' 'unsafe-eval' 'unsafe-inline';
      style-src 'self' 'unsafe-inline';
      img-src 'self' data: https:;
      media-src 'self' https:;
      connect-src 'self' https://*.supabase.co;
      font-src 'self';
      object-src 'none';
      base-uri 'self';
      form-action 'self';
      frame-ancestors 'none';
      upgrade-insecure-requests;
    `.replace(/\s{2,}/g, ' ').trim()
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY'
  }
];

export default {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};
```

**Expected Benefits**:
- Prevent malicious file uploads
- Prevent XSS attacks
- Prevent file name injection
- Improved system security

**Estimated Effort**: 1 week

---

#### OPT-024: Implement Audit Logging

**Severity**: Medium (Security-related)  
**Type**: Security, Compliance  
**Affected Files**: New feature

**Problem Description**:
Missing audit logs, so it is impossible to:
1. Track who performed which operations
2. Investigate security incidents
3. Meet compliance requirements

**Recommended Solution**:

**1. Create an Audit Log Table**:
```sql
-- supabase/migrations/new_audit_logs.sql
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,  -- 'create', 'update', 'delete', 'login', 'logout'
  resource_type TEXT NOT NULL,  -- 'project', 'library', 'asset', etc.
  resource_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);

-- RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs
CREATE POLICY "Admins can view audit logs"
  ON public.audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_collaborators pc
      WHERE pc.user_id = auth.uid()
        AND pc.role = 'admin'
        AND pc.accepted_at IS NOT NULL
    )
  );
```

**2. Audit Log Service**:
```typescript
// src/lib/services/auditLogService.ts
export async function logAuditEvent(
  supabase: SupabaseClient,
  event: {
    action: 'create' | 'update' | 'delete' | 'login' | 'logout';
    resourceType: 'project' | 'library' | 'asset' | 'user';
    resourceId?: string;
    oldValues?: any;
    newValues?: any;
  }
) {
  const { data: { user } } = await supabase.auth.getUser();
  
  await supabase.from('audit_logs').insert({
    user_id: user?.id,
    action: event.action,
    resource_type: event.resourceType,
    resource_id: event.resourceId,
    old_values: event.oldValues,
    new_values: event.newValues,
    // IP and User-Agent need to be obtained from the request
  });
}

// Use in API routes
export async function POST(req: Request) {
  const project = await projectService.createProject(...);
  
  await logAuditEvent(supabase, {
    action: 'create',
    resourceType: 'project',
    resourceId: project.id,
    newValues: project,
  });
  
  return NextResponse.json(project);
}
```

**3. Audit Log Viewing Interface**:
```typescript
// src/app/(dashboard)/[projectId]/audit-logs/page.tsx
export default function AuditLogsPage() {
  const { data: logs } = useQuery({
    queryKey: ['audit-logs', projectId],
    queryFn: () => auditLogService.getAuditLogs(projectId),
  });
  
  return (
    <Table
      dataSource={logs}
      columns={[
        { title: 'Time', dataIndex: 'created_at', render: (date) => formatDate(date) },
        { title: 'User', dataIndex: 'user_id', render: (id) => <UserName userId={id} /> },
        { title: 'Action', dataIndex: 'action' },
        { title: 'Resource', dataIndex: 'resource_type' },
        { title: 'Details', render: (record) => <AuditLogDetails log={record} /> },
      ]}
    />
  );
}
```

**Expected Benefits**:
- Security incidents are traceable
- Compliance requirements met
- User behavior analysis

**Estimated Effort**: 1 week

---

## Implementation Priorities

### P0 (Immediate, 1-2 months)

1. **OPT-001**: Oversized component refactoring - Sidebar.tsx (2 weeks)
2. **OPT-002**: Oversized component refactoring - LibraryAssetsTable.tsx (3 weeks)
3. **OPT-003**: Enable TypeScript strict mode (2 weeks)

**Expected Benefits**: Code maintainability improved by 90%, bug localization efficiency improved by 70%

---

### P1 (High priority, 3-4 months)

4. **OPT-004**: Unify and clean up directory structure (1 week)
5. **OPT-005**: Reduce relative import paths (3 days)
6. **OPT-006**: Split LibraryDataContext responsibilities (1.5 weeks)
7. **OPT-007**: Implement virtualized table rendering (1 week)
8. **OPT-008**: Optimize Yjs and Supabase dual-state synchronization (2 weeks)
9. **OPT-009**: Increase unit test coverage (3-4 weeks)
10. **OPT-010**: Unify the error-handling strategy (1 week)
11. **OPT-011**: Optimize React Query caching strategy (1 week)
12. **OPT-023**: Strengthen file upload security (1 week)

**Expected Benefits**: Performance improved by 60%, security improved, test coverage >70%

---

### P2 (Medium priority, 5-6 months)

13. **OPT-012**: Optimize Realtime subscription management (3 days)
14. **OPT-013**: Add Loading states and Error boundaries (2 days)
15. **OPT-014**: Optimize file upload logic (1 week)
16. **OPT-015**: Add code comments and documentation (2 weeks)
17. **OPT-016**: Optimize database query performance (1 week)
18. **OPT-017**: Implement data export (3-4 days)
19. **OPT-024**: Implement audit logging (1 week)

**Expected Benefits**: Improved user experience, performance optimization, improved maintainability

---

### P3 (Low priority, long-term improvements)

20. **OPT-018**: Enable ESLint rule optimizations (2 days)
21. **OPT-019**: Add performance monitoring (1 day)
22. **OPT-020**: Optimize bundle size (2 days)
23. **OPT-021**: Add keyboard shortcuts (3 days)
24. **OPT-022**: Improve mobile responsive design (1 week)

**Expected Benefits**: Improved code quality, optimized user experience

---

## Optimization Roadmap

### Phase 1 (Months 1-2): Foundational Refactoring
- ✅ Complete oversized component splitting (Sidebar, LibraryAssetsTable)
- ✅ Enable TypeScript strict mode
- ✅ Unify directory structure

**Milestone**: Code maintainability improved by 90%

---

### Phase 2 (Months 3-4): Performance and Testing
- ✅ Virtualized table rendering
- ✅ Optimize the state-synchronization mechanism
- ✅ Increase unit test coverage (>70%)
- ✅ React Query cache optimization

**Milestone**: Performance improved by 60%, test coverage >70%

---

### Phase 3 (Months 5-6): Security and Experience
- ✅ Strengthen file upload security
- ✅ Implement audit logging
- ✅ Unify error handling
- ✅ Optimize the file upload experience
- ✅ Database query optimization

**Milestone**: Improved security, optimized user experience

---

### Phase 4 (Month 7+): Continuous Improvement
- ✅ Performance monitoring
- ✅ Code quality tooling
- ✅ Mobile optimization
- ✅ New feature development (export, shortcuts, etc.)

**Milestone**: Production-ready, continuous iteration

---

## Summary

### Key Metrics

| Metric | Current State | Post-Optimization Target |
|------|---------|----------|
| **Code maintainability** | Medium (oversized components, messy structure) | High (modular, clear structure) |
| **Type safety** | Low (strict: false) | High (strict: true) |
| **Test coverage** | <10% (E2E only) | >70% (unit + E2E) |
| **Performance** | Medium (large tables slow) | High (virtualized, optimized) |
| **Security** | Medium | High (file validation, audit logging) |
| **Development efficiency** | Low (hard to localize bugs) | High (clear architecture, test coverage) |

### Investment and Return

**Total Estimated Effort**: about 25-30 weeks (6-7 months)

**Expected Return**:
1. Code maintainability improved by 90%
2. Bug localization efficiency improved by 70%
3. Rendering performance improved by 80%
4. Development efficiency improved by 50%
5. Significantly improved system security
6. Test coverage improved from <10% to >70%

### Recommendations

Depending on team size and project urgency, we recommend:

**Small team (2-3 people)**: 
- Prioritize P0 and P1 optimizations
- Complete the core refactoring over 4-6 months
- Improve gradually alongside new feature development

**Medium/large team (4+ people)**:
- Can work on multiple optimization tasks in parallel
- Complete the major optimizations in 3-4 months
- Dedicated staff for testing and documentation

**Recommended Strategy**:
1. Fix architecture issues first (P0), then optimize performance (P1)
2. Migrate incrementally; avoid large-scale rewrites
3. Protect every optimization with tests
4. Review progress regularly and adjust priorities

---

**End of Document**
