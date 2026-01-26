# Feature Specification: Optimize Cache Invalidation Strategy

**Feature Branch**: `002-optimize-cache`  
**Created**: 2026-01-26  
**Status**: Draft  
**Input**: User description: "现在项目分为左右两个部分,关于新建或者删除 asset/library/folder/project，或者编辑asset/library/folder/project的name和编辑project的description时,是左右两边都需要更新的。但是有些时候是不需要全局更新的,只需要局部更新,不然有时候没必要;可以局部更新的规则就是:需要更新的内容除了这个section需要更新,其他section都不需要更新,那就是局部更新足够了。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Edit Project/Library/Folder/Asset Name (Priority: P1)

When a user edits the name of a project, library, folder, or asset, only the affected components should refresh their data, without triggering unnecessary network requests for unrelated sections.

**Why this priority**: This is a high-frequency operation that currently causes unnecessary performance overhead. Optimizing this will have immediate impact on user experience, reducing load times and network traffic.

**Independent Test**: Can be tested by editing a project name and monitoring network requests - only the specific entity being edited should be refetched, not all folders/libraries in the project. Delivers value by reducing unnecessary API calls by 60-80%.

**Acceptance Scenarios**:

1. **Given** user edits a project name via context menu, **When** save is clicked, **Then** only the project name is updated in Sidebar and TopBar without refetching all folders/libraries
2. **Given** user edits a library name from LibraryPage, **When** save is successful, **Then** only the library name is updated in Sidebar tree and LibraryHeader without refetching all assets
3. **Given** user edits a folder name from ProjectPage, **When** save is confirmed, **Then** only the folder name is updated in Sidebar and FolderCard without refetching all libraries in that folder
4. **Given** user edits an asset name from Sidebar context menu, **When** save completes, **Then** only the asset name is updated in Sidebar asset list without refetching entire library
5. **Given** user edits project description, **When** save is clicked, **Then** only project description is updated without refetching any child entities

---

### User Story 2 - Create New Library/Folder/Asset (Priority: P2)

When a user creates a new library, folder, or asset, only the parent container should refresh its list of children, without triggering full page refreshes or unrelated component updates.

**Why this priority**: Creation operations should be efficient and targeted. While less frequent than edits, these operations currently cause excessive refreshing that impacts perceived performance.

**Independent Test**: Can be tested by creating a new library in a folder and observing that only the folder's library list is updated, not the entire project structure. Delivers value by reducing creation latency by 40-50%.

**Acceptance Scenarios**:

1. **Given** user creates a new library in a folder, **When** creation succeeds, **Then** only that folder's library list in ProjectPage and FolderPage is updated without refetching all folders
2. **Given** user creates a new folder in a project, **When** creation completes, **Then** only the project's folder list is updated in Sidebar and ProjectPage without refetching all libraries
3. **Given** user creates a new asset in a library, **When** save is successful, **Then** only the library's asset list in LibraryPage and Sidebar is updated without refetching library schema or project structure
4. **Given** user creates a root library (no folder), **When** creation succeeds, **Then** only the project's root libraries list is updated without refetching folders
5. **Given** multiple users creating entities simultaneously, **When** creation events fire, **Then** each component only refreshes its relevant data scope

---

### User Story 3 - Delete Library/Folder/Asset (Priority: P2)

When a user deletes a library, folder, or asset, only the affected parent and related views should update, without triggering unnecessary refetches across the application.

**Why this priority**: Deletion operations need careful handling for navigation and cache cleanup, but should not cause cascade refreshes of unrelated data.

**Independent Test**: Can be tested by deleting a library and verifying that only the parent folder/project list updates, the Sidebar tree node is removed, and active views navigate away if viewing the deleted entity. Network requests should be minimal.

**Acceptance Scenarios**:

1. **Given** user deletes a library from ProjectPage, **When** deletion confirms, **Then** only that library is removed from parent folder/project list and Sidebar tree without refetching all libraries
2. **Given** user deletes a folder containing libraries, **When** deletion succeeds, **Then** only the folder and its children are removed from caches without refetching sibling folders
3. **Given** user deletes an asset from LibraryPage, **When** deletion completes, **Then** only the asset row is removed from table and Sidebar asset list without refetching properties or schema
4. **Given** user is viewing a deleted entity, **When** deletion occurs, **Then** user is navigated to parent view (e.g., library deleted → project page) with minimal refetching
5. **Given** user deletes entity from Sidebar context menu, **When** deletion succeeds, **Then** only the immediate parent's children list is updated across all components

---

### User Story 4 - Monitor and Measure Performance Improvements (Priority: P3)

Development team can measure the reduction in unnecessary API calls and improved response times after optimization implementation.

**Why this priority**: Important for validating the optimization effort and ensuring performance gains are realized. Lower priority as it's primarily for validation rather than user-facing functionality.

**Independent Test**: Can be tested by comparing network request counts and response times before/after optimization for common operations (edit name, create library, delete asset). Success criteria: 60%+ reduction in unnecessary requests.

**Acceptance Scenarios**:

1. **Given** baseline measurements taken before optimization, **When** optimization is complete, **Then** editing entity names shows 60-80% fewer network requests
2. **Given** user performs create operation, **When** measuring network activity, **Then** only 1-2 targeted requests are made instead of 5-8 global refetches
3. **Given** user performs delete operation, **When** measuring response time, **Then** perceived latency is reduced by 40-50% due to fewer concurrent requests
4. **Given** multiple users collaborating, **When** monitoring real-time updates, **Then** event handlers only trigger necessary cache updates without cascade effects

---

### Edge Cases

- **Concurrent edits**: When two users edit same entity name simultaneously, last-write-wins with proper cache invalidation for both users
- **Stale cache**: If cache becomes stale due to failed update, component should detect and recover by targeted refetch
- **Navigation during update**: If user navigates away before update completes, cache should still be updated but no UI refresh needed
- **Optimistic updates failing**: If optimistic cache update fails, system should rollback the cache change and show error without full refetch
- **Deep nesting**: When deleting parent entity (folder), all child entities (libraries, assets) should be efficiently removed from all caches

## Functional Requirements *(mandatory)*

### FR-1: React Query Cache Mutation

**Requirement**: Replace global `invalidateQueries` and `fetchData()` calls with targeted React Query cache mutations using `setQueryData` and `setQueriesData`.

**Why needed**: Current implementation uses invalidateQueries which triggers full refetches even when only a single property (like name) changes. Cache mutation allows direct updates without network requests.

**Acceptance Criteria**:
- When entity name is edited, use `queryClient.setQueryData` to update the specific entity in cache
- When entity is created, use `queryClient.setQueriesData` to append to relevant parent lists
- When entity is deleted, use `queryClient.setQueriesData` to remove from relevant lists
- Fallback to `invalidateQueries` with specific queryKey only when cache mutation is not possible

---

### FR-2: Granular Query Keys

**Requirement**: Implement more specific React Query queryKeys for individual entities and relationships, enabling targeted cache updates.

**Why needed**: Current queryKeys are too broad (e.g., `['folders-libraries', projectId]` fetches all folders AND libraries). Granular keys allow precise cache targeting.

**Acceptance Criteria**:
- Define queryKey `['project', projectId]` for individual project data
- Define queryKey `['library', libraryId]` for individual library data  
- Define queryKey `['folder', folderId]` for individual folder data
- Define queryKey `['assets', libraryId]` for library assets list
- Define queryKey `['project-folders', projectId]` for project's folders list
- Define queryKey `['project-libraries', projectId]` for project's root libraries
- Define queryKey `['folder-libraries', folderId]` for folder's libraries list

---

### FR-3: Optimized Event Handlers

**Requirement**: Refactor custom event handlers (`window.addEventListener`) to perform targeted cache updates instead of calling global `fetchData()`.

**Why needed**: Current event handlers blindly call `fetchData()` which refetches all data. Smart handlers should update only affected cache entries.

**Acceptance Criteria**:
- `projectUpdated` event only updates project name/description in cache, not folders/libraries
- `libraryUpdated` event only updates library name/description in relevant caches
- `folderUpdated` event only updates folder name in relevant caches
- `assetUpdated` event only updates asset name/properties in library assets cache
- `libraryCreated` event adds library to parent's libraries list without refetching siblings
- `libraryDeleted` event removes library from all relevant caches and navigates if needed

---

### FR-4: Sidebar Cache Optimization

**Requirement**: Optimize Sidebar component to use targeted React Query invalidations instead of broad cache refreshes.

**Why needed**: Sidebar currently uses `invalidateQueries` with broad queryKeys like `['folders-libraries', projectId]` which refetches all folders and libraries even when only one entity changed.

**Acceptance Criteria**:
- When library name changes, only update that library node in tree without refetching folders
- When folder name changes, only update that folder node without refetching libraries
- When asset name changes, only update that asset node without refetching library schema
- When library is created, append to parent folder's children without refetching all libraries
- When asset is created, append to library's assets list without refetching entire tree

---

### FR-5: ProjectPage Selective Refresh

**Requirement**: Modify ProjectPage to only refetch affected data sections when entities are created/updated/deleted.

**Why needed**: ProjectPage currently calls `fetchData()` for most events, which refetches project info, all folders, all libraries, and asset counts - even when only one entity changed.

**Acceptance Criteria**:
- `libraryCreated` event only fetches that specific library and appends to list, no project/folder refetch
- `libraryUpdated` event only updates that library's name in the libraries list
- `folderUpdated` event only updates that folder's name in the folders list
- `projectUpdated` event only updates project name/description, not folders/libraries
- Asset counts are only refetched for the specific library affected, not all libraries

---

### FR-6: LibraryPage Efficient Updates

**Requirement**: Optimize LibraryPage to handle asset updates with minimal refetching, using cache mutations where possible.

**Why needed**: LibraryPage listens to multiple events and refetches full asset list for any change. This is excessive when only single asset name or single property changed.

**Acceptance Criteria**:
- `assetUpdated` event with only name change updates the asset row in cache without full refetch
- `assetUpdated` event with property change uses cache mutation to update specific property cell
- `assetCreated` event appends new asset row to cache without refetching all assets
- `assetDeleted` event removes asset row from cache without refetching remaining assets
- Real-time subscriptions only trigger targeted updates for changed rows/cells

---

### FR-7: Edit Modals Direct Cache Updates

**Requirement**: When Edit modals (Project/Library/Folder/Asset) successfully save changes, they should directly update relevant caches instead of only dispatching events.

**Why needed**: Edit modals currently only dispatch events, relying on listeners to refresh. Direct cache updates reduce latency and ensure consistency.

**Acceptance Criteria**:
- EditProjectModal directly updates project name in `['project', projectId]` cache after successful save
- EditLibraryModal directly updates library name in `['library', libraryId]` cache
- EditFolderModal directly updates folder name in `['folder', folderId]` cache
- EditAssetModal directly updates asset name in `['assets', libraryId]` cache
- Events are still dispatched for cross-component awareness but don't trigger full refetches

## Success Criteria *(mandatory)*

1. **Network request reduction**: Entity name edit operations generate 60-80% fewer network requests compared to baseline (measured via browser DevTools Network tab)

2. **Perceived latency improvement**: Name edit operations feel instant (under 100ms) to users, with 40-50% reduction in UI update time

3. **Cache efficiency**: Memory usage for React Query cache remains stable (within 10% of baseline) despite more granular caching

4. **Event handler performance**: Custom event handlers execute in under 50ms on average, down from 200-500ms in current implementation

5. **Cascade prevention**: Editing one entity's name does not trigger refetches of sibling or parent entities (0 cascade requests)

## Dependencies & Constraints *(mandatory)*

### Dependencies

- **React Query (TanStack Query)**: Already integrated in the project, provides `queryClient.setQueryData`, `setQueriesData`, and granular cache management
- **Custom Events System**: Existing `window.dispatchEvent` mechanism for cross-component communication needs to be retained for backward compatibility
- **Supabase Real-time**: Real-time subscriptions in LibraryPage should work alongside cache optimizations
- **Authorization Service**: Cache updates must respect RLS (Row Level Security) policies - cannot cache unauthorized data

### Constraints

- **No breaking changes**: Optimization must not break existing functionality - all components should continue to work as before
- **Progressive enhancement**: Changes can be rolled out gradually, starting with highest-impact operations (name edits) before optimizing create/delete
- **Backward compatibility**: Old event-based refresh mechanism should still work for components not yet optimized
- **Performance budget**: Optimizations should not increase bundle size by more than 5KB

## Assumptions *(if applicable)*

1. **React Query is properly configured**: Assumes QueryClient is already instantiated with appropriate defaults (staleTime, cacheTime) and accessible via context
2. **Query keys follow conventions**: Assumes all components using React Query follow consistent naming conventions for queryKeys
3. **Supabase RLS works correctly**: Assumes Row Level Security policies prevent users from seeing unauthorized data, so cached data is always permissioned correctly
4. **Event-driven architecture is sound**: Assumes custom events (`projectUpdated`, `libraryCreated`, etc.) are dispatched consistently and reliably
5. **Single-user scenarios dominate**: Assumes most edit conflicts are rare, so optimistic updates will succeed without rollback in 95%+ of cases

## Current Implementation Analysis

### Global Refresh Patterns Identified

#### 1. Sidebar.tsx

**Current behavior**:
- Uses `queryClient.invalidateQueries({ queryKey: ['projects'] })` for project changes
- Uses `queryClient.invalidateQueries({ queryKey: ['folders-libraries', projectId] })` for folder/library changes
- Fetches assets separately with `fetchAssets(libraryId)` using globalRequestCache
- Listens to 11 different events: projectCreated, projectUpdated, libraryCreated, libraryDeleted, libraryUpdated, folderCreated, folderDeleted, folderUpdated, assetCreated, assetUpdated, assetDeleted

**Problems**:
- `['folders-libraries', projectId]` invalidation refetches ALL folders AND libraries even when only one name changed
- `fetchAssets` uses cache but still makes network requests for asset list
- Event handlers trigger invalidations which cause full refetches instead of targeted updates

**Optimization opportunities**:
- Use cache mutation to update specific library/folder/asset name in tree structure
- Only invalidate `['folders-libraries', projectId]` when structure changes (create/delete), not for name edits
- Update assets cache directly when asset name changes instead of refetching list

#### 2. ProjectPage ([projectId]/page.tsx)

**Current behavior**:
- Defines `fetchData()` callback that fetches: project info, all folders, all libraries, and libraries for each folder
- Listens to 7 events: folderCreated, folderDeleted, folderUpdated, libraryCreated, libraryDeleted, libraryUpdated, projectUpdated
- Calls `fetchData()` for most events, which refetches everything
- Separately fetches asset counts for all libraries after libraries load

**Problems**:
- `fetchData()` is too broad - refetches project info and all folders/libraries even when only one entity changed
- `libraryUpdated` event refetches all libraries when only name changed
- `folderUpdated` event refetches all folders and libraries when only folder name changed
- Asset counts are refetched for all libraries even when only one library affected

**Optimization opportunities**:
- Use React Query with granular keys: `['project', projectId]`, `['project-folders', projectId]`, `['project-libraries', projectId]`
- For `libraryUpdated` event, use cache mutation to update just that library's name
- For `folderUpdated` event, use cache mutation to update just that folder's name
- Only refetch asset counts for affected library when that library's asset changes

#### 3. LibraryPage ([libraryId]/page.tsx)

**Current behavior**:
- Uses direct data fetching with `getLibrary`, `getLibrarySummary`, `getLibrarySchema`, `getLibraryAssetsWithProperties`
- Listens to 3 events: libraryUpdated, assetCreated, assetUpdated, assetDeleted
- For `libraryUpdated`, refetches library info and summary
- For asset events, refetches full asset list with `getLibraryAssetsWithProperties`
- Also has real-time subscriptions for `library_assets` and `library_asset_values` tables

**Problems**:
- Asset events trigger full asset list refetch even when only one asset name changed
- Real-time subscriptions also trigger full refetch on any change
- Fetches library summary separately which could be cached with library info

**Optimization opportunities**:
- Use React Query for library data: `['library', libraryId]`, `['assets', libraryId]`
- For asset name update, use cache mutation to update just that asset row
- For property update, use cache mutation to update specific cell
- Real-time subscriptions should trigger targeted cache updates, not full refetches

#### 4. FolderPage (folder/[folderId]/page.tsx)

**Current behavior**:
- Defines `fetchData()` that fetches folder info and all libraries in folder
- Listens to 4 events: libraryCreated, libraryDeleted, libraryUpdated, folderUpdated
- Calls `fetchData()` for most events
- Separately fetches asset counts for libraries after libraries load

**Problems**:
- `fetchData()` refetches folder and all libraries even for single library name change
- `libraryUpdated` refetches all libraries when only one changed
- Similar issues as ProjectPage with unnecessary broad fetching

**Optimization opportunities**:
- Use React Query: `['folder', folderId]`, `['folder-libraries', folderId]`
- For `libraryUpdated`, use cache mutation for just that library
- For `folderUpdated`, use cache mutation for just folder name
- Only refetch asset counts for affected library

#### 5. Edit Modals

**Current behavior**:
- EditProjectModal: updates project, dispatches `projectUpdated` event
- EditLibraryModal: updates library, dispatches `libraryUpdated` event
- EditFolderModal: updates folder, dispatches `folderUpdated` event
- EditAssetModal: updates asset, dispatches `assetUpdated` event
- All rely on event listeners in other components to refresh data

**Problems**:
- No direct cache updates - relies entirely on event listeners which may over-fetch
- Event dispatch is fire-and-forget - no guarantee of cache consistency

**Optimization opportunities**:
- Directly update cache after successful save using queryClient
- Still dispatch events for backward compatibility but listeners can be optimized to not refetch

### Summary of Optimization Impact

| Operation | Current Requests | Optimized Requests | Savings |
|-----------|------------------|-------------------|---------|
| Edit project name | 1 update + 2-4 refetches (project, folders, libraries) | 1 update + 0 refetches (cache mutation) | 60-80% |
| Edit library name | 1 update + 2-3 refetches (library, project structure) | 1 update + 0 refetches | 65-75% |
| Edit folder name | 1 update + 2-3 refetches (folder, libraries) | 1 update + 0 refetches | 65-75% |
| Edit asset name | 1 update + 1-2 refetches (assets list) | 1 update + 0 refetches | 50-65% |
| Create library | 1 insert + 2-3 refetches (folders, libraries) | 1 insert + 0 refetches (cache append) | 65-75% |
| Delete library | 1 delete + 2-3 refetches (folders, libraries) | 1 delete + 0 refetches (cache remove) | 65-75% |

**Expected Overall Impact**:
- 60-80% reduction in unnecessary network requests for name edit operations
- 40-50% reduction in perceived latency due to fewer concurrent requests
- 50-70% reduction in cache invalidation cascade effects
- Improved UX with instant feedback from optimistic updates

## Related Features

- **Real-time Collaboration (001)**: Cache optimization should not interfere with real-time presence or collaborative editing features
- **Version Control**: Future version control features may need to consider cache invalidation strategy for version restore operations
- **Offline Support**: If offline mode is added, cache optimization becomes even more critical for merging local changes

## Out of Scope

- **Optimistic updates UI feedback**: Showing loading spinners or temporary states during optimistic updates is nice-to-have but not required
- **Cache persistence**: Persisting React Query cache to localStorage/IndexedDB for faster app startup is out of scope
- **Query deduplication**: React Query already handles this, no additional optimization needed
- **Preloading**: Prefetching data before user navigates is not part of this optimization
- **Service worker caching**: Browser-level caching is separate concern

