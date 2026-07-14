# In-App Documents Phase 2 Design

**Date:** 2026-07-14
**Status:** Approved design; implementation has not started
**Scope:** Phase 2 umbrella architecture, dependency order, shared interfaces, and acceptance gates
**Prerequisite:** `2026-07-14-document-phase1-completion-design.md` is implemented and remains the stable fallback baseline
**Supersedes:** Phase 2 guidance in `2026-07-13-document-yjs-collab-design.md`

## Original Product Goal

> Let users create and edit rich-text documents (notes, design docs, world-building
> lore, script drafts) directly inside a Keco Studio project, alongside libraries
> and folders — using MDXEditor (@mdxeditor/editor, MIT-licensed React Markdown
> WYSIWYG editor built on Lexical).
>
> Today the only document-related flows are one-way: design-upload parses a
> `.docx`/`.md` into an agent prompt, and script import converts text into tables.
> There is no way to author or keep a living document inside a project.

Phase 2 completes the product goal beyond core authoring: collaborators edit the
same document live, sanctioned MDX components are safe to use, uploaded design
documents become durable project documents, versions can be restored, Word/PDF
exports reflect current content, and the agent can operate on documents through
the caller's project permissions.

## Phase 1 Baseline

Phase 1 is complete on this branch and is the prerequisite for every Phase 2
subtask. The current production path is deliberately non-collaborative:

```text
MDXEditor Markdown
  -> 1500 ms autosave
  -> documents.content (authoritative, LWW guarded)
  -> project sidebar document-updated broadcast
```

The repository also contains an unused `documents.yjs_state` migration,
`DocumentYjsProvider`, and an MDXEditor/Lexical collaboration plugin. They are
spike artifacts, not a working collaboration feature. `DocumentEditor` does not
pass collaboration configuration to `MdxDocumentEditor`.

Phase 2 must preserve all Phase 1 CRUD, folder, image, link, lazy-loading, RLS,
viewer, and sidebar behavior. It may replace the body persistence path only after
the realtime gate in this document passes.

## Product Outcomes

1. Every open document is collaborative by default. Admins and editors can edit;
   viewers receive live content but remain read-only.
2. A document has one logical content authority. Phase 1 LWW autosave never runs
   beside Yjs persistence.
3. Disconnects do not silently fork a document. If the provider cannot establish
   or maintain a durable session, editing pauses in read-only mode and exposes a
   retry action.
4. Version restore, import, Agent edits, and live editing all use one document
   state mutation boundary and one concurrency token.
5. JSX is rendered only from a fixed component registry. Arbitrary JavaScript,
   raw component evaluation, and unsafe URLs are never executed.
6. Import, export, and Agent reads consume the latest logical Yjs state, not a
   potentially stale `content` snapshot.

## Non-Goals

- Mobile-specific editing UX.
- Moving documents across projects.
- Offline editing or IndexedDB persistence.
- A standalone `y-websocket` service.
- Arbitrary JSX, imports, exports, expressions, `eval`, raw event handlers, or a
  user-extensible component registry.
- Comments, suggestions/track-changes, or per-document ACLs.
- Replacing the existing project invitation and role model.
- PDF import as a Phase 2 release gate; it remains a best-effort stretch item.

## Decisions

### Collaboration transport and durability

Supabase Realtime private Broadcast channels are the low-latency Yjs transport.
Postgres is the durable transport tail and snapshot store. A dedicated websocket
service is not introduced.

Broadcast alone is not durable, and letting clients overwrite a whole
`yjs_state` snapshot races under concurrent editing. Therefore logical document
state is:

```text
documents.yjs_state at documents.collab_epoch
  + ordered/deduplicated document_yjs_updates for the same epoch
  = current authoritative Yjs document

documents.content = derived Markdown/MDX snapshot for search, previews, and
                    compatibility; never the collaborative write authority
```

The update tail is periodically merged into `yjs_state` by a transactionally
guarded compaction operation. This keeps one CRDT authority without trusting an
ephemeral channel or using `updated_at` as conflict resolution.

### Editor binding gate

Realtime ships only with a stable node-level `@lexical/yjs` binding to the
MDXEditor root editor. A focused adapter or small pinned fork is allowed when the
public packages are insufficient. Whole-document Markdown in `Y.Text` is not an
acceptable fallback because it cannot preserve WYSIWYG node identity, structural
merges, selection mapping, IME composition, or reliable presence cursors.

The binding spike must pass Chinese IME, headings, lists, quotes, links, images,
tables, code blocks, Undo/Redo, concurrent structural edits, and cursor mapping.
Exceptions must fail the collaboration session closed; production code must not
swallow reconciliation errors and continue persisting possibly corrupted state.

### Permissions

Documents inherit the containing project's membership and role. There is no
second document invitation or permission system.

| Project role | Read durable state | Receive live updates | Send awareness | Edit/send updates | Persist/compact/restore |
|---|---:|---:|---:|---:|---:|
| owner/admin/editor | Yes | Yes | Yes | Yes | Yes |
| viewer | Yes | Yes | No | No | No |
| non-member | No | No | No | No | No |

Viewers do not broadcast awareness because Supabase Realtime authorization must
prevent them from injecting an edit event that another editor could persist.
They can see editors' cursors and presence.

### Failure behavior

There is no Markdown LWW fallback after collaboration is enabled. Before initial
sync, after an authorization failure, or while local updates cannot be persisted,
the editor is read-only. Pending in-memory edits are retained while retrying.
In-app navigation awaits the existing document flush boundary and is blocked if
the pending update tail is not durable. A tab close with unsaved updates triggers
the browser's unsaved-change warning.

### Safe rollout

Development may use an internal release flag, but the shipped product has no
per-document collaboration toggle. The flag is enabled by default only after the
realtime sub-spec's complete test matrix passes. Phase 1 remains the pre-release
code path, not a runtime fallback after a collaborative session starts.

## Delivery Order

Each row is a separate spec -> plan -> implementation -> review cycle. A later
row does not begin until its dependencies are merged and green.

| Order | Subtask | Depends on | Why this order |
|---|---|---|---|
| 2A | Realtime co-editing and presence | Phase 1 | Establishes the authoritative state, codec, mutation token, and reset protocol used by all later writers. |
| 2B | Document version history | 2A | Adds the rollback safety net and transactional state replacement required before automated edits. |
| 2C | Sanctioned full MDX | 2A, 2B | Extends the content schema only after state and rollback are stable. |
| 2D | Unified import and design-upload -> document | 2C | Conversion must target the final sanctioned Markdown/MDX schema. |
| 2E | Word/PDF export | 2C, 2D | Reuses the normalized AST and image pipeline created for import. |
| 2F | Agent document tools | 2B, 2C | Uses version backup, validated MDX, concurrency tokens, and the existing confirmation flow. |

PDF import may be explored after 2E and is not a dependency of 2F.

## Shared Architecture

### 1. Document state boundary

Introduce one isomorphic module owned by the document domain. Names may be
adjusted to repository conventions, but the responsibilities and call graph are
fixed:

```ts
type DocumentStateToken = {
  epoch: number;
  revision: number;
};

type AuthoritativeDocumentState = {
  documentId: string;
  projectId: string;
  mode: 'legacy' | 'collaborative';
  markdown: string;
  yjsStateBase64: string | null;
  token: DocumentStateToken;
  updatedAt: string;
};

type ReplaceDocumentStateInput = {
  documentId: string;
  expected: DocumentStateToken;
  replacement:
    | { kind: 'markdown'; markdown: string }
    | { kind: 'version'; versionId: string };
  reason: 'restore' | 'agent';
};

type DurableYjsUpdate = {
  id: string;
  updateBase64: string;
};

type AppendUpdatesInput = {
  documentId: string;
  epoch: number;
  updates: DurableYjsUpdate[];
};

type CompactStateInput = {
  documentId: string;
  expected: DocumentStateToken;
};

interface DocumentStateGateway {
  read(client: SupabaseClient, documentId: string):
    Promise<AuthoritativeDocumentState>;
  initialize(client: SupabaseClient, documentId: string, markdown: string):
    Promise<AuthoritativeDocumentState>;
  appendUpdates(client: SupabaseClient, input: AppendUpdatesInput): Promise<void>;
  compact(client: SupabaseClient, input: CompactStateInput):
    Promise<AuthoritativeDocumentState>;
  replace(client: SupabaseClient, input: ReplaceDocumentStateInput):
    Promise<AuthoritativeDocumentState>;
}
```

Every method takes the caller's `SupabaseClient`; there is no `'use client'` and
no service-role client. Table access uses RLS; privileged transactional RPCs use
fixed-search-path functions with explicit caller/project-role checks. UI
permission checks are fast feedback only.

Phase 2A implements `read`, `initialize`, `appendUpdates`, and `compact`.
Phase 2B adds `replace` together with version storage so no unversioned
destructive replacement exists in production.

The Phase 2A contract migration also removes direct authenticated updates to
document body/state columns. Rename and same-project move keep their existing
metadata write paths, while all body mutations go through the gateway's guarded
operations. This makes the single-writer rule enforceable at the database
boundary rather than a UI convention.

`replace` is a transaction, not a sequence of client writes. It creates any
required pre-change version, updates `yjs_state` and `content`, clears the old
epoch's update tail, increments `collab_epoch`, advances `collab_revision`, and
returns the new token. Connected clients receive `document-state-reset` and
rehydrate a new `Y.Doc`; stale-epoch updates are rejected.

Callers provide semantic input, not independently generated Markdown and Yjs
payloads. The gateway uses the shared codec for initialization, compaction, and
Markdown replacement, or loads an exact version snapshot for restore. Its
package-private RPC adapter may accept encoded state, but components, API routes,
and Agent tools cannot bypass the consistency check.

### 2. Content codec

Realtime, versions, import/export, and Agent tools share a single codec:

```ts
interface DocumentContentCodec {
  validate(markdown: string): ValidatedDocumentAst;
  markdownToYjsState(markdown: string): Promise<string>;
  yjsStateToMarkdown(
    snapshotBase64: string | null,
    updateTailBase64: readonly string[]
  ): Promise<string>;
  mergeYjsState(
    snapshotBase64: string | null,
    updateTailBase64: readonly string[]
  ): string;
}
```

The codec must run in both browser and Node contexts. Its Lexical node registry,
Markdown visitors, and sanctioned JSX descriptors are defined once and imported
by MDXEditor and headless callers. A browser-only serializer would leave Agent,
export, and restore paths reading stale Markdown and is therefore a Phase 2A
blocker.

### 3. Concurrency token and resets

`collab_epoch` identifies a document state lineage. Normal Yjs updates stay in
one epoch. Destructive replacement creates a new epoch. `collab_revision`
increments on successful compaction or replacement and provides compare-and-set
protection for state-level operations.

All update, compact, restore, import replacement, and Agent edit payloads carry
the expected epoch. Compaction and replacement also carry expected revision.
Mismatches return a typed conflict; callers reload and either retry a commutative
operation or ask the user to re-confirm a destructive one.

### 4. Event boundaries

Three concerns use separate event paths:

- `doc-collab:{documentId}` private channel: Yjs sync/update and editor awareness.
- `document-state-reset` on that private channel: state was first initialized or
  epoch changed; discard the affected binding and rehydrate.
- existing project sidebar channel: low-frequency `document-updated` metadata
  events for create/rename/move/delete/compacted-save. Yjs traffic never rides
  the sidebar channel.

Event payloads are schema-versioned, runtime-validated, document-scoped, and
include epoch where relevant. Malformed or cross-document payloads are ignored
and reported without changing editor state.

Reset Broadcast is an acceleration signal, not the durable authority. Sessions
also compare the database state head on reconnect, window focus, relevant
sidebar events, and a low-frequency heartbeat so a reset committed immediately
before the sender disconnects is still observed.

### 5. Query and payload discipline

- Sidebar and version list queries exclude `content`, `yjs_state`, and snapshot
  payloads.
- The open editor loads state through `DocumentStateGateway.read`, not a sidebar
  record and not a bare `getDocument` content field.
- Export and Agent reads also use the gateway so update-tail changes are visible.
- React Query keys remain centralized in `queryKeys`.
- Large editor, codec, exporter, and importer dependencies are lazy-loaded from
  their feature entry points and do not enter the main dashboard bundle.

## Subtask Specifications

### Phase 2A: Realtime co-editing and presence

The detailed design is in
`2026-07-14-document-realtime-collaboration-design.md`.

It introduces private Supabase channels, a durable Yjs update tail,
transactional compaction, the node-level editor adapter, cursor awareness, a
read-only/retry connection state machine, and real two-client tests. It replaces
Phase 1 autosave only after its release gate passes.

### Phase 2B: Document version history

Add `document_versions` with document/project identity, version metadata,
`snapshot_yjs_state`, `snapshot_content`, epoch/revision metadata, creator, and
timestamps. Only `(document_id, created_at desc)` and necessary FK/uniqueness
indexes are allowed; snapshot payloads receive no index.

Version list queries select metadata only. Snapshot payloads load only for
preview or restore. The UI reuses the library version sidebar's interaction and
formatting components where their contracts are entity-neutral, but document
service logic and types stay separate from library snapshot logic.

Create versions at these meaningful boundaries:

- explicit user-created version;
- automatic checkpoint at most once per ten minutes when content changed;
- mandatory pre-restore backup;
- mandatory pre-Agent-edit backup;
- initial successful import checkpoint.

Restore runs through `DocumentStateGateway.replace` in one database transaction.
It inserts the pre-restore backup and restore audit record, switches epoch,
replaces both Yjs state and Markdown snapshot, clears the obsolete tail, and
broadcasts reset only after commit. Viewers can list and preview but cannot
create or restore versions.

Acceptance: transactional rollback on any failure, no partial restore, list
queries exclude payloads, connected editors rehydrate exactly once, old-epoch
updates cannot resurrect pre-restore content, and RLS isolation is behavior-tested.

### Phase 2C: Sanctioned full MDX

Enable MDXEditor's `jsxPlugin` with a fixed v1 registry:

- `Callout`: block component; `type` is `info | note | warning | success`, optional
  plain-text `title`, Markdown children.
- `Details`: block component; required plain-text `summary`, Markdown children.

The registry is intentionally small and additive. Unsupported components are
not executed. Imports/exports, JavaScript expressions, prop spreads, event
handlers, `style`, `className`, raw HTML, `javascript:`/`data:` links, and unknown
props are rejected by AST validation before persistence. Image `src` permits the
existing trusted Supabase media URLs and safe HTTPS URLs; link `href` permits
HTTPS and project-relative routes.

MDXEditor descriptors, read-only rendering, validation, headless codec, import,
export, and Agent tools consume the same registry module. There is no second
renderer and no runtime MDX evaluation.

Acceptance: sanctioned components round-trip through edit/save/reload/Yjs,
viewer rendering is inert, unsafe fixtures are rejected, unknown JSX never
executes, and the registry remains outside the main dashboard chunk.

### Phase 2D: Unified import and design-upload to document

Create a `documentImportService` with format adapters producing the validated
document AST/Markdown plus extracted images. Reuse the existing file validation,
Mammoth dependency, and document image upload service. Do not duplicate file
extension, size, or media URL rules.

- `.md`: preserve supported Markdown/MDX after validation.
- `.txt`: convert to paragraphs; retained because the current design-upload flow
  already accepts it.
- `.docx`: Mammoth HTML conversion, embedded-image extraction/upload, sanitized
  HTML-to-document-AST conversion, then codec serialization.

The sidebar gains an import action beside New document. The existing
design-upload flow creates a named project document first; it may then send the
new `documentId` to the Agent rather than embedding an untracked text copy in the
chat prompt. Failed conversion creates no document. Failed image cleanup is
best-effort and observable; a document is published only after content and image
references are ready.

Acceptance: Word headings/lists/tables/links/images round-trip where supported,
Markdown is not double-escaped, imported images render, the created document is
project/folder scoped, and cross-project or viewer import is rejected by RLS.

### Phase 2E: Word and PDF export

Export starts from `DocumentStateGateway.read`, validates through the shared AST,
and maps into a format-neutral export model. The Word and PDF renderers consume
that model so headings, inline emphasis, lists, quotes, links, tables, code,
images, `Callout`, and `Details` have one semantic mapping.

Recommended renderers are a server-lazy `docx` implementation for `.docx` and a
server-lazy React PDF renderer for `.pdf`; exact package versions are verified
for Next 16/React 19 before pinning. Export API routes create a caller-scoped
Supabase client from the request token, never a service-role client. Filenames
are sanitized and binary responses set explicit content type and disposition.

Remote images are fetched only from the trusted media allowlist with byte/time
limits to prevent SSRF and oversized exports. Unsupported sanctioned component
presentation degrades to its text content, never arbitrary HTML.

Acceptance: downloads open in Word/PDF viewers, current un-compacted edits are
included, viewer export is allowed, non-member export is denied, tables/images
are bounded correctly, and exporter packages do not enter browser bundles.

Best-effort PDF text import is a stretch after these gates and must be labeled as
lossy; it does not block Phase 2 completion.

### Phase 2F: Agent document tools

Add create/read/edit tools under `src/lib/agent/tools/` using the existing
data-access pattern. The tools receive the caller's RLS-scoped Supabase client;
they never create a service-role client and never accept a project role supplied
by the model.

- `create_document`: validate name/folder/content and create a new document; no
  confirmation because it is additive.
- `read_document`: read latest logical state through the gateway; no confirmation.
- `propose_document_edit`: produce a validated Markdown diff against an exact
  epoch/revision/content hash; it does not mutate.
- confirmed edit: re-read the token/hash, create a pre-edit version, apply through
  `replace`, and broadcast reset after commit.

Every edit to an existing document uses the existing `ConfirmationCard` and
`/api/agent-chat/confirm` flow. Replace-all, rename, move, restore, and delete are
always destructive. If the base token changed while confirmation was pending,
the edit is rejected as stale and must be regenerated and re-confirmed. Tool
results return IDs and revision metadata, not full snapshot payloads unless the
model explicitly requested a read.

Acceptance: RLS denies cross-project/non-member access, viewers cannot mutate,
confirmed edits create a restorable pre-edit version, stale confirmations do not
overwrite collaborator work, and tool schemas reject unknown or oversized input.

## Shared Error Model

Document services use typed errors that UI, API, and Agent layers translate at
their own boundary:

- `DocumentAccessError`: missing or hidden by RLS; do not reveal existence.
- `DocumentReadOnlyError`: authenticated viewer attempted a mutation.
- `DocumentStateConflictError`: epoch/revision/hash changed.
- `DocumentCollaborationUnavailableError`: private channel or durable tail is not ready.
- `DocumentContentValidationError`: Markdown/MDX is outside the sanctioned schema.
- `DocumentConversionError`: import/export conversion failed safely.

Services do not call Ant Design messages, return `Response`, or format Agent
cards. Components and routes do not duplicate authorization or state-merge logic.

## Verification Strategy

Every subtask must add focused unit and behavior tests before implementation,
then pass the repository gate:

```text
npm run lint
npm run typecheck
npm run typecheck:api
npm run test:unit
npm run build
```

Database features add `RLS_DB_TESTS` behavior coverage with at least owner,
editor, viewer, non-member, and cross-project cases. Realtime adds two independent
authenticated browser/client contexts against the real provider and private
channel policies. Import/export use fixture files and parse the generated output,
not only HTTP status assertions. Agent tools cover confirmation and stale-token
paths. English-comment and bundle/lazy-load guards remain green.

## Overall Phase 2 Acceptance

1. Two editors can concurrently edit all Phase 1 node types, including Chinese
   IME, while seeing stable remote cursors; a viewer follows live in read-only mode.
2. Refresh/reconnect restores the exact merged document, and a failed provider
   never enables a competing Markdown writer.
3. A prior version restores transactionally across connected clients and cannot
   be contaminated by stale pre-restore updates.
4. Only sanctioned JSX round-trips and renders; unsafe MDX never executes.
5. `.docx`/`.md` import creates a living project document, and Word/PDF exports
   contain the latest logical state.
6. Agent create/read/edit honors caller RLS; existing-document edits require
   confirmation and preserve a restorable version.
7. Cross-project isolation is behavior-tested for state, update tails, versions,
   import/export, Realtime subscription/send, and Agent tools.
8. `npm run validate` and the new Phase 2 Playwright suite are green, and the main
   dashboard bundle remains unchanged by lazy feature dependencies.

## Follow-Up Spec Rule

This umbrella spec fixes shared contracts and task order. Each subtask still
receives its own detailed design and implementation plan immediately before work
starts. A sub-spec may refine internal names but may not introduce a second data
authority, bypass the caller's RLS client, weaken the epoch/revision contract, or
start a later subtask before its dependencies pass.
