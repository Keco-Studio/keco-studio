# Script Dialogue Mutation Performance

## Goal

Make adding and deleting a Script dialogue block feel immediate in production by
replacing the current client-side request waterfall with one transactional database
call per mutation and an immediate React Query cache update.

## Current Problem

A dialogue block is stored as an action row plus a speech row. Adding one block
currently shifts row indexes, invokes the generic asset creation service twice, and
then synchronously refetches every asset and property value in the script library.
Each generic create repeats authorization, schema metadata reads, inserts, and
ancestor timestamp updates. Deletion has a smaller but similar request waterfall.

The local database hides the cost because round-trip latency is negligible. In the
hosted environment, the serial requests dominate the operation and the full-table
refetch grows with the script.

## Design

### Atomic Database Mutations

Add two authenticated PostgreSQL functions:

- `insert_script_dialogue_block(p_library_id, p_after_row_id, p_speaker,
  p_speech_type, p_type_field_id, p_name_field_id, p_content_field_id)`
- `delete_script_dialogue_block(p_library_id, p_action_row_id,
  p_speech_row_id)`

Both functions execute in one transaction and use `auth.uid()` to require project
owner, admin, or editor access. They validate that the library and requested fields
or rows belong together.

Insert locks the library's asset rows while calculating placement, normalizes legacy
or invalid indexes when necessary, shifts following indexes once, creates the action
and speech rows plus their property values, and touches the library, project, and
folder timestamps once. It returns both complete rows in the shape needed by the
frontend cache.

Delete validates both rows, deletes them in one statement, and touches ancestor
timestamps once. It does not renumber the remaining rows because gaps are supported
and removing that extra write avoids updating the rest of the script. It returns the
deleted row IDs.

The functions are `SECURITY DEFINER`, have an explicit `search_path`, reject anonymous
callers, and expose execution only to `authenticated` and `service_role`.

### Client Mutation Service

Replace the Script editor's calls to generic `createAsset` and `deleteAssets` for the
normal add/delete paths with small typed wrappers around the two RPCs. Existing
generic services remain unchanged for table editing and for undo/redo compatibility.

The insert wrapper derives the speech type from the already-loaded rows and sends
the three validated Script column IDs. The server is authoritative for row IDs and
row indexes.

### Cache and Interaction

After a successful RPC, update `queryKeys.libraryAssets(libraryId)` directly:

- Insert shifts cached indexes at and after the returned insertion position and adds
  the two returned rows.
- Delete removes the returned IDs.

History is recorded only after the RPC succeeds. The newly inserted speech row enters
edit mode immediately after the cache update. Delete no longer needs component-local
hidden state to mask a slow refetch, although keeping that state is harmless.

An invalidation is still scheduled after the cache update as a non-blocking background
reconciliation. The command's returned promise does not await the full-library fetch,
so controls are released when the atomic mutation and cache update finish.

If the RPC fails, the cache is not changed and the existing error toast is shown. If
the background reconciliation fails, the successful mutation stays visible and React
Query may retry later; it must not report the mutation itself as failed.

### Compatibility

- Existing scripts with missing or duplicate row indexes are normalized inside the
  insert transaction before placement.
- Environment lines and single-row blocks remain deletable by accepting either row ID
  as nullable while requiring at least one.
- Undo and redo keep their current behavior in this change. They are less frequent and
  can be migrated to atomic RPCs separately without expanding this fix.
- Reordering and field editing are outside this change.

## Testing

Database contract tests or static migration tests verify function presence, grants,
authorization checks, field/row ownership validation, atomic two-row insertion, batch
deletion, and one ancestor timestamp update per function.

Unit tests verify that:

- insert calls one RPC and maps both returned rows;
- delete calls one RPC for one- and two-row blocks;
- cache insertion shifts indexes and adds both rows in display order;
- cache deletion removes only the target rows;
- editor add/delete resolves without awaiting background invalidation;
- RPC failure leaves the cache unchanged and returns the existing failure result.

Run the focused Script dialogue tests, TypeScript checking, and the repository's
migration/static test suite before completion.

## Success Criteria

- One Supabase HTTP request performs a normal dialogue add.
- One Supabase HTTP request performs a normal dialogue delete.
- The UI reflects the mutation after that request without waiting for a full-library
  refetch.
- Add/delete authorization and data integrity are no weaker than the current path.
- Existing Script dialogue behavior and undo/redo tests remain passing.
