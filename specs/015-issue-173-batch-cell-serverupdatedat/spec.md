# Feature Specification: Pass serverUpdatedAt on batch cell broadcasts (issue #173)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #173 — the batch cell-update path calls `broadcastCellUpdate(assetId, fieldId, value)` without `serverUpdatedAt`, weakening last-write-wins conflict resolution during batch fill.

## Overview

`broadcastCellUpdate` in `src/lib/hooks/useRealtimeSubscription.ts:222` accepts a fifth argument `updatedAt?: string | null` and stamps it onto the emitted `CellUpdateEvent` (`updatedAt` field, line 253). Remote peers use this server timestamp for last-write-wins (LWW) conflict resolution: an incoming event whose `updatedAt` is older than a cell's current server timestamp can be safely ignored.

The single-cell path passes it correctly:
- `useLibraryAssetMutations.ts:225` — `broadcastCellUpdate(assetId, fieldId, valueForYjs, oldValue, serverUpdatedAt)`
- `useLibraryAssetMutations.ts:285` — `broadcastCellUpdate(assetId, 'name', newName, oldName, serverUpdatedAt)`

The batch path in `updateMultipleFields` does **not**:
- `useLibraryAssetMutations.ts:446` — `broadcastCellUpdate(assetId, fieldId, value)` — no `oldValue`, no `serverUpdatedAt`.

### Investigation findings (verified 2026-07-09)

1. `updateMultipleFields` (`useLibraryAssetMutations.ts:435-449`) first calls `updateAssetField(..., { skipBroadcast: true })` for each update, then loops and broadcasts each cell with only three arguments. `updateAssetField` internally obtains `serverUpdatedAt` from the persisted row, but because the batch path calls `updateAssetField` with `skipBroadcast: true`, that per-cell `serverUpdatedAt` is discarded rather than surfaced to the batch broadcast.
2. Because `updatedAt` is `undefined` on these events, a peer's LWW check has no server timestamp to compare against, so a concurrent remote update is more likely to be applied over (or under) the batch value incorrectly. This is a correctness weakness, not a crash.
3. A sibling batch path, `updateAssetsBatch` (`useLibraryAssetMutations.ts:451-476`), uses `broadcastCellsBatchUpdate` and likewise omits any server timestamp — the same class of bug. This spec's fix MUST cover both batch paths for consistency (see FR-004).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Batch fill does not lose to stale concurrent edits (Priority: P1)

As a user batch-filling many cells while a collaborator edits one of the same cells, my batch values are resolved by the same server-timestamp LWW rule as single edits, so the newer write wins deterministically.

**Why this priority**: This is the core defect — batch operations are exactly when many cells change at once and concurrency is most likely.

**Independent Test**: Unit-test `updateMultipleFields` with a mocked `realtime.broadcastCellUpdate` and assert every call receives a defined `serverUpdatedAt` matching the value persisted for that cell.

**Acceptance Scenarios**:
1. **Given** a batch update of N cells, **When** `updateMultipleFields` broadcasts, **Then** each `broadcastCellUpdate` call includes the `serverUpdatedAt` returned when that cell was persisted.
2. **Given** a remote `cell:update` event with an older `updatedAt` than the local batch value, **When** it is received, **Then** LWW discards it and the batch value is retained.
3. **Given** a remote event with a newer `updatedAt`, **When** received, **Then** it correctly overrides the batch value.

### Edge Cases

- A cell whose persist returns a null `updatedAt` MUST broadcast `null` (not `undefined`) so peers treat it consistently with the single-cell path.
- If `updateAssetField` throws for one cell in the batch, the broadcast for that cell MUST NOT fire (no timestamp, no event) — matching current single-cell rollback behavior.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `updateMultipleFields` MUST capture the per-cell `serverUpdatedAt` produced when each cell is persisted and pass it as the fifth argument to `broadcastCellUpdate`.
- **FR-002**: The batch path MUST also pass `oldValue` (fourth argument) consistent with the single-cell path so peer conflict UI has the prior value.
- **FR-003**: Persist and broadcast MUST NOT be split in a way that loses the timestamp — either have `updateAssetField` optionally return its `serverUpdatedAt`, or collect it alongside each queued broadcast, without changing the single-cell path's behavior.
- **FR-004**: `updateAssetsBatch` / `broadcastCellsBatchUpdate` MUST carry the same server timestamp per cell so the batch-broadcast path has parity with per-cell broadcasts.
- **FR-005**: The change MUST NOT alter the single-cell paths (`updateAssetField`, `updateAssetName`), which already behave correctly.

### Non-Functional Requirements

- **NFR-001**: No additional DB round-trips — reuse the `updated_at` already returned by the existing upsert/update in `updateAssetField`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A regression unit test proves every batch broadcast carries a defined `serverUpdatedAt`, and fails against the current `broadcastCellUpdate(assetId, fieldId, value)` call.
- **SC-002**: An LWW unit test proves a stale remote event is discarded and a newer one is applied, for values originating from the batch path.
- **SC-003**: `npm run lint`, `npm run typecheck`, and `npm run test:unit` are green.

## Out of Scope

- Redesigning the LWW/conflict model itself.
- Changing the realtime transport or event schema beyond ensuring `updatedAt` is populated.
