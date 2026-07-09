# Feature Specification: In-flight guard for Yjs asset hydration (issue #174)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #174 — `LibraryDataContext.loadInitialData` can run concurrently; a slow older request can overwrite a newer one, regressing Yjs doc state.

## Overview

`loadInitialData` in `src/lib/contexts/LibraryDataContext.tsx:190-212` fetches all asset rows via `getLibraryAssetsWithProperties` and applies them to the Yjs doc via `hydrateYAssetsFromRows(yDoc, yAssets, assetRows)`. It has **no guard** against overlapping invocations: whichever fetch resolves last writes into `yAssets`, regardless of which one started later.

### Investigation findings (verified 2026-07-09)

`loadInitialData` is triggered from multiple independent places, any of which can overlap:

1. Initial-load effect — `LibraryDataContext.tsx:224-228` (fires on auth readiness changes).
2. Library-version restore realtime event — `LibraryDataContext.tsx:244-250` (fires whenever a `restore` version row is inserted).
3. Realtime handlers wired through `useLibraryRealtimeHandlers({ loadInitialData })` — `LibraryDataContext.tsx:278-283`; e.g. `useLibraryRealtimeHandlers.ts:104` calls `void loadInitialData()` on reconnect/refresh.
4. Mutation flows that reload after writes — `useLibraryAssetMutations.ts:404` (`await loadInitialData()`), plus row-operation flows referenced in `useRowOperations.ts`.

Because `getLibraryAssetsWithProperties` is an async network call, request A started before request B can resolve after B. When it does, A's older snapshot calls `hydrateYAssetsFromRows` last and clobbers B's newer data — the Yjs doc regresses to stale rows. The existing `isMountedRef` check (line 203) only guards unmount, not staleness.

There is no AbortController and no generation/sequence counter anywhere in `loadInitialData` today.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Only the latest hydration wins (Priority: P1)

As a user whose library reloads for several reasons in quick succession (initial load + a realtime refresh, say), the view reflects the most recently requested data, never an older snapshot that happened to return late.

**Why this priority**: This is the data-correctness defect: stale overwrite silently rolls back rows/values users may have just seen updated.

**Independent Test**: Unit-test `loadInitialData` with two overlapping calls where the first fetch resolves after the second; assert the Yjs doc ends in the second call's data.

**Acceptance Scenarios**:
1. **Given** call A (older) and call B (newer) in flight, **When** A resolves after B, **Then** A's result is discarded and the doc holds B's rows.
2. **Given** two overlapping calls, **When** both complete, **Then** `hydrateYAssetsFromRows` is applied at most once with the latest result (older result ignored).
3. **Given** a single call, **When** it resolves, **Then** behavior is unchanged from today.

### Edge Cases

- Component unmounts mid-flight → no state update and no hydration (preserve current `isMountedRef` guard).
- An older request that has already been superseded MUST NOT flip `isLoading`/`isSynced` in a way that hides the newer request's loading state.
- If the latest request errors, prior stale results MUST NOT be applied as a fallback.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `loadInitialData` MUST tag each invocation with a monotonically increasing generation id (or equivalent), captured before the fetch and re-checked after it resolves.
- **FR-002**: A resolved fetch MUST apply `hydrateYAssetsFromRows` only if its generation is still the latest; otherwise the result MUST be discarded.
- **FR-003**: `isLoading` / `isSynced` state transitions MUST be driven only by the latest generation, so a late stale request cannot toggle sync state.
- **FR-004**: The guard MUST hold across all trigger sources (initial effect, restore event, realtime handlers, mutation reloads) since they share the same `loadInitialData` reference.
- **FR-005**: Optionally, an `AbortController` MAY cancel the in-flight fetch when a newer one starts; if used it MUST NOT throw uncaught abort errors. The generation check is the authoritative correctness mechanism.

### Non-Functional Requirements

- **NFR-001**: No change to the fetch shape or `hydrateYAssetsFromRows` contract; the guard wraps orchestration only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A regression test with an out-of-order resolving pair proves the latest data wins; it fails against the current unguarded implementation.
- **SC-002**: A single-call test proves no behavioral regression (data applied exactly once, sync state correct).
- **SC-003**: `npm run lint`, `npm run typecheck`, and `npm run test:unit` are green.

## Out of Scope

- Deduplicating/coalescing the multiple trigger sources themselves (they remain; only stale application is prevented).
- Changing restore-event or realtime subscription wiring.
