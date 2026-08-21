# GDD Resource Version Evolution

**Date:** 2026-08-20  
**Status:** Approved design

## Goal

Turn repeated GDD generation for the same project and Game Design System into
one evolving resource set instead of a sequence of dated folders. A generation
updates only resources whose content changed, preserves their previous content
in the existing version-history UI, and carries unchanged or omitted resources
forward without duplicating them.

## Product Semantics

A GDD resource set is identified by one project and one Game Design System. It
has one root folder named exactly after the Game Design System. The name does
not include `GDD`, a date, a time, or a version suffix.

Each successful generation is the next GDD generation revision. The revision
number is allocated atomically within the resource set and is used to label
automatic history entries such as `GDD Version 2`.

The resource set can contain:

- one primary GDD Document;
- generated Tables;
- generated dialogue source Documents;
- generated Script Tables produced from those dialogue sources.

Resource identity remains stable across generations. Existing links continue
to point to the same Document or Table after its content is updated.

## Resource Identity

Persist a stable series identity for the `(project_id, design_system_id)` pair.
The series owns the fixed folder, primary GDD Document, and current generation
revision. A unique database constraint prevents two series for the same pair.

Generated child resources carry a stable logical key within the series:

- primary GDD: a reserved key such as `gdd`;
- generated Table: normalized generated table name;
- dialogue source Document: generator `chapterKey`;
- generated Script Table: the same `chapterKey`, in the Script resource kind.

Logical keys are compared case-insensitively after trimming and normalizing
whitespace. Duplicate keys in one generation fail validation before writes.
Names remain editable display data; identity does not silently change merely
because display casing changes.

## Generation Flow

1. Resolve or create the series under an advisory lock scoped to project and
   Game Design System.
2. On first generation, create the fixed folder, the primary GDD Document, and
   the generated child resources.
3. On later generations, load all series-owned resources and match generated
   outputs by resource kind and logical key.
4. Canonicalize each generated payload and compare its content hash with the
   current persisted resource.
5. For a changed resource, save the old state in that resource's existing
   version store and then update the same resource ID.
6. For an unchanged resource, leave its data and version history untouched and
   include it as reused in the generation manifest.
7. For a new logical key, create a new resource in the fixed folder.
8. For an existing key omitted by the new output, preserve the resource without
   modification. Omission is not deletion.
9. Increment the series revision only when the complete write succeeds, then
   complete the durable generation job with the resolved resource IDs.

The generation manifest records which resources were created, updated, reused,
or preserved because they were omitted. This makes every revision auditable
without creating duplicate resources.

## Version History

Changed Documents use `document_versions`; changed Tables and Script Tables use
`library_versions`. Both stores gain a dedicated `gdd_generation` version type.
Entries use the shared label `GDD Version <revision>` and metadata linking the
version to the generation job, series, and Game Design System version. Existing
version readers, previews, and restore actions accept this type; generated
versions are read-only history entries and cannot be manually deleted.

Before updating a changed resource, the transaction snapshots its current
state. The generated result then becomes the resource's current state, so the
existing right-side Version History module shows:

- `Current Version` for the latest generated content;
- `GDD Version N` entries for earlier changed states.

Unchanged resources do not receive empty or duplicate version entries. They are
still recorded as reused by the generation manifest.

Generated version records are durable and restorable. They must not be removed
by automatic-checkpoint retention. Existing restore behavior remains the UI and
service contract for returning one resource to an earlier state.

## Content Comparison

Comparison uses canonical structured content rather than timestamps or display
formatting:

- Documents: normalized Markdown for equality, with the matching Yjs state kept
  as the restorable snapshot;
- Tables: ordered field definitions, ordered rows, and canonical cell values;
- Script Tables: the same Table snapshot rules, including branching fields;
- dialogue sources: normalized source Markdown keyed by `chapterKey`.

Metadata that changes every job, including job IDs and timestamps, is excluded
from content hashes. A display-name change is treated as a resource change but
does not create a different logical resource.

## Concurrency And Atomicity

The persistence RPC locks the series and affected resources. Document updates
verify collaboration epoch, revision, and pending update IDs. Table updates lock
the Library and snapshot the complete current table before mutation.

All resource snapshots, updates, creations, manifest writes, series revision,
and job completion occur in one database transaction. A concurrent edit or
stale generation produces a retryable conflict; no partial resource set is
published and no user content is overwritten.

Replaying the same generation job is idempotent. It returns its previously
resolved resources without adding another version or incrementing the revision.

## Existing Data Migration

No destructive bulk cleanup is performed.

When a project and Game Design System have previous successful GDD jobs but no
series row, bootstrap the series from the newest valid completed output:

- reuse its folder and primary GDD Document;
- rename that folder to the Game Design System title when no unrelated root
  folder already has that exact normalized name;
- register its generated Tables and dialogue resources using their available
  names and chapter keys;
- leave older dated folders and unrelated resources unchanged.

If no valid prior output exists, create a new fixed folder. Ambiguous duplicate
logical keys fail migration safely instead of choosing one silently.

## Folder Name Changes

The folder follows the current Game Design System title. At generation time, a
series-owned folder is renamed when the System title changed. An unrelated
same-name folder is never adopted, overwritten, or bypassed with a suffix. The
generation fails with an actionable naming conflict so that every successful
series folder still has exactly the System name. The series identity, not the
folder name, remains authoritative.

## UI Behavior

The Game Design System project panel continues to start and report durable GDD
generation jobs. Completion links to the reused primary GDD Document.

No new version-history UI is introduced. Existing Document and Table version
modules display generated history entries automatically. A completion summary
reports counts for created, updated, reused, and preserved omitted resources.

## Failure Handling

- Duplicate logical keys or invalid generated payloads fail before mutation.
- A missing series-owned resource is recreated only when its logical key is in
  the current generated output; otherwise it is reported as missing.
- Collaboration or Table write conflicts are retryable and never overwrite the
  newer state.
- A failed transaction leaves the prior series revision and every resource
  unchanged.
- Dialogue generation runs only for dialogue sources created or changed in the
  successful GDD revision. Reused and omitted dialogue sources do not enqueue
  duplicate work.

## Testing

Database and service tests cover:

- first generation creates one System-named folder and revision 1;
- repeated generation reuses folder and resource IDs;
- changed GDD, Table, dialogue source, and Script Table create correct history
  snapshots before in-place updates;
- unchanged resources create no duplicate history;
- omitted resources remain present and unmodified;
- new logical keys create resources in the fixed folder;
- duplicate keys, stale collaboration state, and concurrent generation fail
  atomically;
- a retried job does not add versions or increment the revision twice;
- legacy dated output bootstraps without deleting older folders;
- generated history is visible and restorable through existing version UIs.

Targeted component and end-to-end coverage verifies the completion summary,
fixed folder name, stable navigation links, and right-side version history.

## Out Of Scope

- Automatically deleting or archiving resources omitted from a generation.
- Deleting older dated GDD folders during migration.
- A global project-wide restore that rolls every resource back together.
- Versioning ordinary project resources that are not owned by the GDD series.
