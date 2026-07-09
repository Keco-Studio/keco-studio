# Collaboration Architecture Overview

**Status**: Current as of 2026-07-09  
**Source of truth**: Current source code, `package.json`, and Supabase migrations

This document describes the collaboration code that exists today. The current
model is online Yjs state coordinated through Supabase Realtime, with Supabase
PostgreSQL and Storage as the durable persistence layer. There is no browser
document-store persistence package in `package.json`, and collaboration code
does not use a local restored document store.

---

## 1. Scope

Collaboration has two related areas:

1. **Project collaboration**: invitations, collaborator roles, member removal,
   and access checks.
2. **Library table collaboration**: online cell edits, asset create/delete,
   row-order refresh, batch cell updates, connection status, and presence.

The library table path is:

```
[projectId]/[libraryId]/page.tsx
  -> LibraryDataProvider
  -> YjsProvider
  -> LibraryAssetsTableAdapter
  -> LibraryAssetsTable
```

`LibraryDataContext` owns the canonical in-session asset state for a library.
`LibraryAssetsTable` receives rows through the adapter and uses `useYjsSync`
only to keep local optimistic table placeholders aligned with the canonical
`allAssets` order.

---

## 2. Project Collaboration

### Types

**File**: `src/lib/types/collaboration.ts`

Important types include:

| Type | Purpose |
| --- | --- |
| `CollaboratorRole` | `admin`, `editor`, or `viewer` |
| `ROLE_PERMISSIONS` | Role capabilities for invite/manage/edit/view |
| `Collaborator` | Accepted collaborator data |
| `PendingInvitation` | Pending invitation data |
| `InvitationTokenPayload` | JWT invitation payload |
| `PresenceState` | Online user and active-cell metadata |
| `CellUpdateEvent` | Cell update broadcast payload |
| `AssetCreateEvent` | Asset create broadcast payload |
| `AssetDeleteEvent` | Asset delete broadcast payload |

### Service and Server Actions

**Files**:

- `src/lib/services/collaborationService.ts`
- `src/lib/actions/collaboration.ts`
- `src/lib/services/authorizationService.ts`

`collaborationService.ts` handles invitation and collaborator database work.
`collaboration.ts` exposes server actions with server-side auth checks.
`authorizationService.ts` centralizes project role and permission checks.

UI entry points include `InviteCollaboratorModal`, `CollaboratorsList`,
`CollaboratorsContent`, and the invitation accept/decline pages.

---

## 3. Library Collaboration

### LibraryDataContext

**File**: `src/lib/contexts/LibraryDataContext.tsx`

Responsibilities:

- Create one in-memory `Y.Doc` per library provider.
- Store assets in `yAssets`, a `Y.Map` keyed by asset id.
- Hydrate `yAssets` from Supabase through `loadInitialData`.
- Derive React `assets` state from `yAssets.observeDeep`.
- Derive `allAssets` from `assets`, sorted by library row order and stable
  asset ordering logic.
- Expose mutations for asset create/delete, asset name changes, single-cell
  updates, batch cell updates, and refresh.
- Initialize Supabase Realtime subscriptions and presence tracking.
- Expose `connectionStatus`, `presenceUsers`, `setActiveField`, and
  `getUsersEditingField`.

Durable data is written to Supabase. Yjs provides the current client session's
CRDT state and lets UI updates apply immediately while database writes and
Realtime broadcasts complete.

### Mutations

**File**: `src/components/libraries/hooks/useLibraryAssetMutations.ts`

Mutation flow:

1. Update the local `yAssets` structure.
2. Persist the change to Supabase.
3. Broadcast the change through Supabase Realtime when appropriate.
4. For batch updates, collect cell payloads and broadcast them as a batch.

The public mutation API remains centered on `LibraryDataContext`; table
components do not write directly to Supabase.

### Realtime Subscription

**File**: `src/lib/hooks/useRealtimeSubscription.ts`

The edit channel is `library:${libraryId}:edits`.

It handles:

- `cell:update`
- `cells:batch-update`
- `asset:create`
- `asset:delete`
- `roworder:change`
- `postgres_changes` for `library_asset_values` and `library_assets`

Broadcasts are the fast path. Postgres changes are the durable fallback, so a
client can still converge after a missed broadcast. The hook filters the
current user's own recent writes to avoid echo loops.

### Presence

**File**: `src/lib/hooks/usePresenceTracking.ts`

The presence channel is `library:${libraryId}:presence`.

Presence state tracks:

- user id and display name
- active cell
- cursor position
- last activity
- connection status

`LibraryDataContext` exposes presence helpers to the table adapter. The table
updates presence on focus/edit and renders active collaborators through
cell-level presence UI.

---

## 4. Table Row Order and Optimistic Rows

### YjsProvider

**File**: `src/lib/contexts/YjsContext.tsx`

`YjsProvider` creates an in-memory `Y.Doc` and a `Y.Array` named `rows` for the
current library. It is a table-local coordination structure for optimistic
placeholders and display alignment. It is not a durable source of truth.

### useYjsSync

**File**: `src/components/libraries/hooks/useYjsSync.ts`

`useYjsSync(rows, yRows)` aligns table-local `yRows` with the canonical
`rows` passed from `LibraryDataContext.allAssets`.

Key rules:

- `rows` is the authoritative row collection.
- `yRows` may temporarily contain local placeholders such as `temp-insert-*`.
- If row ids or order drift from `rows`, `useYjsSync` replaces `yRows` with
  `rows`.
- If a real row arrives at a placeholder's intended index, it replaces the
  placeholder.

This keeps "insert above/below" responsive locally while converging to the
same row order for every online client.

### Adapter and Table

**Files**:

- `src/components/libraries/LibraryAssetsTableAdapter.tsx`
- `src/components/libraries/LibraryAssetsTable.tsx`

The adapter maps `LibraryDataContext` values to table props. The table uses
`useYjsSync` for display rows, sends edits through the adapter callbacks, and
uses `presenceTracking` to update and render active-cell state.

---

## 5. Current Guarantees

- Supabase is the durable source for libraries, assets, field values, roles,
  invitations, and files.
- Yjs is the current-session CRDT state used by the UI and mutation flow.
- Supabase Realtime broadcasts provide fast online collaboration updates.
- Postgres change subscriptions provide convergence when a broadcast is missed.
- Presence is online-only state and is not persisted as business data.
- Row display order follows the canonical `rows` from `LibraryDataContext`,
  with local placeholders reconciled by `useYjsSync`.

---

## 6. Non-Goals

- This document does not define a replacement local-first editing model.
- This document does not change collaboration behavior; it documents the code
  that exists now.
