# Feature Specification: Cell-edit hot path — cache formula meta, batch updated_at, drop setTimeout race (issue #161)

**Feature Branch**: `git-issues-fix`
**Created**: 2026-07-07
**Status**: Draft
**Input**: GitHub issue #161 — 4-6 sequential DB round-trips per cell edit plus a setTimeout(100) race patch.

## Overview

Every single cell edit in `updateAssetField` (`src/lib/contexts/LibraryDataContext.tsx:663`) issues several sequential DB round-trips:
1. `await getFormulaFieldMeta()` (`:669`) — fetched per call, never cached (helper at `:401`).
2. Upsert the value.
3. `touchLibraryUpdatedAt(supabase, libraryId, projectId)` (`:758`) — three writes bumping `updated_at` on library/project/folder (helper `:99`).
4. Reference sync.
5. `await new Promise(resolve => setTimeout(resolve, 100))` (`:766`) — a magic-number race patch before broadcasting.

`updateMultipleFields` (`:1019`) calls `updateAssetField` per pasted cell, multiplying the cost. This spec caches formula metadata per library, collapses the three `updated_at` writes into one operation, and removes the fixed `setTimeout` in favor of an explicit await.

## User Scenarios & Testing *(mandatory)*

### Scenario 1 — Formula metadata is not re-fetched per edit (Priority: P1)

**Root cause**: `getFormulaFieldMeta` (`:401`) runs a DB query on every `updateAssetField` call (`:669`) with no cache.

**Acceptance Scenarios**:
1. **Given** several edits in one library without a field-definition change, **When** they run, **Then** formula metadata is fetched at most once (cached), verified by a unit test on the cache (second call returns cached value, no second fetch).
2. **Given** a field-definition change, **When** it occurs, **Then** the cache is invalidated and the next edit refetches.

### Scenario 2 — updated_at bump is a single operation (Priority: P2)

**Root cause**: `touchLibraryUpdatedAt` (`:99`, called `:758`) issues three separate writes (library, project, folder) per edit.

**Acceptance Scenarios**:
1. **Given** a cell edit, **When** timestamps are bumped, **Then** it uses one round-trip (a single RPC, or a DB trigger that cascades) rather than three separate writes.

### Scenario 3 — No fixed-delay race patch (Priority: P2)

**Root cause**: `:766` awaits a hardcoded `setTimeout(…, 100)` before broadcasting.

**Acceptance Scenarios**:
1. **Given** a cell edit, **When** the broadcast happens, **Then** it awaits the actual dependency it was racing (persist/state settle) rather than a fixed 100ms sleep; no behavioral regression in the broadcast.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Cache formula-field metadata per library in a ref/map; `getFormulaFieldMeta` returns the cached value and only fetches on miss. Invalidate on field-definition change.
- **FR-002**: Replace the three `updated_at` writes with a single operation — preferred: a Postgres RPC or a DB trigger that bumps the ancestors from one call; fallback: one batched statement. If a migration is added, verify via the RLS_DB_TESTS harness.
- **FR-003**: Remove the `await setTimeout(…, 100)` at `:766`; await the concrete condition (persisted write / state update) it was compensating for.
- **FR-004**: `updateMultipleFields` (`:1019`) MUST benefit — the cached meta and batched timestamp apply so a paste of N cells does not do N× formula fetches or 3N× timestamp writes.

### Non-Functional Requirements

- **NFR-001**: No change to the resulting persisted values or broadcast payloads.
- **NFR-002**: Cache is per-library and cleared on library switch to avoid stale metadata.

## Success Criteria *(mandatory)*

- **SC-001**: Unit test: formula-meta cache returns a cached value without a second fetch, and invalidates on field-definition change.
- **SC-002**: Unit test (or migration behavior test): a single updated_at operation replaces the three writes.
- **SC-003**: Unit test: the broadcast path contains no fixed `setTimeout(…,100)`.
- **SC-004**: CI (lint + unit + build) green; Playwright green (editing/paste unaffected).

## Out of Scope

- Full debounce/queue redesign of persistence beyond removing the per-edit waste.
- Reworking realtime conflict resolution (that is #160).
