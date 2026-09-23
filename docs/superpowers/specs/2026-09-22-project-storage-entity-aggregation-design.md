# Project Storage Entity Aggregation Design

**Date:** 2026-09-22
**Status:** Approved for planning

## Goal

Make Account storage match Keco's user-facing project model. A selected project
shows one flat row for each Table, one flat row for each Document, and at most
one Assets row. Images, video, audio, and attachments contribute their actual
stored byte size to their owning row and do not appear as separate rows in the
top-level list.

## Product Model

Keco has three storage-bearing creation entities:

- **Table**: one library, including its schema, all asset rows and cell values,
  and all physical media referenced by those cells.
- **Document**: one document body and all physical images or attachments owned
  by that document.
- **Assets**: one project-level aggregate containing physical project assets
  that are not owned by a Table or Document. This includes uploaded and
  generated standalone assets, maps, character assets, animations, sprites,
  tilesets, UI, effects, image, video, audio, and other attachments.

Folders are containers, not additional charged entities. A folder's size is the
sum of its descendant Tables, Documents, and Assets content. The initial Account
storage UI remains a flat project entity list and does not add a folder tree.

## Summary Presentation

After selecting a project, the storage explorer shows rows such as:

```text
Characters Table    22.12 MB
Design Document      4.30 MB
Assets              86.50 MB
```

The list follows these rules:

- Each Table appears exactly once.
- Each Document appears exactly once.
- Assets appears zero or one time per project.
- Table asset rows such as Alice and Bob do not appear at this level.
- Physical media files do not appear at this level.
- Search, sorting, and pagination operate on the aggregate entity rows.
- Project `fileCount` is the number of visible aggregate entity rows, not the
  number of physical objects or table asset rows.
- Project `usedBytes` is the sum of the aggregate entity row sizes.

## Size Rules

### Table

```text
Table size = deterministic logical Table bytes
           + actual bytes of physical media owned by the Table
```

The logical bytes continue to cover the library name, description, plot plan,
field definitions, asset row names/order, and cell `value_json` values. A URL or
media metadata object contributes its small serialized logical size, while the
referenced Storage object contributes its actual physical size once.

All asset rows remain part of their parent Table. They are not separate summary
entities.

### Document

```text
Document size = UTF-8 bytes of the Markdown body
              + actual bytes of physical media owned by the Document
```

The Markdown image URL remains part of the body bytes. A Keco-managed image or
attachment also contributes its actual Storage object size once. An external
URL with no Keco-managed object contributes only its Markdown text bytes.

### Assets

```text
Assets size = actual bytes of all project physical objects
              not owned by a Table or Document
```

Assets has no duplicate logical wrapper charge. Native asset-table metadata may
be shown in details but does not create extra top-level rows.

### Project And Account

```text
Project size = sum(Table rows) + sum(Document rows) + Assets row
Account displayed used = owned-project sizes
                       + active unassigned legacy bytes
                       + pending-cleanup physical bytes
```

Shared projects remain visible but count only toward their owner's account.
Pending physical cleanup remains charged until the object is deleted and
settled, preserving the existing quota safety rule. It is an account-level
transient amount after its source project has been deleted, so it is not exposed
as a reopenable Table, Document, or Assets row.

## Physical Object Ownership And Deduplication

Every registered physical object has exactly one canonical summary owner:

1. A valid Document association owns the object as a Document detail.
2. Otherwise, a valid Table-cell reference owns the object as a Table detail.
3. Otherwise, the project-level Assets aggregate owns the object.

Canonical identity is the existing unique `(bucket_id, object_path)` registry
entry. That registry row contributes its `size_bytes` exactly once to project
and account totals, even if the same URL is referenced by multiple cells or
documents.

Additional references may be exposed in detail metadata, but they never add a
second charge. When legacy data has conflicting references, deterministic
precedence is Document, then the lexicographically smallest Table UUID, then
Assets. Reconciliation reports the conflict for operational repair.

The database owns attribution. Frontend URL parsing is not an accounting
authority.

## Attribution Registry

Add a private canonical binding from each `project_storage_files` row to its
summary entity. The binding contains:

- `file_id` (unique and foreign-keyed to the physical registry);
- `project_id` and billing `owner_id`;
- `entity_kind`: `document`, `table`, or `assets`;
- `entity_id`: Document UUID, Table/library UUID, or Project UUID for Assets;
- optional `detail_entity_id`: an asset-row or native-asset UUID used only for
  detail grouping;
- timestamps and attribution provenance.

Future writes populate or refresh this binding at the authoritative database
boundary:

- document uploads bind through their Document UUID;
- table media bind after the persisted cell value references the uploaded
  `(bucket, path)` object;
- project asset completion binds to Assets and retains the native asset UUID as
  the detail entity;
- generated map and character objects bind to Assets;
- deletion cascades remove the binding before quota settlement.

The existing `project_storage_files.size_bytes` remains the physical-size
authority. Binding changes move presentation ownership only and never adjust
the physical account counter.

## Historical Backfill

The forward-only migration backfills existing projects inside the migration
transaction:

1. Bind registered `document_image` objects with a valid Document source.
2. Inspect structured media values in `library_asset_values.value_json`, extract
   their bucket/path fields with JSON operators, match existing registered
   objects, and bind them to the parent library and asset row.
3. Bind objects represented by native project asset, map, and character records
   to the project's Assets aggregate.
4. Bind every remaining project physical object to Assets so it cannot disappear
   from the project total.
5. Leave `legacy_unassigned` objects in the existing account-level legacy group
   because they have no trustworthy project.

Backfill never fetches remote URL content and never guesses an object size. It
uses the physical registry, whose sizes were verified against Storage metadata.
The operational backfill/reconciliation commands gain binding-drift reporting
and safe binding repair.

## Read APIs

Replace the selected-project flat file contract with an aggregate entity
contract while preserving the existing authenticated route boundary.

`account_storage_project_entities(project, query, sort, limit, offset)` returns:

- `id`;
- `kind`: `table`, `document`, or `assets`;
- `name`;
- `mimeType`/display type;
- `logicalBytes`;
- `physicalBytes`;
- `sizeBytes` as their sum;
- `folderId` when applicable;
- `createdAt`;
- `sourceAvailable`;
- page metadata.

`account_storage_entity_details(project, kind, id)` returns a read-only detail
model whose item sizes sum exactly to the selected entity's `sizeBytes`:

- Table: a logical table-data item plus asset-row groups containing their owned
  physical media.
- Document: a logical body item plus owned physical media.
- Assets: native asset groups or individual physical objects, with no additional
  logical wrapper size.

Both RPCs require project reader access. Callers cannot request another
project's entity through a valid entity UUID.

## UI Behavior

The Account storage summary continues to show total, allowance, remaining,
physical bytes, and logical bytes. Selecting a project loads the aggregate
entity list instead of raw physical files.

Selecting an entity opens an unframed detail pane or drawer in the existing
storage explorer. The detail view shows the entity subtotal and its read-only
breakdown. Closing it returns to the unchanged one-level list. No delete or edit
actions are introduced by this work.

The existing source navigation maps:

- Table to its library page;
- Document to its document editor;
- Assets to the project Assets workspace.

## Failure And Consistency Behavior

- Summary load failure retains the current first-load and stale-refresh states.
- Entity detail failure does not remove or change the aggregate row; it shows a
  retryable detail error.
- An unbound active project object is assigned to Assets, never omitted.
- A registered object missing from physical Storage remains visible at its
  charged registry size and is reported by reconciliation.
- Invalid historical media JSON does not fail the summary; it remains logical
  Table data while any unmatched registered object falls back to Assets.
- Aggregate arithmetic uses `bigint` in PostgreSQL and remains within the
  application's safe-integer response validation contract.

## Migration And Compatibility

- Use new forward-only migrations; do not edit deployed migrations.
- Keep `account_storage_quotas.used_bytes`, `logical_used_bytes`, and
  `reserved_bytes` semantics unchanged.
- Keep upload enforcement physical-only in this change.
- Evolve TypeScript contracts and APIs atomically so the UI never mixes raw-file
  and aggregate-entity payloads.
- Existing direct Storage-write scanning remains mandatory.
- Existing project cleanup and quota settlement continue using the physical
  registry, independent of presentation bindings.

## Verification

Database behavior tests must prove:

- a Table with two asset rows and several media objects appears once and equals
  logical Table bytes plus each owned object once;
- a Document with multiple images appears once and equals body plus image bytes;
- all standalone uploaded/generated objects appear under one Assets row;
- the same physical object referenced more than once is charged once;
- an active unbound project object falls back to Assets;
- folder placement does not change entity or project totals;
- shared-project bytes remain excluded from the collaborator's account total;
- historical binding backfill and reconciliation are idempotent;
- unauthorized users cannot read aggregate entities or details.

Service, API, and UI tests must prove:

- exact aggregate payload validation;
- one-level Table/Document/Assets rendering;
- no raw media rows in the summary list;
- entity search, sorting, pagination, source navigation, and detail loading;
- entity detail subtotals equal the selected summary row;
- existing loading, refresh, overage, and warning states remain correct.

End-to-end coverage must create a project containing a Table with media, a
Document with media, and standalone Assets, then verify all three rows and the
project/account arithmetic using actual uploaded byte sizes.
