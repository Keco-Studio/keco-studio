# Collaboration Table Unified Design

**Status**: Historical design note, superseded by the current implementation  
**Current source of truth**: `COLLABORATION_OVERVIEW.md` and the source files
listed there

This document is retained as an implementation history summary. The earlier
row-order inconsistency work has been folded into the current table
collaboration architecture:

- `LibraryDataContext` owns canonical asset state for a library.
- `allAssets` provides the canonical table row collection.
- `useYjsSync` keeps local optimistic row placeholders aligned with `allAssets`.
- Supabase Realtime broadcasts fast online changes.
- Supabase Postgres changes provide convergence when broadcasts are missed.

For current collaboration behavior, read
[`COLLABORATION_OVERVIEW.md`](./COLLABORATION_OVERVIEW.md).

---

## Implemented Resolution

The unified table design resolved the original class of bugs by making one
source authoritative for row collection and display order:

1. **Canonical rows** come from `LibraryDataContext.allAssets`.
2. **Local placeholders** live in the table-local `yRows` structure while a
   user inserts or pastes rows.
3. **Reconciliation** happens in `useYjsSync`: if ids or order drift from
   canonical rows, the local table row structure is replaced with canonical
   rows; if a newly persisted row arrives at a placeholder position, it
   replaces the placeholder.
4. **Remote changes** enter through Supabase Realtime broadcasts and Postgres
   change subscriptions, then update the same `LibraryDataContext` state.

---

## Current Design Rules

- Table components do not own durable data.
- Realtime code does not maintain a separate row-order source.
- Placeholder rows are temporary UI state.
- Every online client converges to the same canonical row collection.
- Presence is online session state and is separate from persisted asset data.

---

## Relevant Files

- `src/lib/contexts/LibraryDataContext.tsx`
- `src/lib/contexts/YjsContext.tsx`
- `src/lib/hooks/useRealtimeSubscription.ts`
- `src/lib/hooks/usePresenceTracking.ts`
- `src/components/libraries/hooks/useYjsSync.ts`
- `src/components/libraries/hooks/useLibraryAssetMutations.ts`
- `src/components/libraries/LibraryAssetsTableAdapter.tsx`
- `src/components/libraries/LibraryAssetsTable.tsx`
