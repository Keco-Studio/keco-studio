# Project Storage Hierarchy And Assets Backfill Design

**Date:** 2026-09-22
**Status:** Approved design, awaiting written-spec review
**Supersedes:** The flat-list presentation and registered-files-only backfill
sections of `2026-09-22-project-storage-entity-aggregation-design.md`

## Goal

Make Account Storage represent the same things users create in a Keco project.
At the project root, Folder, Table, Document, and the optional Assets workspace
are peer entries. Opening a Folder reveals its direct children. Images, video,
audio, and attachments are not extra list rows; their actual stored bytes are
included exactly once in the owning Table, Document, or Assets entry.

The repair must also account for historical Storage objects that exist in
`storage.objects` but were never imported into `project_storage_files`.

## Confirmed Product Model

- **Folder** is a navigable container. Its displayed size recursively totals
  every storage-bearing descendant.
- **Table** is one entry. Its size includes deterministic Table content plus
  the actual bytes of media owned by its cells.
- **Document** is one entry. Its size includes its body plus the actual bytes of
  media owned by the Document.
- **Assets** is a project-root workspace activated by Create. It is one entry,
  never one entry per Folder and never one entry per media file.
- Media details are visible only after opening the owning Table, Document, or
  Assets entry.

`projects.assets_workspace_enabled` is the existence authority for the Assets
entry. An enabled but empty workspace appears at the project root as `0 B`.

## Hierarchical Explorer

The initial view for a selected project is its root directory. It contains:

- root Folders (`parent_folder_id is null`);
- root Tables (`folder_id is null`);
- root Documents (`folder_id is null` and not represented through another
  Folder entry);
- Assets when `assets_workspace_enabled = true`.

Opening a Folder replaces the list with that Folder's direct child Folders,
Tables, and Documents. Assets is not injected into Folder views. Breadcrumbs
show the project and ancestor Folders and allow navigation back to any level.

Opening a Table, Document, or Assets preserves the current directory and opens
its existing read-only storage detail pane. Closing the detail pane returns to
the same directory. Source navigation continues to open the Table editor,
Document editor, or root Assets workspace.

Search applies to the current directory. Sorting and pagination operate on the
current directory's direct entries. Entering another directory clears the
current selection and resets pagination while preserving the chosen sort.

## Size And Count Rules

```text
Table size = logical Table bytes + owned physical media bytes

Document size = logical Document bytes + owned physical media bytes

Folder size = sum of direct child Table and Document sizes
            + sum of direct child Folder sizes

Assets size = physical bytes owned by the root Assets workspace

Project size = sum of all root Folder, Table, Document, and Assets sizes
```

At every directory level, the sizes of its direct rows add up to that
directory's total. A physical object has one canonical owner, so recursive
Folder totals and the project total never double count it.

Project `fileCount` is renamed conceptually to an item count in the UI. It
counts user-created storage explorer entries across the project: each Folder,
Table, Document, and enabled Assets workspace counts once. Individual images,
video, audio, attachments, Table rows, and detail items do not increase it.

## Canonical Media Ownership

Registered physical objects retain the existing precedence:

1. A valid Document source owns Document media.
2. Otherwise, a persisted Table cell referencing the object owns Table media.
3. Otherwise, the project's enabled Assets workspace owns the object.

The canonical identity remains `(bucket_id, object_path)`. Multiple references
to the same object do not create another charge. URLs and structured media
metadata still contribute their serialized logical bytes, but Keco-managed
objects additionally contribute their actual `storage.objects` byte size once.
External URLs have no Keco physical object and therefore contribute only their
serialized logical text.

Assets may contain uploaded or generated images, video, audio, documents,
archives, map resources, character resources, animations, and other supported
files. The summary presents one Assets row; the detail pane presents the
individual files and groups.

## Root Cause And Historical Repair

The deployed entity aggregation migration binds only rows already present in
`project_storage_files`. Historical objects are discovered by
`scripts/backfill-account-storage.ts`, but the production migration workflow
only runs `supabase db push` and did not execute that operational script. The
entity query also emits Assets only when registered Assets bytes are positive.
Together, these behaviors omit historical media, understate project totals,
and can make an activated Assets workspace disappear.

A new forward-only migration, later than
`20260922120000_project_storage_entity_aggregation.sql`, performs an idempotent
database-side repair:

1. Read the accounted buckets in `storage.objects` and their authoritative
   metadata sizes.
2. Skip `(bucket_id, object_path)` pairs already registered.
3. Attribute objects through native records such as `project_game_assets`, map
   references/assets, character assets, and known project path layouts.
4. Import attributable objects into `project_storage_files` with their actual
   byte sizes and best available source metadata.
5. Refresh entity bindings so Document, then Table, then Assets precedence is
   applied to every active project object.
6. Rebuild physical account totals from the repaired registry.
7. Leave genuinely unattributable objects in the existing legacy-unassigned
   accounting path instead of guessing a project.

The migration is repeatable: existing registry uniqueness prevents duplicate
files and the quota rebuild derives totals from canonical rows. The operational
backfill script remains available for auditing but is no longer required for
this production repair to take effect.

Future uploads continue using the current reservation/finalization registry
flow, so no recurring Storage scan is added to Account page reads.

## Read Contract

The project-entries RPC gains an optional `parentFolderId` parameter. A null
value means project root. It returns a common row contract:

- `id`;
- `kind`: `folder`, `table`, `document`, or `assets`;
- `name`;
- `logicalBytes`;
- `physicalBytes`;
- `sizeBytes`;
- `parentFolderId`;
- `createdAt`;
- `sourceAvailable`;
- page metadata and the current directory breadcrumb.

Folder rows are produced by a bounded recursive query over
`folders.parent_folder_id` and storage entities' `folder_id`. Folder recursion
uses the database's existing maximum nesting constraint. Assets is returned
only at root and is selected by workspace existence, not by positive size.

Entity-detail RPCs remain limited to `table`, `document`, and `assets`.
Folders navigate through the project-entries RPC and do not need a physical
file detail endpoint.

All reads continue to require project-reader access. Shared projects remain
visible to accepted collaborators but their bytes remain excluded from the
collaborator's allowance.

## UI Changes

- Add Folder to the validated Account Storage entry union and render it with
  the existing Folder icon language.
- Add breadcrumbs above the list when a project is selected.
- Clicking Folder navigates within Account Storage; it does not open a side
  detail pane.
- Clicking Table, Document, or Assets opens the detail pane as today.
- Change the search placeholder to include folders.
- Preserve desktop three-pane behavior and the existing responsive stacked
  layout without introducing nested cards.
- Keep media out of directory lists; show it only in detail views.

## Failure And Consistency Behavior

- If a directory read fails, retain the current breadcrumb and show a retry
  action instead of returning silently to root.
- If a selected entity detail fails, keep its aggregate row and allow retry.
- An active registered object that loses a valid Document or Table owner falls
  back to Assets and is not omitted.
- An enabled empty Assets workspace remains visible as `0 B`.
- Invalid historical media JSON does not break directory reads. Its logical
  data remains charged to the Table, while unmatched physical objects follow
  the canonical fallback.
- PostgreSQL uses `bigint`; server validation continues rejecting values that
  cannot be represented as safe JavaScript integers.

## Verification

Database coverage must verify:

- a nested Folder recursively totals child Folders, Tables, Documents, and
  their media without duplication;
- root and Folder directory rows partition their directory total;
- Assets appears once at root when enabled, including at `0 B`, and never
  appears inside a Folder;
- historical `storage.objects` rows missing from `project_storage_files` are
  imported with actual metadata sizes and the repair is idempotent;
- Document, Table, and Assets ownership precedence is preserved;
- project/account totals are rebuilt from repaired canonical rows;
- shared-project and authorization behavior remains unchanged.

Service and UI coverage must verify:

- exact validation of Folder rows and breadcrumbs;
- root listing and multi-level Folder navigation;
- current-directory search, sorting, pagination, and retry states;
- Folder clicks navigate while Table, Document, and Assets clicks show details;
- media never appears as a directory row;
- project item counts use created entries rather than physical detail files.

End-to-end coverage must create or seed a project with nested Folders, a Table
with media, a Document with media, and an enabled Assets workspace. It must
verify root and child totals, one root Assets row, detail visibility, and actual
uploaded byte sizes. Production verification must then confirm a historical
project such as `hello` shows its Assets entry and a materially corrected total.

## Delivery

Implementation uses a new branch from current `origin/main`, a forward-only
migration, focused service/UI changes, and regression tests. After local review
and verification, push a PR, wait for all required checks and production deploy
jobs to pass, merge, and verify the deployed Account Storage behavior through
the Windows Keco Studio build on `E:`.
