# Document Realtime Collaboration and Presence Design

**Date:** 2026-07-14
**Status:** Approved design; revised for Google Docs-style CRDT collaboration
**Phase:** 2A
**Depends on:** Completed Phase 1 authoring gate
**Parent:** `2026-07-14-document-phase2-design.md`
**Supersedes:** Collaboration architecture and fallback guidance in `2026-07-13-document-yjs-collab-design.md`

## Objective

Make every project document a live collaborative MDXEditor session. Project
owners/admins/editors co-edit the same Yjs document and see one another's
selection cursors. Viewers receive the same live state but cannot edit, send, or
persist changes. Supabase Realtime is the provider transport, Postgres makes Yjs
updates durable, and Markdown/MDX remains a derived interoperable snapshot.

This phase replaces Phase 1 Markdown LWW autosave only after all release gates
pass. It does not claim that the existing Project collaboration feature already
provides a reusable editor engine: Phase 2A reuses membership, roles, JWT/RLS,
Supabase clients, visual presence primitives, and sidebar infrastructure, while
building a document-specific Yjs provider and persistence protocol.

## Current Evidence

The repository has useful spike code but no enabled collaboration path:

- `DocumentYjsProvider` broadcasts whole updates on public
  `doc-collab:{documentId}` channels and does not implement durable update-tail
  persistence or private-channel authorization.
- `documentCollaborationPlugin` manually calls `@lexical/yjs` internals and
  catches reconciliation failures. Earlier runtime attempts produced invalid Yjs
  type access, duplicated Chinese IME intermediates, missing Lexical nodes, and
  empty Markdown saves.
- `MdxDocumentEditor` accepts optional collaboration props, but `DocumentEditor`
  never supplies them.
- `documents.yjs_state` exists, but current document reads and writes do not use
  it; `documents.content` is still authoritative.
- Existing library Yjs context is providerless/in-memory and is not reusable for
  document co-editing.

The spike files may be refactored or replaced. Keeping their names is not a goal.

## Invariants

1. A collaborative document has exactly one logical authority: Yjs snapshot plus
   durable update tail for the current epoch.
2. An update is broadcast to peers only after it is durable in Postgres.
3. A viewer can receive but cannot send Realtime messages or durable updates.
4. Initial content is editable only after private-channel authorization,
   durable-state hydration, editor binding, and peer sync complete.
5. Provider or persistence failure changes the editor to read-only; it never
   enables Phase 1 autosave.
6. Every destructive state replacement increments epoch. Old-epoch events and
   writes are rejected.
7. Reconciliation errors are fatal to the session and observable. They are not
   swallowed while persistence continues.
8. The document editor remains dynamically imported; Yjs/Lexical collaboration
   code does not enter the main dashboard bundle.
9. Normal concurrent edits never produce a stale-copy fork or ask the user to
   choose between "Reload remote" and "Keep mine". Yjs merges updates by CRDT
   identity and Lexical maps selections with relative positions.
10. Presence is part of normal editing: remote cursors, names, and a compact
    avatar stack are visible to editors and viewers.

## Considered Approaches

### Selected: Supabase Broadcast plus durable Postgres update tail

This preserves the existing infrastructure choice, gives low-latency peer
transport, survives missed Broadcast messages, and supports deterministic reload
and server-side readers. It requires a small journal and compaction RPC but keeps
the operational model inside Supabase.

### Rejected: Broadcast plus client LWW snapshot overwrite

Two clients can persist snapshots that observed different subsets of updates.
The last database update may discard a valid concurrent change even though Yjs
itself could merge it. `updated_at` or a leader election does not close every
disconnect and race window.

### Rejected for this product: dedicated y-websocket

A mature provider would reduce custom transport work, but it adds a stateful
service, deployment, monitoring, scaling, and a separate authorization boundary.
The user-approved direction is Supabase-native unless the mandatory spike proves
the selected approach impossible.

## Data Model

### `documents` collaboration columns

Keep the existing nullable `yjs_state text` column and add:

```sql
collab_epoch bigint not null default 0
collab_revision bigint not null default 0
```

- `yjs_state` is a base64 `Y.encodeStateAsUpdate` compacted snapshot.
- `collab_epoch` identifies a state lineage. Existing/initial content starts at
  epoch `0`; only destructive whole-state replacement increments it.
- `collab_revision` increments on successful initialization, compaction, or
  replacement and is the compare-and-set token.
- `content` is the Markdown/MDX produced from the same logical Yjs state at the
  most recent compaction/replacement.
- `updated_at` records durable content activity; it is not conflict resolution.

No index is added to `yjs_state` or `content`.

### `document_yjs_updates`

```sql
create table public.document_yjs_updates (
  id uuid primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  epoch bigint not null,
  update_data text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (length(update_data) > 0)
);

create index document_yjs_updates_document_epoch_created_idx
  on public.document_yjs_updates(document_id, epoch, created_at, id);
```

The primary key deduplicates retries. The composite index supports open and
compaction scans. There are no payload, creator, or standalone timestamp indexes.

Rows are immutable to application clients. Accepted project collaborators may
select rows. Only owners/admins/editors may insert rows for the document's
current epoch. Deletion occurs only inside the compaction/replacement database
function after its authorization and compare-and-set checks pass.

RLS follows the existing `is_project_owner` / accepted collaborator pattern,
wraps `auth.uid()` in `(select auth.uid())`, and uses correlated `EXISTS`
subqueries. Behavior tests, not static SQL matching alone, prove the policies.

### Authority enforcement

Enabling collaboration also closes the old direct body-write surface. The
contract migration revokes generic authenticated `UPDATE` access to document
state columns (`content`, `yjs_state`, `collab_epoch`, and `collab_revision`) and
grants only the metadata columns needed by existing rename/move operations.
Initialization, compaction, and later replacement are the only functions allowed
to change state columns. New-row creation cannot supply collaboration columns;
they take database defaults. The existing `createDocument` service signature is
preserved, while insert column grants and RLS require `created_by = (select
auth.uid())` and prevent callers from setting collaboration state directly.

`updateDocumentContent` is removed from the enabled collaboration runtime. The
contract migration and default-on provider are released together, after the
expand-only schema/provider build has passed its gate, so there is no deployed
window in which both the LWW body writer and collaborative state writer are
authorized.

### Migration and Phase 1 rows

Existing rows have `yjs_state is null`, epoch `0`, revision `0`, and authoritative
Phase 1 `content`. The first editor initializes Yjs state from that Markdown
through a compare-and-set RPC. Only one concurrent initializer wins. Losing
clients discard their candidate and reload the committed state.

The migration does not eagerly rewrite documents and does not add `documents` to
the `supabase_realtime` publication.

## Database Operations

Append is `security invoker`. Initialization, compaction, and later whole-state
replacement write protected state columns or delete immutable tail rows, so they
are narrowly scoped `security definer` functions. Those functions are owned by
the migration role, revoke default/public execution, grant execution only to
`authenticated`, fix `search_path`, resolve `(select auth.uid())` internally,
and perform explicit correlated project-role checks before touching data. They
do not require or expose a service-role client. Every function validates
document and epoch identity and never accepts a caller-supplied user id.

### Initialize

```ts
initializeDocumentCollabState(client, {
  documentId,
  expectedEpoch: 0,
  expectedRevision: 0,
  yjsStateBase64,
  markdown,
}): Promise<DocumentStateHead>
```

This is the package-private RPC adapter used by `DocumentStateGateway.initialize`;
components do not construct encoded Yjs state. The gateway validates Markdown
and uses the shared codec first. The RPC locks the document, requires nullable
state/revision zero, writes the initial state and derived Markdown in one
transaction, increments revision, and returns the committed head. Epoch remains
`0`. After commit, the initializing editor emits `document-state-reset` with
reason `initialize` so legacy viewers switch to the authoritative session. A
conflict instructs the caller to read the winner.

### Append durable updates

```ts
appendDocumentYjsUpdates(client, {
  documentId,
  epoch,
  updates: Array<{ id: string; updateBase64: string }>;
}): Promise<{ acceptedIds: string[] }>
```

The operation validates current epoch and write role, stamps `created_by` from
the authenticated caller, inserts with idempotent conflict handling, and returns
accepted/already-present ids. It rejects the entire batch when epoch changed.

### Compact

The application-facing call is deliberately narrow:

```ts
DocumentStateGateway.compact(client, {
  documentId,
  expected: { epoch, revision },
}): Promise<AuthoritativeDocumentState>
```

The gateway reads the current database snapshot and complete same-epoch tail,
then uses the shared codec to construct a consistent Yjs snapshot and Markdown.
Only its package-private RPC adapter accepts the encoded payload below:

```ts
compactDocumentCollabState(client, {
  documentId,
  expected: { epoch: number; revision: number };
  includedUpdateIds: string[];
  yjsStateBase64: string;
  markdown: string;
}): Promise<DocumentStateHead>
```

The gateway first reads the base and tail, merges with Yjs, and serializes the
same state to Markdown through the shared codec. The RPC then:

1. locks the document row;
2. verifies caller write role, epoch, and revision;
3. verifies every included update belongs to this document and epoch;
4. writes `yjs_state` and `content`, increments revision, and updates timestamp;
5. deletes only the included update rows;
6. commits and returns the new head.

Updates inserted after the compactor's read are not listed and remain in the
tail. Concurrent compactors use compare-and-set; a loser reloads and retries
after backoff. A client never deletes an update outside this transaction.

Because an authorized editor can already change the document, the RPC's security
boundary is role plus token. Keeping encoded arguments package-private prevents
ordinary consumers from accidentally pairing unrelated Markdown and Yjs state.
Codec round-trip tests and post-commit readback guard defects; a later server-side
compactor can reuse the same gateway contract.

## Private Realtime Authorization

Use a private channel per document:

```ts
supabase.channel(`doc-collab:${documentId}`, {
  config: {
    private: true,
    broadcast: { self: false },
    presence: { key: userId },
  },
});
```

Before subscribe, the Realtime client receives the current access token. A token
refresh updates Realtime auth without recreating the editor state.

Add narrowly-scoped `realtime.messages` policies backed by an exception-safe SQL
helper that extracts the UUID only from the exact
`doc-collab:<canonical-uuid>` topic shape and correlates it to `documents`:

- receive/select: project owner or accepted admin/editor/viewer;
- send/insert Broadcast and Presence: project owner or accepted admin/editor;
- non-members and pending collaborators: neither.

The helper fixes its `search_path`, does not expose arbitrary SQL, and returns
false for malformed topics. Policies use `(select auth.uid())` and correlated
`EXISTS`. Channel authorization is tested against local Supabase with distinct
JWTs before any editor test is accepted.

The existing project sidebar channel remains the home of low-frequency
`document-updated` metadata. It must receive equivalent project-scoped private
authorization if it does not already have it; Yjs update traffic is never moved
onto that shared channel.

## Wire Protocol

All payloads include `v: 1`, `documentId`, and `epoch`. Runtime validators reject
unknown versions, wrong documents/epochs, malformed base64, and oversized
payloads before applying anything.

| Event | Direction | Payload purpose |
|---|---|---|
| `yjs-update` | editor -> peers | Durable update id plus merged Yjs update bytes. Sent only after append succeeds. |
| `yjs-sync-request` | editor -> editors | Yjs state vector and requester id for differential catch-up. Viewers rely on durable hydration plus incoming editor updates because they cannot send. |
| `yjs-sync-response` | editor -> requester/peers | `Y.encodeStateAsUpdate(doc, remoteStateVector)` result. |
| `yjs-awareness` | editor -> peers | Yjs awareness update containing identity and relative selection. |
| `document-state-reset` | state writer -> peers | Authoritative state was initialized or replaced; carries reason and new head so affected clients fully rehydrate. |

Responses carry the requester id and are ignored by other clients. The database
snapshot plus tail is the source of truth for joining and
reconnecting. Peer sync only closes the short window around subscription and
improves latency; it cannot be the only source of state.

An editor flushes its pending append batch before answering a sync request. If
that flush fails, it sends no response and enters the normal degraded/error path;
peer sync must never leak an update that has not passed the append-before-
broadcast rule.

Local updates are merged over a 50-100 ms window into one durable journal row.
After the insert succeeds, that row is broadcast. This bounds database traffic
without making peers wait for the 1.5 second Phase 1 autosave delay.

## Provider Interface and State Machine

Keep transport, durable persistence, editor binding, and React rendering in
separate modules. The provider exposes a small stable surface; MDXEditor does not
reach into Supabase channels or database services.

```ts
type CollaborationStatus =
  | 'idle'
  | 'authorizing'
  | 'connecting'
  | 'hydrating'
  | 'syncing'
  | 'ready'
  | 'legacy-view'
  | 'degraded'
  | 'error'
  | 'closed';

interface DocumentCollaborationSession {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly status: CollaborationStatus;
  readonly token: DocumentStateToken;
  connect(): Promise<void>;
  flush(): Promise<void>;
  retry(): Promise<void>;
  subscribe(listener: (state: CollaborationViewState) => void): () => void;
  destroy(): Promise<void>;
}
```

Lifecycle:

1. Resolve document and project role using the existing permission hook/API.
2. Set Realtime auth, register validated handlers, and subscribe privately while
   buffering incoming events.
3. Read snapshot plus same-epoch tail through `DocumentStateGateway`.
4. For an uninitialized Phase 1 row, an editor builds state from Markdown and
   races the initialization RPC; it reloads if another editor won. A viewer
   renders the legacy Markdown read-only and waits for initialization instead of
   receiving permission to write the initial state.
5. Apply snapshot, tail, and buffered updates to a fresh `Y.Doc` exactly once.
6. Attach the tested Lexical adapter and perform differential peer sync.
7. Mark `ready`; enable content editing only for owner/admin/editor. A viewer's
   editor stays read-only throughout.
8. Batch each local Yjs update, append durably, then broadcast. Schedule
   compaction independently.
9. On reconnect, browser focus/online, and a 15-second active-session heartbeat,
   compare the durable head and tail ids. Apply a changed snapshot and any
   missing same-epoch rows idempotently so a silently missed Broadcast cannot
   leave the session forked.
10. On reset, enter `hydrating`, destroy the old binding/doc, load the new epoch,
   and return to `ready` without briefly enabling the old editor.
11. On unmount, flush pending durable updates, clear local awareness, unsubscribe,
    remove listeners, and destroy the Y.Doc.

`connect()` resolves successfully only at `ready`, or at `legacy-view` for a
viewer waiting on one-time initialization; channel `SUBSCRIBED` alone is not
synchronization. Timeout, authorization denial, malformed durable state, or
binding failure enters `error` and keeps the editor read-only.

`document-state-reset` is best-effort notification after the initialization or
replacement transaction commits. To close the commit-then-disconnect gap, the
session also reads the lightweight epoch/revision/state-presence head on
reconnect, window focus, relevant project sidebar events, and the catch-up
heartbeat. A head revision change loads and applies the compacted snapshot before
advancing the local token; tail-id comparison loads any missing rows even when
revision did not change.
A higher epoch always triggers the reset lifecycle. A higher revision in the same
epoch advances the known compacted head, except that a legacy viewer switches to
the authoritative Yjs session when state first becomes present.

## Persistence and Compaction Policy

- Merge and append local updates every 50-100 ms while typing.
- Compact after 2 seconds idle when the tail changed.
- Compact at least every 30 seconds during continuous editing.
- Compact when the tail reaches 100 rows or 1 MiB decoded size.
- `flush()` first persists pending batches, then attempts compaction when safe.
- A compaction failure does not lose an already-durable tail. It reports degraded
  snapshot health and retries with jittered exponential backoff.
- An append failure is more severe: freeze editing immediately, retain the
  unsent merged update in memory, and retry. Do not broadcast it first.
- After repeated authorization failure or token expiry, refresh auth once; if
  access is still denied, close the session and render the access error.

Successful compaction emits the existing project-scoped `document-updated`
`save` event so sidebar timestamps and non-editor metadata refresh. It does not
cause an already-collaborative editor to reload from `content`.

The Phase 1 stale-copy banner and `useDocumentAutosave` are not mounted in the
collaborative path. The existing flush registry is reused as the current
navigation boundary, but its handler delegates to `session.flush()`.

## Lexical/MDXEditor Binding Spike

Implementation starts with a disposable integration harness, not with wiring the
production editor. The selected adapter may wrap official `@lexical/yjs`
internals or carry a small pinned patch. It must own all unstable imports in one
module and expose a repository-owned interface.

The spike must demonstrate:

- a shared root Yjs type is attached before any read or observer;
- initial hydration happens once and outside nested `editor.update` calls;
- local Lexical updates map to Yjs without full-document replacement;
- remote updates reconcile without missing-node or `syncChildrenFromYjs` errors;
- IME intermediate composition is never committed, while the final Chinese text
  is committed exactly once;
- remote updates arriving during composition are queued and applied after the
  composition commit without duplication;
- headings, emphasis, underline, lists, quotes, links, images, tables, code
  blocks, and thematic breaks retain node identity and Markdown round-trip;
- Undo/Redo uses a local-origin Yjs `UndoManager`, undoing local operations without
  reverting a collaborator's operation;
- relative cursor positions survive adjacent insert/delete operations;
- binding cleanup removes observers, DOM overlays, awareness, timers, and channel
  listeners exactly once.

No `catch` block may convert a structural synchronization error into success.
Development logs include document id, epoch, direction, and error category but
never content, JWTs, or update bytes.

If the official binding cannot pass, the allowed next step is a controlled
adapter/fork with focused tests. Realtime remains disabled until it passes. A
Markdown `Y.Text` fallback and a silently degraded node subset are explicitly
forbidden.

## Presence and Cursor UX

Editor awareness state contains only:

```ts
{
  user: { id: string; name: string; color: string };
  focus: boolean;
  anchor: RelativePosition | null;
  focusPosition: RelativePosition | null;
}
```

Name comes from the existing project/user profile source. Color reuses the
existing deterministic avatar color utility when possible; one document-specific
wrapper may adapt it to Lexical's expected format. Email and role are not sent in
awareness payloads.

Remote selections render as a translucent range and a name label at the caret.
The label avoids covering toolbar/content and disappears after inactivity or
awareness removal. The local user is not rendered as a remote cursor. Viewers see
editor cursors but publish none.

The header shows connection state and current collaborators using existing
connection/presence visual primitives where their props are generic. It does not
reuse library cell-presence state or its field-specific event protocol.

The avatar stack is informational, not a conflict-resolution workflow. Ordinary
concurrent edits merge live, including overlapping ranges. Replacement prompts
are reserved for explicit restore/import/agent replacement or unrecoverable
provider/persistence failures.

## React and Module Boundaries

- `DocumentEditor`: document query, permissions, status/error composition.
- `useDocumentCollaborationSession`: owns session lifecycle for one
  `projectId/documentId/userId` request key.
- `DocumentCollaborationSession`: framework-free orchestration and state machine.
- `DocumentRealtimeTransport`: private channel, protocol validation, token refresh.
- `documentStateGateway`: snapshot/tail/RPC access with caller Supabase client.
- `documentContentCodec`: browser/Node Lexical/Yjs/Markdown conversion.
- `documentLexicalYjsAdapter`: the only owner of unstable binding APIs.
- `MdxDocumentEditor`: receives an already-ready adapter/session; no database or
  authorization calls.

Shared types live in one document collaboration types module. The provider and
editor do not each define near-identical collaboration config. Supabase event
strings and topic construction have one source. Base64 and payload validators are
shared between transport and persistence tests.

The current `documentYjsProvider.ts` and
`documentCollaborationPlugin.ts` are migrated into these boundaries or removed;
dead alternative paths are not retained.

## Error and Recovery UX

| State | Editor | User-visible behavior | Recovery |
|---|---|---|---|
| authorizing/connecting/hydrating/syncing | Read-only | Compact loading/connection status | Automatic timeout/retry transition |
| ready editor | Editable | Live/synced indicator and collaborators | Normal operation |
| ready viewer | Read-only | View-only and live indicator | Normal operation |
| legacy viewer | Read-only | View-only; waiting for live initialization | Switch automatically after an editor initializes |
| append failed/degraded | Immediately read-only | "Connection interrupted; your latest input is pending" | Retry unsent update, then resume |
| compaction failed but tail durable | Editable initially; freeze if threshold exceeded | "Saved for collaboration; snapshot delayed" | Backoff compaction; manual retry |
| authorization denied | Read-only | Access changed / cannot open | Refresh role once, then leave document |
| binding/state corruption | Read-only | Document could not sync; no content overwrite | Report, discard session, clean reload |
| epoch reset | Read-only during rehydrate | Restoring latest document state | Automatic fresh session |

Retry is idempotent. It never constructs a second active Y.Doc or channel for the
same mounted session. After five automatic attempts, automatic retry pauses and a
manual Retry button remains. Backoff is jittered and capped at 30 seconds.

## Security Limits

- Maximum decoded individual merged update: 256 KiB.
- Maximum append batch: 100 updates and 1 MiB decoded total.
- Larger local changes are split; oversized remote payloads are rejected and
  trigger durable reload rather than application.
- Snapshot/tail reads are document-scoped and paginated/bounded. Crossing the
  compaction threshold schedules immediate compaction.
- Presence is ephemeral and contains no document text.
- Runtime validators reject prototype-bearing/unknown payload fields.
- No content or Yjs bytes are logged.
- RLS is tested for receive and send separately; a viewer's inability to update
  `documents` is not considered sufficient Realtime protection.

## Test Strategy

### Unit

- Base64, schema validation, size limits, topic construction, update deduplication.
- Provider state transitions, retry, token refresh, single cleanup, and no double
  session on React Strict Mode remount.
- Buffer-before-hydrate race and differential sync.
- Durable catch-up after a Broadcast is dropped without a socket disconnect.
- Append-before-broadcast ordering.
- Compaction threshold, CAS conflict retry, and update-tail preservation.
- Codec Markdown <-> Yjs round trips for every Phase 1 node type.
- Lexical adapter two-editor merge, local-only Undo/Redo, cursor mapping, and IME
  composition fixtures.

### Database behavior (`RLS_DB_TESTS=1`)

- owner/admin/editor can read and append current-epoch updates.
- viewer can read snapshot/tail but cannot append, compact, or send Realtime.
- non-member and pending collaborator cannot read, subscribe, or send.
- cross-project document id/topic substitution is rejected.
- stale epoch append and stale revision compaction are rejected.
- direct authenticated updates to collaborative body/state columns are denied,
  while rename and same-project move remain allowed.
- compaction atomically updates snapshot/content/revision and deletes only listed
  rows; injected failure rolls everything back.
- malformed private topics return false without policy errors.

### Real provider integration

Use two independent authenticated clients and the actual
`DocumentCollaborationSession.connect()` path, not direct `Y.applyUpdate` calls:

1. simultaneous inserts at the same location converge;
2. offline/missed Broadcast catches up from durable tail;
3. reconnect does not duplicate content or cursors;
4. a third viewer follows live and cannot inject an update;
5. a non-member fails channel subscription;
6. concurrent compactors preserve all updates;
7. a legacy viewer switches exactly once after an editor wins initialization.

### Playwright

- two browser contexts edit headings, lists, table cells, links, image nodes, and
  code blocks; both converge after reload;
- Chinese IME input appears exactly once remotely;
- cursors and names track adjacent edits;
- viewer is read-only and live;
- simulated Realtime loss freezes editing and Retry recovers without losing the
  pending input;
- navigation waits for pending durable append;
- main dashboard route does not load the editor/collaboration chunk.

## Release Gate

Collaboration becomes the default document body path only when all conditions are
true:

1. The binding spike passes every required node, IME, Undo/Redo, and cursor test
   without swallowed synchronization errors.
2. Private `realtime.messages` behavior tests prove editor send, viewer receive
   only, and non-member denial.
3. Real two-client convergence, missed-message recovery, reconnect, compaction,
   and reload tests pass repeatedly.
4. `content` equals codec output from compacted logical Yjs state in test fixtures.
5. Phase 1 CRUD/sidebar/image/link/viewer tests remain green.
6. `npm run validate` and the new multi-context Playwright spec pass.
7. Bundle analysis proves the main dashboard chunk is unchanged.

If any gate fails, Phase 1 remains the released path and Phase 2A remains disabled.
There is no partial rollout with both writers active and no claim of completed
multiplayer editing.

## Handoff to Later Phase 2 Subtasks

Phase 2A must leave these stable, tested interfaces for later work:

- authoritative state read including uncompacted tail;
- browser/Node Markdown <-> Yjs codec;
- epoch/revision concurrency token;
- reset-ready session lifecycle and schema-versioned reset event contract;
- private project-role authorization for document channels;
- typed conflict, access, validation, and unavailable errors.

Version restore, MDX components, import/export, and Agent edits must use these
interfaces rather than writing `documents.content` or `documents.yjs_state`
directly.
