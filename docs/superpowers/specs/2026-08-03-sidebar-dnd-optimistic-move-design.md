# Sidebar DnD Optimistic Move Design

**Date:** 2026-08-03

## Goal

Make sidebar drag-and-drop placement feel immediate in production. A valid drop must update the visible tree before the Supabase mutation or subsequent cache refetch completes. If persistence fails, the affected node returns to its previous placement and the existing error feedback is shown.

## Root Cause

`Sidebar.handleTreeDrop` currently waits for the Supabase mutation and then waits for active React Query invalidation/refetch work. `useSidebarTree` only receives the new folder, document, or library placement after those network operations finish. Production latency therefore delays the visible move, while the same code appears fast against a local backend.

Ant Tree's `motion` setting is not the cause. It controls tree expansion/collapse motion and does not move a dropped node into its new hierarchy before application data changes.

## Chosen Approach

Use React Query cache placement as the optimistic source of truth. Immediately patch the existing sidebar query records after a valid drop, then run the current Supabase service call in the background. The existing `useSidebarFoldersLibraries`, `useSidebarDocuments`, and `useSidebarTree` pipeline will rebuild the tree from the patched records without introducing a second tree state.

Alternatives rejected:

- A component-local tree overlay would duplicate folder, document, and library hierarchy state and complicate realtime reconciliation.
- Only removing awaited refetches or enabling Ant Tree motion would still leave the initial database mutation on the visible critical path.

## Placement Model

Add a focused, pure optimistic-placement module under `src/components/layout`. It will describe the record changes for one resolved sidebar drop and apply or conditionally roll them back.

The optimistic fields are:

| Drag operation | Immediate record update |
| --- | --- |
| Folder to folder/root | `Folder.parent_folder_id` becomes the target folder ID or `null` |
| Document under document | `DocumentSummary.parent_document_id` becomes the target document ID and `folder_id` matches the parent document |
| Document to folder/root | `DocumentSummary.folder_id` becomes the target folder ID or `null`; `parent_document_id` becomes `null` |
| Library under document | `Library.source_document_id` becomes the target document ID; `document_export_type` uses the current value or `table`; `folder_id` matches the document |
| Derived library to folder/root | `source_document_id` and `document_export_type` become `null`; `folder_id` becomes the target folder ID or `null` |
| Independent library to folder/root | `Library.folder_id` becomes the target folder ID or `null` |

Only placement fields change optimistically. Server-owned timestamps and unrelated record data remain untouched.

## Drop Flow

1. Resolve and validate the drop with the existing `resolveSidebarDrop` rules.
2. Reject no-op drops using the current placement.
3. Capture the affected node's previous placement and compute its optimistic placement.
4. Cancel relevant in-flight sidebar queries so an older response cannot immediately overwrite the move.
5. Patch `['folders-libraries', projectId]` or `queryKeys.documents(projectId)` synchronously with `queryClient.setQueryData`.
6. Expand the target folder or document immediately.
7. Run the existing Supabase service mutation.
8. On success, keep the optimistic placement, show the existing success toast, broadcast document changes where applicable, and invalidate relevant queries without making refetch latency part of the visible move.
9. On failure, conditionally restore the affected node's previous placement, show the existing error toast, and invalidate the relevant query to reconcile with the server.

The conditional rollback only applies when the record still has this operation's optimistic placement. This prevents a late failure from overwriting a newer placement or unrelated realtime cache changes.

## Pending And Concurrency Behavior

Track pending node keys in `Sidebar`. A node with a persistence request in flight cannot start a second drag. Other nodes remain draggable. The key is removed in `finally`, after either success or rollback.

This avoids out-of-order writes for the same record without serializing unrelated sidebar work. Query invalidation remains the final source-of-truth reconciliation step.

## Error Handling

Existing service errors and toast wording remain in use. A failed mutation:

- restores only the affected placement fields when the optimistic placement is still current;
- preserves names, timestamps, and other concurrent cache changes;
- triggers an authoritative refetch;
- leaves target expansion state unchanged, since expansion is harmless and avoids additional visual movement.

If post-success refetch fails, the optimistic placement remains visible because the database mutation already succeeded. The failure may be logged, matching the existing folder-move behavior, but it must not roll back a successful move.

## Testing

Use test-driven development for the placement helper and wiring:

- folder move to nested and root placement;
- document nesting and document move to folder/root;
- library attach, detach, and ordinary folder/root movement;
- unrelated records and non-placement fields remain unchanged;
- rollback restores previous fields after a failed mutation;
- conditional rollback does not overwrite a newer placement;
- the UI cache is updated before an unresolved persistence promise completes;
- pending node keys prevent a second drag of the same node while allowing other nodes;
- existing sidebar DnD resolver and wiring tests continue to pass.

Run the targeted Jest suite first, followed by TypeScript checking and the relevant broader unit tests.

## Out Of Scope

- Changing sidebar DnD eligibility, nesting depth, or target rules.
- Adding a custom FLIP/reorder animation system.
- Changing Supabase schemas or service authorization checks.
- Applying optimistic behavior to the separate Move modal.
