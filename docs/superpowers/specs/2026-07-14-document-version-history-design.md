# Document Version History Design

**Date:** 2026-07-14
**Status:** Approved for implementation under the Phase 2 umbrella design
**Phase:** 2B
**Depends on:** Completed Phase 2A realtime collaboration release gate
**Parent:** `2026-07-14-document-phase2-design.md`

## Objective

Add durable, immutable document checkpoints that collaborators can inspect and
restore without creating a second document authority. Owners, admins, and
editors can create a named checkpoint and restore a prior version. Viewers can
list and preview history but cannot create or restore versions.

Version restore is a destructive state replacement. It therefore uses the
Phase 2A epoch/revision boundary, creates a mandatory backup, replaces both Yjs
and Markdown in one database transaction, and tells connected editors to
rehydrate only after the transaction commits.

## Invariants

1. Current document state remains `documents.yjs_state` plus the current-epoch
   durable update tail. A version is an immutable snapshot, never a live writer.
2. Every saved version contains matching Yjs and Markdown produced by the shared
   document codec from one exact logical state.
3. Version list queries never select `snapshot_yjs_state` or
   `snapshot_content`. Preview loads Markdown only. Restore loads both payloads
   inside the guarded database function.
4. A manual checkpoint is committed only if its supplied update IDs are exactly
   the document's current tail under the expected epoch/revision.
5. Restore creates its pre-restore backup, restore audit record, new document
   head, and tail cleanup in one transaction. Any failure rolls all of them back.
6. Restore increments the epoch and revision. Updates from the old epoch remain
   rejected and cannot resurrect pre-restore content.
7. A reset Broadcast is an acceleration signal sent after commit. Database
   state remains authoritative when the signal is duplicated or missed.
8. Version rows cannot be updated or deleted by application clients.

## Scope

Phase 2B implements these version boundaries:

- explicit user-created `manual` versions;
- `automatic` checkpoints created by compaction at most once per ten minutes
  when the derived Markdown changed;
- mandatory `pre_restore` backups;
- immutable `restore` audit records pointing at the selected source version.

The schema also accepts the parent design's later `pre_agent` and `import`
types so Phase 2F and Phase 2D can use the same immutable store without changing
the type contract. Phase 2B does not create either later type.

Editing version metadata, deleting versions, configurable retention, diffing,
branching, comments, and restoring only part of a document are out of scope.

## Considered Approaches

### Selected: immutable snapshots plus guarded transactional RPCs

Manual checkpoints and restores use fixed-search-path functions that lock the
document row, enforce project write roles, and verify the state token and exact
tail. Automatic checkpoints run inside the existing compaction transaction.
This keeps version payloads consistent with the Yjs authority and makes backup
plus restore atomic.

### Rejected: snapshot `documents.content` from the browser

`content` can lag the current Yjs tail. A client insert can also race another
collaborator's append. The resulting version may omit durable edits even though
the UI appeared current.

### Rejected: restore with sequential client writes

Creating a backup, updating the document, deleting the tail, and writing an
audit row through separate requests exposes partial states and cannot roll back
cleanly. It also allows old-epoch updates to race the replacement.

## Data Model

### `document_versions`

```sql
create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  project_id uuid not null,
  name text not null,
  version_type text not null,
  source_version_id uuid references public.document_versions(id),
  snapshot_yjs_state text not null,
  snapshot_content text not null,
  snapshot_epoch bigint not null,
  snapshot_revision bigint not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (document_id, project_id)
    references public.documents(id, project_id) on delete cascade
);
```

The migration adds the required unique constraint on
`documents (id, project_id)` for the composite foreign key. That constraint
prevents a denormalized `project_id` from disagreeing with the document.

`version_type` is constrained to `manual`, `automatic`, `pre_restore`,
`restore`, `pre_agent`, or `import`. `source_version_id` is required for
`restore` and null for all other types. The restore function additionally proves
that the source belongs to the same document.

`name` is trimmed, non-empty, and at most 120 characters. Manual names come from
the user. System rows use stable display labels:

- `Automatic checkpoint`
- `Before restore`
- `Restored: <source name>`, truncated to the column limit

Manual names do not need to be unique; the timestamp and creator disambiguate
them and avoiding a uniqueness constraint keeps retries and parallel editors
from turning display text into state coordination.

The only non-constraint index is:

```sql
create index document_versions_document_created_idx
  on public.document_versions (document_id, created_at desc, id desc);
```

Primary keys, the document composite key, and foreign-key support are the only
other allowed uniqueness/index structures. Snapshot payloads, names, creators,
types, epochs, and revisions receive no standalone indexes.

### Immutability and RLS

Authenticated project owners and accepted collaborators can select versions for
documents they can read. This includes viewers. RLS uses correlated `EXISTS`,
`(select auth.uid())`, and the existing owner/collaborator helpers.

Authenticated users receive `SELECT` only. Direct `INSERT`, `UPDATE`, and
`DELETE` are revoked. Creation and restore occur through narrowly-scoped
`security definer` functions that:

- set `search_path = ''`;
- derive the caller from `(select auth.uid())`;
- check owner or accepted admin/editor role against the locked document;
- never accept a caller-supplied user or project identity;
- revoke execution from `public` and grant it only to `authenticated`.

The table is not added to `supabase_realtime`. Version UI refreshes from the
existing project-scoped `document-updated` Broadcast and React Query invalidation.

## Database Operations

### Exact-tail helper

Manual creation and restore need a stronger check than compaction's subset
deletion. While holding the document row lock, the function reads all update IDs
for the current document and epoch ordered by `created_at, id` and compares the
array with the caller's ordered IDs. Missing, extra, duplicate, cross-document,
or cross-epoch IDs return `PT409`.

`append_document_yjs_updates` already locks the same document row before insert,
so no append can cross the exact-tail check and subsequent version/restore write.

### Manual checkpoint

The isomorphic version service reads the current authoritative state, merges the
snapshot and tail with the shared codec, and calls the package-private RPC:

```ts
createDocumentVersionRpc(client, {
  versionId: string;
  documentId: string;
  expected: DocumentStateToken;
  includedUpdateIds: string[];
  name: string;
  yjsStateBase64: string;
  markdown: string;
}): Promise<DocumentVersionSummary>;
```

The RPC locks the document, checks the write role and expected epoch/revision,
verifies the exact tail, and inserts one `manual` row. It does not mutate the
current document or its token.

`versionId` is generated once by the caller and is an idempotency key. Repeating
the same successful request returns the existing row only when document,
creator, type, and name match; reuse with different data is rejected. The
service may retry an exact-tail conflict with a fresh read while retaining the
same version ID, up to three attempts.

### Automatic checkpoint during compaction

`compact_document_collab_state` remains one transaction and retains its existing
CAS and subset-tail behavior. Before updating the document head, it inserts an
`automatic` version of the compacted `p_yjs_state` and `p_markdown` only when:

- `p_markdown` differs from the locked document's prior `content`; and
- no `automatic` version for that document was created in the previous ten
  minutes.

The snapshot epoch is the current epoch and the snapshot revision is the
post-compaction revision. A later update that was not in
`p_included_update_ids` remains in the tail and belongs to a later logical
moment. The document lock serializes the rate-limit decision.

Initialization does not create an automatic version. It is not a content change
within version history and import gets its own explicit checkpoint in Phase 2D.

### Transactional restore

The application-facing gateway contract is the parent design contract:

```ts
documentStateGateway.replace(client, {
  documentId: string;
  expected: DocumentStateToken;
  replacement: { kind: 'version'; versionId: string };
  reason: 'restore';
}): Promise<AuthoritativeDocumentState>;
```

Phase 2B rejects `kind: 'markdown'` and `reason: 'agent'`. Those paths become
available only with their later confirmation and validation work.

The gateway reads the current head and ordered tail, checks the expected token,
merges them to one Yjs snapshot, derives matching Markdown, and invokes the
package-private restore RPC with that pre-restore snapshot, exact tail IDs, and
caller-generated backup/audit UUIDs. The IDs make a partial-insert rollback
test deterministic; they do not let the caller provide version content or
identity. The target payload never travels through a component.

While holding the document row lock, the RPC performs these steps:

1. authorize the caller and verify expected epoch/revision;
2. verify the current supplied tail IDs are exact;
3. load the immutable target version and require the same document/project;
4. insert a `pre_restore` snapshot of the exact current logical state under the
   supplied backup UUID;
5. insert a `restore` audit snapshot under the supplied audit UUID using the
   target payload and source ID;
6. update `documents.yjs_state` and `documents.content` from the target, set
   epoch to `old_epoch + 1`, revision to `old_revision + 1`, and update time;
7. delete every tail row for the old epoch;
8. return the new state head plus the created backup and audit IDs.

The returned application state has an empty tail. Constraint errors, injected
test failures, stale tokens, stale tails, missing targets, and permission errors
abort the transaction with no partial version or document change.

## Isomorphic Service Contract

Create `src/lib/documents/documentVersionService.ts` without `'use client'`.
Every function receives the caller's `SupabaseClient`.

```ts
type DocumentVersionType =
  | 'manual'
  | 'automatic'
  | 'pre_restore'
  | 'restore'
  | 'pre_agent'
  | 'import';

type DocumentVersionSummary = {
  id: string;
  documentId: string;
  projectId: string;
  name: string;
  type: DocumentVersionType;
  sourceVersionId: string | null;
  snapshotToken: DocumentStateToken;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
};

type DocumentVersionPreview = DocumentVersionSummary & {
  markdown: string;
};

listDocumentVersions(client, documentId): Promise<DocumentVersionSummary[]>;
getDocumentVersionPreview(client, documentId, versionId):
  Promise<DocumentVersionPreview>;
createDocumentVersion(client, input): Promise<DocumentVersionSummary>;
```

The list query names every metadata column and excludes both snapshot columns.
Creator profiles are fetched separately with profile metadata only. Preview
selects `snapshot_content` for one document/version pair and never selects the
Yjs payload. Hidden/missing rows map to `DocumentAccessError`; mutation permission
errors map to `DocumentReadOnlyError`; `PT409` maps to
`DocumentStateConflictError`.

## Collaboration Session and Reset Lifecycle

`DocumentCollaborationGateway` gains `replace`. The session exposes:

```ts
restoreVersion(versionId: string): Promise<AuthoritativeDocumentState>;
```

For an editor, restore:

1. enters a read-only `syncing` state;
2. flushes pending durability without allowing a new local edit to cross the
   restore boundary;
3. calls `gateway.replace` with the session's current token;
4. after the RPC resolves, replaces its local `Y.Doc` once;
5. broadcasts `document-state-reset` with reason `restore` and the new token;
6. reports the durable state change through the existing project document
   callback and returns ready.

Viewers throw `DocumentReadOnlyError` before any gateway call. A conflict leaves
the editor read-only until it reloads the winner; it never retries a destructive
restore automatically.

Reset handling compares the full token. A reset at or below the session's
current epoch/revision is ignored. A newer epoch is loaded from the database and
causes exactly one `Y.Doc` replacement. Duplicate Broadcasts, the sender's local
application, focus refresh, and heartbeat therefore cannot rehydrate the same
committed epoch more than once. A missed Broadcast is still discovered by focus,
reconnect, sidebar notification, or heartbeat.

Old-epoch durable append calls return `PT409`; old-epoch Broadcast updates fail
runtime validation and are ignored. Pending local work is cleared only after the
new epoch has committed and been loaded.

## User Interface

The document header gains a stable 32 by 32 history icon button with an
accessible label and tooltip. It toggles an unframed right sidebar; it does not
navigate away from or unmount the live editor.

The sidebar contains:

- a compact heading and close icon;
- a `Create version` command for owner/admin/editor only;
- newest-first version rows showing name, type, creator, and local timestamp;
- a preview action available to every project role;
- a restore action for owner/admin/editor only.

System types use quiet labels rather than editable controls. Versions are
immutable, so the document UI does not reuse the library version edit/delete
menus. It may reuse entity-neutral spacing and date conventions, but its
components, service, types, and query key remain document-specific.

Creating a version uses a focused modal with a required 120-character name,
existing `validateName` rules, disabled duplicate submission, and inline errors.
The action first awaits `session.flush()`, then creates the exact checkpoint and
invalidates `queryKeys.documentVersions(documentId)`.

Preview opens a modal containing the existing dynamically-loaded MDX editor in
read-only mode with no toolbar. It displays `snapshot_content` and leaves the
live collaborative editor mounted behind the modal.

Restore always opens a confirmation modal stating that the current document
will be replaced and a backup is mandatory. There is no opt-out checkbox. While
restoring, controls are disabled. Success closes preview/confirmation,
invalidates version history, and lets the session reset update the editor.

The sidebar subscribes to the existing project `document-updated` listener and
invalidates matching history queries. `refetchOnWindowFocus` remains enabled.

## Error Handling

- `DocumentAccessError`: document/version is missing or hidden by RLS; UI does
  not reveal whether a cross-project ID exists.
- `DocumentReadOnlyError`: viewer attempted create/restore; UI remains unchanged.
- `DocumentStateConflictError`: token or exact tail changed. Manual creation may
  retry safely; restore asks the user to reopen the latest history and confirm
  again.
- Transport failure after a committed restore: local state is loaded from the
  RPC result, the session becomes degraded if reset Broadcast fails, and peers
  recover from durable polling/refresh.
- Preview failure: close or retain the modal with an inline retry; never replace
  the live editor state.

No service displays Ant Design messages or formats component copy.

## Testing Strategy

### Static migration tests

- schema, type/name checks, composite identity FK, and the single list index;
- no snapshot/name/type/creator indexes and no Realtime publication change;
- authenticated table grants are select-only;
- fixed-search-path RPC ownership, execution grants, role checks, CAS, exact
  tail comparison, automatic ten-minute guard, backup, audit, epoch advance, and
  old-tail deletion.

### Live database behavior tests

Using `RLS_DB_TESTS=1`:

- owner/admin/editor create and restore; viewer can list/preview but cannot
  create/restore; non-members see no rows;
- cross-project target IDs cannot be previewed or restored;
- list selection proves payload columns are absent from the returned shape;
- manual checkpoint rejects stale token and non-exact tail without inserting;
- automatic checkpoints occur only for changed content and no more than once in
  ten minutes;
- restore creates exact pre-restore and audit snapshots, increments token,
  clears the old tail, and rejects later old-epoch appends;
- an intentional audit-ID collision after the pre-restore insert leaves the
  document, tail, and version count unchanged.

### Unit and component tests

- metadata-only list and Markdown-only preview selections;
- codec merge and exact RPC payload for manual create and gateway replace;
- typed error mapping and viewer guards;
- session flush-before-restore, post-commit reset, duplicate reset deduplication,
  and missed-reset heartbeat recovery;
- history button/sidebar, role-gated commands, modal validation, preview
  read-only wiring, query invalidation, and mandatory backup copy.

### Playwright release gate

Two authenticated editor contexts and one viewer context open the same document.
The test creates a named version, makes newer concurrent edits, restores the
version, and proves:

- both editors rehydrate once to the restored content;
- the viewer follows live and remains read-only;
- pre-restore and restore audit rows appear in history;
- an intercepted old-epoch append cannot reintroduce the newer content;
- reload shows the restored Markdown;
- the viewer can preview but has no create or restore action.

Existing document collaboration and Phase 1 document Playwright specs remain
green.

## Acceptance Gate

Phase 2B is complete only when:

1. manual, automatic, pre-restore, and restore-audit snapshots contain matching
   Yjs/Markdown state;
2. list queries exclude snapshot payloads and preview loads Markdown only;
3. viewer and cross-project behavior is enforced by RLS and live tests;
4. restore is atomic, advances epoch/revision, and old updates cannot revive the
   replaced state;
5. connected editors rehydrate exactly once per new restore epoch and recover
   when Broadcast is missed;
6. the version UI supports create, list, preview, and mandatory-backup restore
   with role-correct controls;
7. targeted Jest, live RLS tests, the version-history Playwright gate, existing
   document Playwright gates, `git diff --check`, and `npm run validate` pass.
