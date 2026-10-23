# Library Table Sort And Durable Undo Design

## Goal

Add display-only numeric sorting and complete, per-user undo/redo for document
tables. Every table mutation must be reversible for 24 hours, including
destructive row, column, cell-value, and media changes. A browser refresh must
clear the visible undo and redo controls without prematurely destroying the
server-side recovery record.

## Confirmed Product Rules

- Numeric headers cycle `none -> ascending -> descending -> none`.
- Numeric sorting is display-only. It does not write `row_index`, change the
  shared row order, or create an undo operation.
- Undo and redo apply only to the current actor's operations. They never undo
  a collaborator's operation.
- The current browser session alone determines which undo and redo controls are
  visible. A reload starts with empty controls.
- All table mutations participate: single-cell edits, name edits, paste, cut,
  batch fill, clear contents, formula customizations, reference changes, media
  replacement/removal, row creation/deletion/reordering, and column
  creation/edit/deletion/reordering.
- Deleted data and media storage objects remain recoverable for 24 hours. They
  are permanently removed after the operation expires; there is no user-visible
  recycle bin in this delivery.
- An undo is refused if its preconditions no longer hold because a collaborator
  changed the same affected data. The UI reports that the operation can no
  longer be safely undone and leaves collaborator data intact.

## Architecture

### Durable Operation Journal

Create a `library_table_operations` table keyed by `library_id`, `actor_id`,
and a generated operation ID. Each row records:

- `kind`: the mutation category, such as `cells_updated`, `rows_deleted`, or
  `field_deleted`.
- `forward_payload` and `inverse_payload`: JSONB snapshots sufficient to apply
  the forward action or restore the exact prior state.
- `state`: `active`, `undone`, or `expired`.
- `created_at` and `expires_at` (`created_at + interval '24 hours'`).

Every mutation moves through one authoritative security-definer RPC. The RPC
checks the caller's edit permission, locks the library and affected rows, makes
the business mutation, and inserts the operation journal row in the same
transaction. It returns the operation ID and the authoritative rows/schema
needed to update the client store.

Snapshots preserve original UUIDs, timestamps, `row_index`, field metadata,
and `library_asset_values`. Restoring a deleted row or field therefore retains
references and formula relationships rather than creating semantically similar
but different records.

### Apply, Undo, And Redo

`apply_library_table_operation` accepts a typed operation input and returns a
new operation ID. `undo_library_table_operation(operation_id)` and
`redo_library_table_operation(operation_id)` accept only an operation created
by `auth.uid()`, still within the 24-hour retention window, and in the matching
state.

Undo and redo use optimistic-concurrency preconditions stored in the payload.
For example, a cell undo requires the value to still equal the value written by
the forward operation; field undo requires the field and all relevant schema
metadata to still match; and a row-order undo requires the tracked row indexes
to still match. A mismatch raises a conflict error without changing data or the
operation state. A successful undo changes `active` to `undone`; a successful
redo changes it back to `active`.

The client keeps only an in-memory stack of operation IDs created in this page
session. After a successful write it pushes the returned ID and clears redo.
After successful undo/redo it moves that ID between the two stacks. The stacks
are intentionally never persisted in browser storage, so a page refresh hides
undo/redo while server records remain until expiry for cleanup and integrity.

### Deferred Media Cleanup

Media references are removed from the visible cell as part of the database
operation, but their storage paths are recorded in the operation payload as
deferred deletes. The object must not be removed at mutation time because an
undo may restore the prior cell value.

The expiration cleanup routine first confirms that the operation is expired and
that no non-expired operation can still restore that path. It then removes the
storage object, settles storage accounting, marks the operation `expired`, and
redacts no-longer-needed snapshot data. Retrying cleanup must be idempotent.
Replacing media retains the old object for the operation's 24-hour window;
newly uploaded media that is removed by undo becomes eligible for the same
deferred cleanup protocol.

### Mutation Gateway And Realtime

A single table-mutation gateway replaces direct calls from table hooks and
header/modals. It takes a complete, typed change request and calls the durable
operation RPC. It applies the returned authoritative result to the observable
asset store, refreshes schema when needed, invalidates formula metadata, and
broadcasts the final mutation through the existing collaboration channels.

Direct schema writes in `TableHeader`, `EditColumnModal`, reorder callbacks,
and row/cell hooks must be routed through this gateway. Existing non-table
entry points, including agent and script-system mutations, remain unchanged.
This keeps the scope to user edits made through the document table.

### Numeric Sorting

Introduce a pure sorting utility and a local `NumericSortState`. The table
composes it after existing persisted row ordering and value filtering. Sorting
is stable, orders valid numeric values by direction, and always places empty,
invalid, and non-finite values after valid numbers. Header affordances are
shown only for `int` and `float` columns and must coexist with current filtering,
resize, and reorder controls.

### Keyboard And UI

The table root owns shortcuts while focus is inside the table:

- `Ctrl/Cmd+Z`: undo.
- `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y`: redo.

Shortcuts are not intercepted while a native text input/textarea/contenteditable
editor has a non-collapsed selection or its own edit history should win. The
table exposes accessible undo and redo icon controls with disabled states and
concise conflict/error feedback.

## Database And Cleanup Contract

The migration creates the journal table, indexes for actor/library/state and
expiry scanning, RLS policies that restrict visibility to the actor, and the
apply/undo/redo RPCs. It also installs a cleanup RPC callable by the existing
privileged scheduled-maintenance path. The deployment configuration schedules
that cleanup at least hourly; the operation RPCs may also lazily clean a small
bounded batch of expired records before creating new work.

No operation is replayed from client-provided snapshots. The server stores and
validates all snapshots. Client payloads describe user intent and expected
versions only. This prevents a stale browser from restoring deleted objects
over later collaborator changes.

## Error Handling

- Permission failure: no mutation or journal row is created.
- Validation failure: no mutation or journal row is created.
- Transaction failure: mutation and journal insertion roll back together.
- Conflict during undo/redo: journal state and business data remain unchanged;
  the client drops the unusable stack entry after showing an explanation.
- Media cleanup failure: the operation remains eligible for retry; data is not
  marked permanently expired until the storage deletion/accounting work has
  completed or the path is proven absent.

## Testing

Database/RPC tests cover permissions, atomic snapshots, restoring original IDs,
row and field cascades, cell and batch changes, operation-state transitions,
conflicts, expiration, and idempotent media cleanup. Unit tests cover operation
stack transitions, redo invalidation, numeric sorting, shortcut routing, and
gateway result handling. Component tests cover numeric header cycling and all
table mutation entry points. Integration tests cover realtime convergence and
the rule that a user cannot undo another user's work.

## Non-Goals

- A user-visible recycle bin or recovery UI after browser refresh.
- Undo history that survives refresh as a visible stack.
- Undo for writes outside the document-table UI, such as agent, script-system,
  sidebar, or direct service consumers.
- Persisting a sorted display order as a shared table order.
