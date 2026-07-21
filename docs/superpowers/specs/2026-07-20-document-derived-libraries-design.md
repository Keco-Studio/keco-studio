# Document-Derived Tables and Scripts

**Date:** 2026-07-20
**Status:** Approved

## Summary

Project documents become source nodes that can generate tables and scripts. An administrator can export the latest logical state of an open document through the existing document download menu. Each successful export creates one or more project libraries owned by that document and shown beneath it in the sidebar tree.

Derived libraries are independent content snapshots: users may rename, edit, or delete them without changing the source document, but they cannot move them away from the document. Moving the document moves all derived libraries atomically. Deleting the document permanently deletes every derived library and its dependent data.

This feature reuses the existing design-document table generation and script import pipelines. It changes their source acquisition and persistence metadata, not their parsing, generation, preview, or confirmation semantics.

## Goals

- Generate project tables directly from an existing project document.
- Generate a script library directly from an existing project document.
- Display generated libraries as children of their source document.
- Preserve strict ownership: derived libraries follow and are deleted with their source document.
- Keep each export as an independent snapshot rather than creating a live synchronization relationship.
- Preserve existing behavior for ordinary libraries, external file upload, and DOCX/PDF/MDX downloads.

## Non-Goals

- Moving an existing ordinary library under a document.
- Detaching a derived library from its source document.
- Automatically updating generated content after the document changes.
- Updating or overwriting an earlier export.
- Generalizing folders, documents, and libraries into a new universal tree-node model.
- Removing the existing external document upload or script file/text import paths.

## Confirmed Product Rules

1. Each export creates new libraries. Repeated exports never overwrite earlier results.
2. A document may own any number of table and script exports.
3. Only libraries created by a document export may appear beneath that document.
4. Derived libraries may be renamed, edited, and individually deleted.
5. Derived libraries may not be independently moved or detached.
6. Moving a document moves all of its derived libraries to the same folder.
7. Deleting a document permanently deletes all of its derived libraries.
8. Editing a document does not update existing derived libraries.
9. Only administrators may export tables or scripts. Editors and viewers retain the existing document download permissions.
10. A root-level document can export tables and scripts; a folder is not required.

## Data Model

Add two nullable columns to `public.libraries`:

```sql
source_document_id uuid references public.documents(id) on delete cascade,
document_export_type text check (document_export_type in ('table', 'script'))
```

The database must enforce that both columns are null for an ordinary library or both are non-null for a derived library. A derived library must have the same `project_id` and `folder_id` as its source document. No uniqueness constraint applies to `source_document_id` and `document_export_type`, because repeated exports are allowed.

Create an index on `source_document_id` for sidebar grouping, derived-child counts, and cascade planning.

Existing folder-level library name uniqueness remains in effect. An export that requests a duplicate library name in the same folder must use the existing name-conflict error and allow the administrator to choose another name.

### Integrity Enforcement

A library validation trigger must reject any insert or update that would:

- set only one of `source_document_id` and `document_export_type`;
- link a library to a document in another project; or
- give a derived library a `folder_id` different from its source document.

An `AFTER UPDATE OF folder_id` trigger on `documents` must update the `folder_id` of all libraries whose `source_document_id` matches the moved document. The document move and child updates execute in the same database transaction; any failure rolls back the entire move. This database behavior covers UI, service, and Agent-initiated document moves.

The `source_document_id` foreign key uses `ON DELETE CASCADE`. Existing foreign keys from library fields, assets, values, versions, and other library-owned records continue the cascade. Deleting one derived library uses the existing library deletion path and does not affect its source document or siblings.

The application must also hide or reject independent move operations for derived libraries. Database validation remains the final guard against unsupported clients or stale UI.

## Sidebar Tree

Documents with derived libraries become expandable nodes. Documents without derived libraries remain leaf nodes and do not show an empty expansion control.

```text
Folder
  Document
    Characters
    Locations
    Main Story
  Ordinary Library
```

The sidebar groups project libraries by `source_document_id` before building the tree:

- derived libraries are excluded from the folder's ordinary library list;
- each derived library appears exactly once beneath its source document;
- children are ordered by `created_at`, using `id` as a stable tie-breaker;
- clicking the document label opens the document editor;
- clicking its arrow expands or collapses the derived children;
- clicking a child opens the existing library route;
- successful export refreshes the document/library queries and expands the source document;
- moving a document causes the complete subtree to appear in the destination folder.

Derived children use the existing library navigation and context actions, except that the move action is unavailable. Rename, edit, version, and delete behavior stays unchanged.

The document deletion confirmation must state that deletion is permanent and show the number of derived tables and scripts that will also be deleted. The count is informational; the server and database must not rely on it for correctness.

## Document Export Menu

The existing download dropdown remains one ungrouped list. Its item order is:

1. `Download DOCX`
2. `Download PDF`
3. `Download MDX`
4. `Export as tables`
5. `Export as script`

The first three entries preserve their current behavior. The final two entries are rendered only for administrators. They are not shown as separate header buttons and the dropdown contains no section labels or dividers.

Before acquiring an export snapshot, a writable document session must flush pending collaborative edits. The export then reads the document's latest logical state through the document state gateway rather than trusting the potentially stale `documents.content` projection.

## Export as Tables

Selecting `Export as tables` starts a fresh instance of the existing design-document generation handoff for the current project and document. It bypasses file upload and document creation because the source document already exists.

The handoff contains an authenticated document export context with:

- source document ID;
- source document name;
- project ID;
- document folder ID, which may be null;
- the frozen logical-state token and content snapshot; and
- export type `table`.

The assistant uses the existing analysis, schema proposal, preview, and confirmation workflow. One run may create multiple tables. Every library creation preview produced by this handoff carries the source document relationship in its signed internal confirmation payload. On confirmation, the server injects `source_document_id`, `document_export_type = 'table'`, and the document's current folder; it does not infer ownership from names or accept an unvalidated client-side project/folder relationship.

If the document moves after snapshot acquisition but before a table is confirmed, the server resolves its current folder when creating the library. The generated content still comes from the frozen snapshot, while placement follows the document's current location. If the document was deleted or is no longer accessible, creation fails without leaving a partial library.

The existing external `Generate tables from a design document` upload flow remains available. It continues creating a project document from the uploaded file, and its generated tables are attached to that newly imported document through the same export context.

## Export as Script

Selecting `Export as script` opens the existing Import Script modal in project-document source mode. This mode:

- displays the source document name instead of file/text source tabs;
- freezes and previews the latest logical document content acquired after the collaboration flush;
- retains the library-name field, parsing preview, progress reporting, validation, and import button;
- submits the exact frozen snapshot shown in the modal; and
- creates the library with `source_document_id` and `document_export_type = 'script'`.

The script conversion and Story IR import pipeline remains unchanged after source acquisition. The script import service must accept a nullable folder ID so root-level documents can export scripts. It must resolve the document's current folder immediately before the database write and validate administrator access, project ownership, and source-document existence.

The script library and all of its fields, rows, and values must be written transactionally or cleaned up using the existing rollback behavior. A conversion or write failure must not leave an incomplete derived library.

The existing file upload and text input modes remain available from ordinary Import Script entry points. They do not set a source document relationship.

## Snapshot Semantics and Concurrency

An export snapshot is fixed after pending local edits have been flushed and the document state gateway has returned its logical state. Later document edits do not affect that export or any previously generated library.

For table generation, the snapshot token and relationship are sealed into the export handoff and signed confirmation data. For script generation, the modal submits the same frozen content it previewed. The server still validates the source document and its current location at the final write boundary.

Consequences:

- content uses the snapshot captured when the export action began;
- placement uses the document's location at final creation time;
- a concurrent document move does not detach a new result;
- a concurrent document deletion causes creation to fail;
- a later export creates another independent snapshot and another library.

## Permissions and Security

- Export actions require the existing administrator-level library creation permission.
- The UI hides both export actions for editors and viewers.
- Server routes and services independently verify the authenticated user, administrator permission, document/project relationship, and current document existence.
- RLS remains the final authorization boundary for document and library reads/writes.
- Client-provided names, project IDs, folder IDs, source IDs, and export types are not sufficient to establish ownership without server validation.
- Cascading deletion and move invariants are enforced in the database rather than only in the sidebar.

## Errors and User Feedback

- Empty or whitespace-only documents cannot be exported and show a clear error.
- Name conflicts reuse existing library-name validation and conflict messages.
- Snapshot acquisition failures leave the menu/modal usable for retry.
- Table generation retains the existing assistant preview and confirmation behavior.
- Script conversion retains the existing progress and error presentation.
- A deleted source document produces a not-found/access error and no library.
- A failed document move leaves the document and all children in their original folder.
- A failed derived-library deletion leaves the sidebar unchanged after query refresh.
- Successful export shows the existing success feedback, refreshes document and library caches, expands the document, and may navigate to the created library using existing behavior.

## Testing Strategy

### Database and Service Tests

- migration columns, check constraints, indexes, and cascade foreign key;
- reject half-populated export metadata;
- reject cross-project document/library relationships;
- reject a derived library whose folder differs from its document;
- atomically follow document moves, including moves to and from project root;
- cascade document deletion through derived libraries and their dependent records;
- delete one derived library without affecting its source or siblings;
- allow repeated table and script exports from one document;
- allow ordinary libraries with null export metadata;
- allow script import with a null folder when the source document is root-level;
- reject non-admin export creation at the service boundary.

### Component and Integration Tests

- render the five ungrouped export menu entries in the approved order for an admin;
- render only the three existing download entries for editors and viewers;
- build a document node with correctly ordered table/script children;
- omit derived libraries from the folder's ordinary library list;
- omit the expansion arrow for documents without children;
- navigate correctly when document and child labels are clicked;
- hide the move action for derived libraries while retaining rename and delete;
- show derived table/script counts in document deletion confirmation;
- pass document export context through table previews and confirmations;
- open Import Script in document mode with frozen content and no file/text tabs;
- invalidate caches and expand the source document after success.

### End-to-End Tests

- export multiple tables from one folder document and open each child;
- export multiple scripts from one root document and open each child;
- edit the document after export and verify existing children do not change;
- move the document and verify all children move as one subtree;
- independently delete one child and verify the document and siblings remain;
- delete the document and verify all derived libraries and routes disappear;
- verify an administrator can export while an editor and viewer cannot;
- verify external design upload and ordinary Import Script still work;
- verify DOCX, PDF, and MDX downloads remain unchanged.

## Rollout and Compatibility

The migration adds nullable columns, so all existing libraries remain ordinary libraries without backfill. Sidebar behavior for projects without derived libraries is unchanged. The new database checks apply only when export metadata is present.

The feature should ship as one coordinated change because exposing export actions before persistence and sidebar support would create libraries in the wrong hierarchy. External upload/import flows and existing document downloads must remain covered throughout the rollout.
