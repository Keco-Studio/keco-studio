# Implementation Plan: Optimize Cache Invalidation Strategy

**Branch**: `002-optimize-cache` | **Date**: 2026-01-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-optimize-cache/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Replace global cache invalidation patterns with targeted React Query cache mutations to reduce unnecessary network requests by 60-80% when editing entity names or performing CRUD operations. Current implementation uses broad `invalidateQueries` calls that refetch entire data structures (all folders, libraries, assets) even when only a single entity's name changes. The optimization will use `setQueryData` and `setQueriesData` for direct cache updates, implement granular query keys for precise targeting, and refactor event handlers to perform surgical updates instead of full page refreshes. This delivers immediate performance improvements for high-frequency operations while maintaining all existing functionality.

## Technical Context

**Language/Version**: TypeScript 5.9.3, React 18.3.1, Next.js 16.0.0 (App Router)  
**Primary Dependencies**: 
- @tanstack/react-query 5.90.16 (cache management)
- @supabase/supabase-js 2.87.1 (database, RLS, real-time)
- antd 5.22.2 (UI components)
- yjs 13.6.29 (collaborative editing)

**Storage**: Supabase PostgreSQL with Row Level Security (RLS)  
**Testing**: Playwright 1.57.0 for E2E tests, manual testing for cache behavior  
**Target Platform**: Web (Chrome, Firefox, Safari), responsive desktop/tablet  
**Project Type**: Web application (Next.js App Router with client/server boundaries)  
**Performance Goals**: 
- 60-80% reduction in network requests for name edit operations
- 40-50% reduction in perceived latency (under 100ms for name edits)
- Event handler execution under 50ms (down from 200-500ms)

**Constraints**: 
- Must not break existing functionality or real-time collaboration features
- Must respect Supabase RLS policies (cannot cache unauthorized data)
- Cache memory usage must stay within 10% of baseline
- No hydration errors or App Router boundary violations
- Backward compatible with existing event-based refresh mechanism

**Scale/Scope**: 
- 5 major components to optimize (Sidebar, ProjectPage, LibraryPage, FolderPage, Edit Modals)
- 11 event types with handlers to refactor
- 7 functional requirements with 37 acceptance criteria
- Estimated 2-3 weeks implementation, 1 week testing/validation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### ✅ I. Pixel-Perfect Responsive Delivery
**Status**: PASS - No UI changes required
- Optimization is purely internal (cache management)
- No changes to components, layouts, or styling
- Existing responsive behavior and Figma designs unchanged

### ✅ II. App Router & Supabase Integrity
**Status**: PASS - Fully compliant
- Uses existing Supabase client boundaries correctly (client components already marked 'use client')
- RLS policies respected: cache updates use data already authorized by RLS
- No schema changes or migrations required
- Cache invalidation follows data access patterns already validated by RLS

### ✅ III. Typed Minimal & Documented Code
**Status**: PASS - Enhances existing patterns
- No new dependencies (React Query already installed and used)
- TypeScript strict mode: cache mutations will be fully typed with QueryClient types
- Code changes are refactors (replacing invalidateQueries with setQueryData)
- Will document cache mutation patterns and query key conventions

### ✅ IV. Resilient Async & Error Handling
**Status**: PASS - Maintains error handling
- Optimistic updates will include rollback handlers for failures
- Existing error boundaries and fallbacks remain unchanged
- Cache mutations will preserve existing try-catch patterns
- Network errors still surfaced to users via existing mechanisms

### ✅ V. Simplicity & Single Responsibility
**Status**: PASS - Reduces complexity
- Removes unnecessary data fetching calls (fetchData() functions)
- Simplifies event handlers (targeted updates instead of full refreshes)
- Improves code clarity: explicit cache updates vs implicit invalidations
- Maintains single responsibility: each handler updates only what changed

### Additional Constraints Compliance

**Styling**: ✅ No changes to .module.css or CSS variables

**Performance**: ✅ Improves performance (fewer network requests, faster updates)

**Data**: ✅ All cache updates use data already validated by Supabase RLS

**Conclusion**: All constitutional principles are satisfied. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/002-optimize-cache/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── query-keys.md    # React Query key conventions
│   ├── cache-mutations.md # Cache update patterns
│   └── event-handlers.md # Event handler contracts
├── checklists/
│   └── requirements.md  # Quality validation (already complete)
└── spec.md              # Feature specification (already complete)
```

### Source Code (repository root)

```text
src/
├── components/
│   ├── layout/
│   │   └── Sidebar.tsx             # [MODIFY] Optimize cache updates in event handlers
│   ├── libraries/
│   │   ├── EditLibraryModal.tsx    # [MODIFY] Add direct cache updates after save
│   │   └── LibraryAssetsTable.tsx  # [REVIEW] Ensure real-time updates compatible
│   ├── projects/
│   │   └── EditProjectModal.tsx    # [MODIFY] Add direct cache updates after save
│   ├── folders/
│   │   ├── EditFolderModal.tsx     # [MODIFY] Add direct cache updates after save
│   │   ├── FolderCard.tsx          # [REVIEW] Verify cache reads work with new keys
│   │   └── LibraryCard.tsx         # [REVIEW] Verify cache reads work with new keys
│   └── asset/
│       └── EditAssetModal.tsx      # [MODIFY] Add direct cache updates after save
│
├── app/
│   └── (dashboard)/
│       ├── [projectId]/
│       │   ├── page.tsx                    # [MODIFY] Replace fetchData() with targeted updates
│       │   ├── [libraryId]/
│       │   │   └── page.tsx                # [MODIFY] Add cache mutations for asset updates
│       │   └── folder/[folderId]/
│       │       └── page.tsx                # [MODIFY] Replace fetchData() with targeted updates
│       └── projects/
│           └── page.tsx                    # [REVIEW] Verify project list queries compatible
│
├── lib/
│   ├── hooks/
│   │   └── [NEW] useCacheMutations.ts     # Reusable cache mutation hooks
│   ├── utils/
│   │   └── [NEW] queryKeys.ts             # Centralized query key definitions
│   └── services/
│       ├── projectService.ts               # [REVIEW] No changes needed
│       ├── libraryService.ts               # [REVIEW] No changes needed
│       ├── folderService.ts                # [REVIEW] No changes needed
│       └── libraryAssetsService.ts         # [REVIEW] No changes needed
│
tests/
├── integration/
│   └── [NEW] cache-optimization.spec.ts   # Test cache mutation behavior
└── e2e/
    └── [NEW] cache-performance.spec.ts    # Measure network request reduction
```

**Structure Decision**: This is a web application using Next.js App Router. The optimization touches multiple components across the dashboard routes. Key changes are concentrated in:
1. **Page components** ([projectId]/page.tsx, [libraryId]/page.tsx, folder/[folderId]/page.tsx) - Replace `fetchData()` with targeted cache updates
2. **Edit modals** (4 modals) - Add direct cache mutations after successful saves
3. **Sidebar** - Refactor 11 event handlers to use cache mutations instead of invalidations
4. **New utilities** - Create reusable hooks and centralized query key definitions

No backend changes required - optimization is pure frontend cache management.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations found. All constitutional principles are satisfied without compromise.

## Phase 0: Research & Decisions

### Research Tasks

1. **React Query Cache Mutation Best Practices**
   - Decision: Use `queryClient.setQueryData` for single entity updates, `setQueriesData` for batch updates
   - Rationale: These methods allow direct cache updates without network requests, supporting optimistic updates with rollback
   - Alternatives: Could use `useMutation` with `onSuccess` callback, but direct cache access is more explicit and flexible
   - Reference: TanStack Query v5 documentation on cache mutations

2. **Query Key Design Patterns**
   - Decision: Hierarchical query keys with entity type and ID, e.g., `['project', projectId]`, `['library', libraryId]`
   - Rationale: Enables precise cache targeting and supports partial matching with `setQueriesData`
   - Alternatives: Flat keys like `['project-${id}']` are simpler but harder to query in batches
   - Reference: TanStack Query best practices for key structure

3. **Optimistic Updates with Rollback**
   - Decision: Use optimistic updates for name edits with automatic rollback on error
   - Rationale: Provides instant feedback while maintaining data consistency if server update fails
   - Alternatives: Pessimistic updates (wait for server) are safer but sacrifice user experience
   - Pattern: Store previous value, update cache optimistically, rollback if mutation fails

4. **Event System Integration**
   - Decision: Keep existing `window.dispatchEvent` system but make handlers smart (cache mutation instead of invalidation)
   - Rationale: Maintains backward compatibility while gradually optimizing each listener
   - Alternatives: Remove events entirely and use React Query's built-in refetch, but requires coordinated changes across all components
   - Migration: Progressive - optimize high-impact handlers first (name edits), then create/delete operations

5. **Cache Memory Management**
   - Decision: Keep current React Query `cacheTime` and `staleTime` settings, monitor memory usage
   - Rationale: More granular keys shouldn't significantly increase memory if existing queries are properly scoped
   - Alternatives: Aggressive garbage collection with short `cacheTime`, but would reduce cache effectiveness
   - Validation: Measure baseline memory usage, ensure stays within 10% after optimization

### Technology Decisions

**Selected**: TanStack React Query v5 cache mutations (`setQueryData`, `setQueriesData`)

**Rejected Alternatives**:
- **Custom cache layer**: Too complex, duplicates React Query functionality
- **Redux**: Adds unnecessary dependency, React Query already manages server state
- **SWR**: Would require migration from React Query, not justified for optimization

**Integration Points**:
- Supabase real-time: Cache mutations must coexist with real-time subscriptions (library assets)
- Yjs collaborative editing: Optimizations in LibraryPage must not interfere with collaborative features
- Existing event system: Maintain for backward compatibility during gradual rollout

## Phase 1: Design & Contracts

See generated artifacts:
- [data-model.md](./data-model.md) - Cache data structures and relationships
- [contracts/](./contracts/) - Query keys, cache mutations, event handler contracts
- [quickstart.md](./quickstart.md) - Getting started guide for developers

## Implementation Phases

### Phase 1: Foundation (Week 1, Days 1-2)
**Goal**: Establish cache mutation infrastructure

1. Create `/lib/utils/queryKeys.ts` with centralized key definitions
2. Create `/lib/hooks/useCacheMutations.ts` with reusable mutation helpers
3. Add TypeScript types for cache update operations
4. Write unit tests for cache mutation helpers

**Deliverables**: 
- Typed query key factory functions
- Reusable hooks for common cache operations (updateEntityName, addToList, removeFromList)
- Test coverage for cache utilities

### Phase 2: Edit Modals Optimization (Week 1, Days 3-5)
**Goal**: Optimize highest-frequency operations (name edits)

1. Modify `EditProjectModal` to use cache mutations
2. Modify `EditLibraryModal` to use cache mutations
3. Modify `EditFolderModal` to use cache mutations
4. Modify `EditAssetModal` to use cache mutations
5. Test each modal with network monitoring

**Deliverables**:
- 4 modals with direct cache updates
- Verified: name edits don't trigger refetches
- Backward compatibility: events still dispatched

### Phase 3: Page Component Optimization (Week 2, Days 1-3)
**Goal**: Replace `fetchData()` with targeted cache updates

1. Refactor `ProjectPage` event handlers (7 events)
2. Refactor `LibraryPage` event handlers (3 events)
3. Refactor `FolderPage` event handlers (4 events)
4. Update React Query hooks to use granular keys
5. Test all page transitions and data loading

**Deliverables**:
- 3 page components with optimized event handlers
- No more full-page `fetchData()` calls for name edits
- Verified: create/delete operations still work correctly

### Phase 4: Sidebar Optimization (Week 2, Days 4-5)
**Goal**: Optimize tree structure updates

1. Refactor Sidebar event handlers (11 events)
2. Update tree data memoization to use cache reads
3. Optimize `fetchAssets()` to use cache mutations
4. Test tree expand/collapse with cache updates

**Deliverables**:
- Sidebar with surgical cache updates
- No broad `invalidateQueries(['folders-libraries'])`
- Tree UI updates instantly on name changes

### Phase 5: Testing & Validation (Week 3)
**Goal**: Verify performance improvements and catch regressions

1. **Performance Testing**:
   - Baseline: Measure network requests before optimization
   - After: Measure network requests after optimization
   - Validate: 60-80% reduction for name edits, 50-70% for create/delete

2. **Regression Testing**:
   - E2E tests for all CRUD operations
   - Multi-user collaboration scenarios
   - Real-time updates still work correctly
   - Navigation and routing still work

3. **Memory Testing**:
   - Baseline memory usage
   - After optimization memory usage
   - Ensure within 10% of baseline

**Deliverables**:
- Performance report with before/after metrics
- All E2E tests passing
- Memory usage validation
- Bug fixes for any regressions found

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Cache gets stale or out of sync | High | Implement cache validation checks; fallback to refetch if data inconsistent |
| Real-time updates conflict with cache mutations | High | Ensure real-time handlers use same cache mutation patterns; test collaborative scenarios |
| Optimistic updates fail silently | Medium | Add explicit error handlers with rollback; show user notification on failure |
| Memory usage increases with granular keys | Medium | Monitor cache size; implement aggressive garbage collection if needed |
| Breaking changes in event system | Medium | Keep backward compatibility; gradual migration allows rollback if issues arise |
| Performance gains not as expected | Low | Start with profiling; adjust optimization targets based on actual bottlenecks |

## Success Metrics

### Before Optimization (Baseline)

Measured operations:
- Edit project name: 1 update + 3 GET requests (project, folders, libraries) = 4 total
- Edit library name: 1 update + 2 GET requests (library, folder libraries) = 3 total
- Create library: 1 insert + 3 GET requests = 4 total
- Delete asset: 1 delete + 2 GET requests = 3 total

Average latency: 300-500ms (multiple sequential requests)

### After Optimization (Target)

Expected operations:
- Edit project name: 1 update + 0 GET requests = 1 total (**75% reduction**)
- Edit library name: 1 update + 0 GET requests = 1 total (**67% reduction**)
- Create library: 1 insert + 0 GET requests = 1 total (**75% reduction**)
- Delete asset: 1 delete + 0 GET requests = 1 total (**67% reduction**)

Expected latency: 50-100ms (single request + instant cache update)

### Validation Criteria

✅ **Primary**: Network request reduction 60-80% for name edits
✅ **Primary**: Perceived latency reduction 40-50% (measured by time-to-UI-update)
✅ **Secondary**: Cache memory usage within 10% of baseline
✅ **Secondary**: Event handler execution time under 50ms
✅ **Secondary**: Zero cascade refetches (editing entity A doesn't refetch entity B)

## Dependencies

### Internal Dependencies
- No blocking dependencies - can start immediately
- Existing React Query setup is sufficient
- No schema migrations required

### External Dependencies
- None - optimization is purely frontend

### Integration Points
- Real-time collaboration features in LibraryPage
- Yjs collaborative editing (ensure cache updates don't interfere)
- Supabase RLS policies (must be respected in cache updates)

## Rollout Strategy

1. **Feature Flag**: Consider adding feature flag for gradual rollout if needed
2. **Gradual Migration**: Start with Edit Modals (highest impact, lowest risk)
3. **Monitoring**: Add performance logging for cache operations
4. **Rollback Plan**: Keep event-based invalidation as fallback during migration
5. **Documentation**: Update developer docs with cache mutation patterns

## Notes

- This optimization is transparent to users - no UI changes
- All changes are refactors of existing code, not new features
- Can be implemented and tested incrementally (modal by modal, page by page)
- Risk is low: worst case is cache gets stale, fallback to existing invalidation
- High reward: significant performance improvement for high-frequency operations
