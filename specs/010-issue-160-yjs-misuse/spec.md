# Feature Specification: Fix Yjs misuse in the library table (issue #160)

**Feature Branch**: `git-issues-fix`
**Created**: 2026-07-07
**Status**: Draft — phased; phase 1 only in this batch
**Input**: GitHub issue #160 — Yjs is miscast: no network provider, offline edits clobbered, unbounded IndexedDB growth, two docs per library.

## Overview

The library table wires Yjs as if it were a collaboration engine, but it is not one here:

1. **No network provider.** `YjsContext.tsx:38` uses `IndexeddbPersistence` with no `WebsocketProvider`/`WebrtcProvider`. Offline edits persisted by y-indexeddb are overwritten by the DB on next load, so the "supports offline editing" claim (`YjsContext.tsx:36`) is false.
2. **Unbounded doc growth.** A clear+repopulate on every load appends full-document updates to IndexedDB, growing it without bound.
3. **No real CRDT merge.** Conflict handling is "remote wins" via `console.warn` (`LibraryDataContext.tsx:504-508`) driven by wall-clock `Date.now()` comparison (`useRealtimeSubscription.ts:134-137`) — unsound across skewed clients.
4. **Double machinery.** Two Yjs docs + two IndexedDB stores per library page: `library-${id}` (LibraryDataContext) and `asset-table-${id}` (`YjsContext.tsx`), merged via `useYjsSync.ts`.

This is the riskiest item in the batch: a full correction touches the table's core data flow and overlaps the god-component split (#147). To stay safe under automation, this spec is **phased**. Phase 1 lands verifiable hardening that cannot break the table UI. Full Yjs removal / single-source rewrite is Phase 2, explicitly out of scope here.

## User Scenarios & Testing *(mandatory)*

### Scenario 1 — IndexedDB does not grow without bound (Priority: P1, phase 1)

**Root cause**: clear+repopulate appends full-doc updates every load; no compaction.

**Acceptance Scenarios**:
1. **Given** repeated loads of the same library, **When** the doc is repopulated, **Then** persisted update growth is bounded (the store is reset/compacted rather than endlessly appended), verified by a unit test around the persistence-reset helper.

### Scenario 2 — Deterministic conflict resolution (Priority: P1, phase 1)

**Root cause**: remote-wins by wall-clock `Date.now()` (`useRealtimeSubscription.ts:134-137`) is unsound across clients with skewed clocks.

**Acceptance Scenarios**:
1. **Given** two updates to the same row, **When** resolving, **Then** the winner is chosen by a monotonic/deterministic key (server `updated_at` from the DB, or version counter) rather than client `Date.now()` — covered by a pure resolver unit test.

### Scenario 3 — Single source per library (Priority: P2, phase 2 — out of scope)

**Root cause**: two docs/stores (`library-${id}` + `asset-table-${id}`) merged by `useYjsSync.ts`.

**Acceptance Scenarios** (deferred): collapse to one doc/store or remove Yjs entirely in favor of React Query + Supabase Realtime.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (phase 1): Replace the clear+append pattern so IndexedDB persistence is reset/compacted on repopulate, bounding growth. Extract the reset into a testable helper.
- **FR-002** (phase 1): Replace wall-clock `Date.now()` conflict comparison with a deterministic key sourced from the DB (`updated_at`) or a version counter; extract a pure `resolveConflict(local, remote)` helper.
- **FR-003** (phase 1): Correct or remove the false "supports offline editing" comment (`YjsContext.tsx:36`) to match actual behavior.
- **FR-004** (phase 2, OUT OF SCOPE): Collapse the two docs/stores into one, or remove Yjs and drive the table from React Query + Supabase Realtime.

### Non-Functional Requirements

- **NFR-001**: Phase 1 MUST NOT change the table's rendered behavior for the common single-user path.
- **NFR-002**: No schema change required for phase 1 (uses existing `updated_at`).

## Success Criteria *(mandatory)*

- **SC-001**: Unit test: the persistence-reset helper leaves a bounded store after N repopulations.
- **SC-002**: Unit test: `resolveConflict` is deterministic and independent of client wall-clock.
- **SC-003**: CI (lint + unit + build) green; Playwright green (table still loads/edits).

## Out of Scope

- Phase 2 single-source rewrite / full Yjs removal (large; overlaps #147).
- Adding a real Yjs network provider (only relevant if the product commits to Yjs collaboration).
