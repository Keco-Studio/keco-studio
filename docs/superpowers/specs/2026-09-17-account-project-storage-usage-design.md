# Account Project Storage Usage and Quota Design

**Date:** 2026-09-17
**Status:** Approved in chat; awaiting written-spec review

## Goal

Add file-storage accounting to `/account` so a signed-in user can see how much
of a 1 TB allowance is consumed by projects they own, inspect every physical
file and its size inside each accessible project, and separately inspect
projects shared with them. Enforce the project owner's allowance before every
new file upload, including uploads made by collaborators and generated asset
workflows.

This feature accounts for physical objects in Supabase Storage. Database rows,
document text, table values, version snapshots, embeddings, and other Postgres
storage are not included.

## Confirmed Product Rules

- The initial allowance is `1 TB = 1,024 GB = 1,099,511,627,776 bytes` per
  account owner.
- A project owns all of its files regardless of which member uploaded or
  generated them.
- Files in projects owned by the signed-in user count toward that user's
  allowance.
- Projects shared with the user remain visible, but their files count only
  toward the project owner's allowance.
- A collaborator upload is rejected when the project owner lacks enough free
  space. It never consumes the collaborator's personal allowance.
- `used + pending reservations + requested bytes` may equal the allowance but
  may not exceed it.
- At 80% usage the Account screen shows a warning. At 95% it shows a stronger
  warning. At 100% new uploads are blocked until space is released or the
  allowance is increased.
- The Account file browser is read-only. It can navigate to a file's source,
  but deletion continues to happen in the relevant project feature so business
  references are cleaned up safely.

## Existing Storage Context

Project files currently span several storage buckets and registries:

- `project-assets` for manually uploaded project media;
- `map-assets` for generated maps and reference images;
- `character-assets` for generated character assets;
- `library-media-files` for table media and document images.

The first three have project-aware paths or business rows. Existing
`library-media-files` paths use only the uploader UUID and filename, so their
project must be recovered from document and library references during
backfill. New library-media paths must include the project UUID.

`tiptap-images` is legacy storage and has no current application upload path.
Only objects that can be tied to a live project reference are imported into
project accounting. Other unmatched legacy objects follow the unassigned-file
policy below.

## Account User Experience

Add a `Storage` section after Credits and before email settings on `/account`.

The section begins with a stable summary containing used bytes, the 1 TB
allowance, remaining bytes, percentage used, and an accessible progress bar.
The summary covers owned projects plus unassigned legacy files; it never adds
shared-project usage.

Below the summary, use the approved two-pane explorer layout:

- The left pane contains `My projects` and `Shared with me` groups.
- Each project row shows its name, physical-file count, and total size.
- Owned projects sort by size descending by default.
- Shared projects also show their owner and are visually marked as excluded
  from the signed-in user's allowance.
- Selecting a project lazy-loads its files into the right pane.
- The right pane shows file name, type, size, upload time, source, and an
  `Open location` action.
- Users can search by file name and sort by name, size, or upload time.
- Files are paginated on the server; the browser does not preload every file.
- On small screens the panes stack: project selection first, file list second.

`Open location` is derived from the file's source kind and live source record.
It routes to the relevant Assets, map, character, document, or library view.
If the source has disappeared, the row remains visible with `Source no longer
exists` until reconciliation or cleanup resolves the orphan.

An `Unassigned legacy files` pseudo-group appears under `My projects` only when
the account has unmatched historical objects. It makes the account summary
reconcilable without inventing a project association.

## Recommended Architecture

Use one authoritative physical-file registry plus an account quota row and
atomic upload reservations. Do not calculate the screen by scanning Storage on
each request, and do not use delayed snapshots as the enforcement source.

```text
prepare upload
    |
    v
authorize project writer -> lock owner's quota -> reserve bytes
                                                |
                                                v
                                      upload physical object
                                                |
                         +----------------------+
                         | success              | failure/timeout
                         v                      v
                 verify actual object      release reservation
                         |
                         v
              register file + settle bytes
                         |
             +-----------+------------+
             |                        |
             v                        v
      Account summaries       Project file browser
```

All browser, MCP, server, and Edge Function upload paths use the same database
reservation contract. Storage bucket limits remain defense in depth, not the
account quota implementation.

## Data Model

### `account_storage_quotas`

One row per account owner:

- `owner_id uuid primary key` referencing the immutable Auth user identity;
- `quota_bytes bigint not null default 1099511627776`;
- `used_bytes bigint not null default 0`;
- `reserved_bytes bigint not null default 0`;
- timestamps and non-negative/check constraints.

`used_bytes` and `reserved_bytes` are transactionally maintained cached totals.
The physical-file registry and pending reservations remain independently
reconcilable, so a damaged cache is detectable and repairable.

### `project_storage_files`

One row per physical Storage object:

- immutable ID;
- `project_id`, nullable only for explicitly unassigned legacy files;
- `owner_id`, the account charged for the object;
- bucket ID and object path with a unique pair constraint;
- display filename, MIME type, and verified `size_bytes`;
- source kind and source entity ID;
- uploader/creator identity and creation timestamp;
- lifecycle state for active or pending-cleanup objects.

The project owner is copied onto the row at registration so account totals and
cleanup remain deterministic. The service verifies it against `projects` and
does not accept a browser-provided owner UUID.

A narrow location table may associate a physical object with multiple live
business references inside its canonical project. Multiple references do not
duplicate physical bytes. Cross-project reuse of an old public URL does not
charge the same object twice; the upload's canonical project owns the bytes.

### `storage_upload_reservations`

Each intended object receives its own reservation, including members of a
batch. A row records the owner, project, requester, bucket, intended path,
expected bytes, status, creation time, and expiry time. A batch preparation RPC
creates all item reservations in one quota-locked transaction.

Pending reservations alone contribute to `reserved_bytes`. Finalized,
released, and expired states are retained briefly for idempotency and
diagnostics, then pruned.

## Atomic Upload Lifecycle

### Prepare

The prepare operation:

1. derives the caller from `auth.uid()` or a trusted service identity;
2. verifies owner/admin/editor access to the requested project;
3. resolves the project's current owner;
4. locks that owner's quota row;
5. validates file-family and per-file size limits;
6. rejects the request when the allowance would be exceeded;
7. creates item reservations and increments `reserved_bytes` atomically;
8. returns signed upload targets only after the reservation commits.

Viewer and pending-collaborator requests fail before quota details are read.

### Upload and Finalize

Finalize verifies the reservation identity, intended bucket/path, and actual
Storage object metadata. It does not trust the browser's file size. Under the
same owner-row lock it:

- rejects and removes an object that violates its declared media contract;
- checks any positive actual-size delta against the remaining allowance;
- inserts the physical-file row;
- decreases reserved bytes and increases used bytes by the verified size;
- marks the reservation finalized;
- returns an idempotent success response for an exact replay.

If an upload fails, the caller explicitly releases its reservation. Expired
reservations are also released by a scheduled cleanup job. If an object arrives
after its reservation expires, finalize rejects it and schedules the object for
deletion rather than creating unaccounted storage.

Generated map and character outputs reserve the relevant file type's maximum
allowed size before provider generation or object persistence, then settle to
the real size. Batch manual uploads reserve all accepted items atomically but
finalize each item independently, so one invalid object does not register the
others incorrectly.

## Upload-Path Integration

The following paths must adopt the coordinator before quota enforcement is
enabled:

- browser project-asset preparation and completion;
- library media cells and document-image uploads;
- MCP project-asset and image upload tools;
- map reference uploads and generated map persistence;
- character generation persistence;
- any project import flow that writes a Storage object.

New `library-media-files` objects use a project-aware path such as
`{uploader_id}/{project_id}/{object_id}-{safe_name}`. The client upload helper
therefore receives the project ID instead of only the user ID. Updated bucket
policies validate project membership and the user-owned first path segment.

No upload entry point may create a signed target or write with `service_role`
before it owns a valid reservation. Rollout checks scan the codebase for direct
uploads to accounted buckets and maintain an explicit allowlist for the shared
coordinator itself.

## Deletion and Space Release

Feature-specific deletion removes or detaches business references first, then
uses the centralized storage cleanup service. Space is released only after the
physical object deletion is confirmed. Registry-row deletion and quota-counter
decrement occur in one database transaction and are idempotent.

Project deletion keeps its existing cleanup-outbox behavior. Accounted files
move to `pending_cleanup`; they remain charged until the worker confirms their
objects were deleted. A failed cleanup therefore cannot silently create free
quota while bytes still exist. Retries use bucket/path identity and never
double-decrement usage.

Replacing a file is treated as a new upload followed by deletion of the old
object. The new object must fit before the old object's bytes are released;
this conservative order avoids data loss.

## Existing-File Backfill

An idempotent service-role command inventories accounted buckets and joins
objects to the relevant business tables and JSON media references. Actual
Storage metadata supplies size; client-recorded sizes are comparison evidence,
not authority.

Attribution order is:

1. project UUID encoded in a validated storage path;
2. unique project association in a registry or live source reference;
3. deterministic canonical project when the same historical object has
   multiple references in one account;
4. uploader-owned `Unassigned legacy files` when no project is defensible.

The command upserts by bucket/path, reports conflicts without fabricating an
owner, recomputes account totals from inserted rows, and can be rerun safely.
Quota enforcement is enabled only after backfill and reconciliation complete.

## Reconciliation

A scheduled service-role job compares the physical registry with actual
Storage objects and checks:

- missing physical objects;
- registered-size mismatches;
- unexpected physical objects in accounted buckets;
- quota cached totals versus registry and pending-reservation sums;
- expired reservations and stale pending-cleanup rows.

Safe counter drift and expired reservations are repaired automatically.
Ambiguous ownership, unexpected objects, and size changes create operator
alerts and remain charged conservatively until resolved.

## Server APIs

Expose authenticated, private, no-store endpoints:

- `GET /api/account/storage` returns the caller's allowance summary, owned
  project rows, shared project rows, and an optional unassigned row.
- `GET /api/account/storage/projects/[projectId]/files` returns a validated,
  paginated file page with search and sort parameters.

The first endpoint derives the own-account summary from `auth.uid()` and never
accepts a user UUID. The project endpoint performs project membership checks
and exposes the owner's display identity only as already permitted by project
collaboration UI. It never reveals the owner's account-wide total or other
projects.

Upload endpoints return stable error codes including:

- `STORAGE_QUOTA_EXCEEDED`;
- `STORAGE_PROJECT_FORBIDDEN`;
- `STORAGE_RESERVATION_EXPIRED`;
- `STORAGE_OBJECT_MISMATCH`;
- `STORAGE_TEMPORARILY_UNAVAILABLE`.

The browser maps these codes to owner-specific or collaborator-safe messages.
It does not parse database error text.

## Failure States

- A first-load Account failure shows a retryable error, never zero usage.
- A refresh failure retains the last successful result and reports staleness.
- An upload failure releases its reservation and preserves enough item-level
  information for a safe retry.
- A collaborator sees `Project owner storage is full` without learning the
  owner's other usage details.
- The owner sees current used, requested, and remaining sizes plus actions to
  open Storage or Billing.
- If a source record vanishes before the object is cleaned up, the file remains
  charged and is labeled as an unavailable source.
- Quota or reconciliation service failures fail closed for new uploads; they do
  not issue untracked signed upload targets.

## Security

- Raw quota, reservation, and global file-registry tables are not selectable or
  writable by browser roles.
- Security-definer functions use an empty or explicit safe search path, derive
  identity internally, validate membership, and expose only narrow results.
- Service-role backfill and reconciliation endpoints are not public routes.
- File list access follows accepted project membership; pending invitations do
  not grant visibility.
- Account and project APIs validate every numeric value as a non-negative safe
  integer before returning it to TypeScript.
- Storage policies remain bucket- and path-scoped even though application
  authorization also runs before signed upload creation.

## Verification

Automated coverage includes:

- migration constraints, indexes, RLS, grants, and function permissions;
- exact-boundary, one-byte-over, owner, collaborator, viewer, and pending-member
  reservation behavior;
- concurrent reservations proving two individually valid requests cannot
  jointly exceed the allowance;
- finalize, replay, actual-size mismatch, expiry, release, deletion, and
  project-cleanup counter behavior;
- upload integration for project assets, library media, document images, MCP,
  maps, characters, and imports;
- account summary rules proving shared projects are visible but excluded from
  personal totals;
- project file pagination, search, sort, source routing, and access isolation;
- Account loading, success, warning, full, stale-refresh, empty, unassigned,
  and responsive two-pane states;
- end-to-end owner and collaborator uploads at and above the allowance;
- repeatable backfill and reconciliation fixtures containing duplicates,
  missing objects, multi-reference legacy files, and orphans.

Before enabling enforcement in production, run the backfill in report-only
mode, review ambiguous/unassigned totals, apply it, reconcile to zero unexplained
drift, and then enable the upload gate. Existing account, asset, collaboration,
MCP, map, character, typecheck, lint, and build suites must continue to pass.

## Out of Scope

- Charging for Postgres/database storage;
- direct deletion, rename, move, or bulk file management from `/account`;
- per-project quotas independent of the owner's account allowance;
- storage billing prices or an upgrade purchase flow beyond linking to the
  existing Billing surface;
- user-configurable warning thresholds;
- automatic ownership transfer between accounts.
