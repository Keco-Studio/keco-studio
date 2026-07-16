# Document Review Remediation Design

## Goal

Make the `using-MDXEditor` branch mergeable after the July 15 adversarial
review. The repair covers all reported blockers, all major findings, and the
selected minor findings while preserving the existing MDX validation model,
Yjs collaboration protocol, confirmation transaction boundaries, and viewer
authorization model.

The implementation will not use test-driven sequencing at the user's request.
Regression tests remain required and will be added or updated alongside each
repair before the final verification pass.

## Scope

This repair includes:

- rebasing onto `origin/main` and resolving the performance-wave and
  English-only changes;
- renumbering all seven document migrations after main's latest migration;
- database, RLS, data-retention, and RPC payload hardening;
- import, export, URL, and authentication fixes;
- collaboration availability, validation, reconnect, heartbeat, and awareness
  fixes;
- agent result truncation, create confirmation, and confirmation diff fixes;
- removal of dead document save code and dependency cleanup;
- behavior coverage for anonymous RLS denial and the repaired edge cases; and
- documentation of the code-block last-writer-wins limitation.

This repair does not replace MDXEditor, replace Yjs, add a second realtime
transport, or broaden the sanctioned MDX component registry.

## Delivery Order

### 1. Rebase and baseline adoption

Rebase `using-MDXEditor` onto `origin/main` before functional edits. Preserve
the existing uncommitted `next-env.d.ts` change exactly across the rebase. The
conflict resolution will retain main's current implementations for shared
infrastructure and then reapply document-specific integration:

- use `withAuth` from `src/lib/auth/route-auth.ts` in document import and export
  routes;
- use the exported `fetchAllPaged` helper from
  `src/lib/services/pagination.ts`;
- retain main's consolidated sidebar folders channel and attach document
  invalidation to it instead of restoring the branch's older channel layout;
- retain main's current English-only source and documentation text; and
- remove `@fontsource/noto-sans-sc` and its runtime font loading.

All seven document migrations will be renamed in dependency order to
`20260716000000` through `20260716060000`. Tests and documentation that refer
to the old paths will be updated in the same change. No previously published
migration version will be edited in place after the rebase.

## Database and RLS Design

### Archived shared documents

`shared_documents_archive` is an internal retirement artifact. Its creation
migration will immediately enable RLS and revoke access from `anon` and
`authenticated`. It will have no client policies, so PostgREST reads and
writes deny by default while the database owner retains operational access.

### Collaboration RPC payload bounds

The database will enforce the same 256 KiB decoded per-update limit as
`documentCollaborationProtocol.ts`. `append_document_yjs_updates` will also
reject empty batches, batches over 100 entries, non-canonical base64 values,
and duplicate IDs within a batch before inserting any row.

Snapshot-writing RPCs will reject Markdown over 2 MiB UTF-8 and Yjs snapshots
over 8 MiB decoded. They will first enforce encoded-length ceilings before
base64 decoding, avoiding unbounded decode allocation. These checks apply to
initialization, compaction, restore, agent replacement, and import checkpoint
paths. Existing permission and compare-and-swap checks remain authoritative.

### Version retention and deletion

Automatic checkpoints are bounded per document. After a successful automatic
checkpoint insert, the same transaction deletes automatic checkpoints older
than the newest 100. Manual versions and audit versions (`pre_restore`,
`restore`, `pre_agent`, and `import`) are not pruned automatically.

Add a security-definer `delete_document_version` RPC for owners, admins, and
editors. It may delete only `manual` or `automatic` versions and must lock the
document before checking access. Audit versions remain immutable. The version
service and sidebar expose deletion with an explicit confirmation. A source
version referenced by an audit record remains protected by its foreign key and
returns a user-facing conflict instead of being silently detached.

### RLS behavior coverage

Database behavior tests will use the existing `anonClient()` helper to prove
anonymous denial for documents, collaboration updates, versions, and the
archive table. Migration text tests will cover archive RLS, grants, payload
bounds, retention, and deletion grants.

## State Gateway Design

### Complete update-tail reads

Every `document_yjs_updates` tail read will use `fetchAllPaged`, preserving the
current stable `created_at, id` ordering and current-epoch filter. The head is
read before and after all pages exactly as today; any head token change retries
the complete paged read. Compaction, version creation, restore, agent edit, and
import therefore receive the full update-ID set and cannot enter permanent CAS
conflict because of PostgREST's 1,000-row response cap.

### Lightweight reads

Split the gateway read into two explicit surfaces:

- `readDocumentState` returns the full authoritative state and materialized
  Markdown for routes, versions, imports, exports, and agent tools.
- `readDocumentTransportState` returns the snapshot, complete tail, and token
  without running headless Lexical Markdown materialization.

Heartbeat and durable catch-up paths use the transport read. They materialize
Markdown only when a caller actually consumes it or a compaction/replacement
transaction requires it. This removes the 15-second headless Lexical cost from
idle editors without weakening token checks.

## Import and Export Design

### Prefix-free image replacement

Imported images will use collision-resistant sentinel placeholders, for
example `keco-document-image:<uuid>`, rather than ordinal strings such as
`image-1`. Replacement operates on exact sentinel values, and import rejects a
missing, duplicate, or reused sentinel. An import with at least 11 images must
preserve the tenth and eleventh URLs exactly.

### Bounded image resolution

Export resolves at most 20 distinct images through a concurrency-limited pool
of two workers instead of `Promise.all`. Each response retains the current
byte, content-type, signature, dimension, and timeout checks. Sharp keeps its
input-pixel guard; removing it would expose decompression bombs. The worker
bound reduces worst-case simultaneous decoded-image memory from roughly 20
images to two while preserving the 480 by 360 output fit.

Both import and export routes declare `export const maxDuration = 60` and use
main's `withAuth` wrapper. Errors remain sanitized and do not expose storage or
database internals.

### Trusted image origins and paths

Production export accepts only HTTPS images from the configured Supabase
storage origin and the exact public `library-media-files` prefix. Loopback HTTP
is allowed only when the configured Supabase URL itself is loopback and the
runtime is not production. URL usernames, passwords, fragments, malformed
escapes, decoded dot segments, backslashes, and encoded path traversal are
rejected before fetch. Validation compares normalized decoded path segments,
not a raw `startsWith` string.

### Fresh export authentication

`DocumentEditor.handleExport` obtains the current session immediately before
the request and uses that access token. A missing or failed refresh produces
the existing sign-in error. No token is captured for the lifetime of the
component.

## Collaboration Session Design

### Durable append followed by failed broadcast

Persistence and live notification have different success semantics. Once the
append RPC succeeds, the local update is applied to `durableDoc`, removed from
the pending queue, counted toward compaction, and considered saved. A later
broadcast failure marks the channel unhealthy and schedules reconnect, but it
does not fail the persistence promise, enter an eternal dirty state, or trigger
the before-unload warning. Peers recover the update from durable catch-up.

Failures before a successful append remain fail-closed and keep the local
update pending.

### Validate peer updates before apply

For `yjs-update` and `yjs-sync-response`, decode the bounded payload and apply
it to a temporary Yjs document cloned from the active state. Run the existing
serialized sanctioned-MDX validation against that candidate. Only a valid
candidate update is applied to `doc` and, for durable update events,
`durableDoc`. Invalid peer updates are ignored and their update IDs are not
added to the applied-ID set.

This keeps one malformed peer from contaminating the shared local document and
blocking every later local flush. It does not weaken persist-time validation,
which remains defense in depth.

### Persistent reconnect

Automatic reconnect no longer stops permanently after five attempts. It uses
exponential backoff with jitter capped at 30 seconds and continues until the
session closes. `online`, window focus, and visibility restoration cancel any
long pending delay and request an immediate channel reconnect plus durable
catch-up. Successful subscription resets the failure counter. A single in-
flight promise and timer prevent concurrent reconnect loops.

### Awareness departure

During shutdown, encode and send the local awareness removal before setting
the closing flag that suppresses normal awareness broadcasts. The send is
best-effort and bounded; teardown never waits indefinitely for it. Peers remove
the cursor immediately when transport is available and still expire it by the
existing server timeout otherwise.

### Code-block collaboration contract

Document the current behavior: normal rich-text content uses character-level
Yjs collaboration, while code-block payloads are synchronized as atomic
last-writer-wins values. This is a declared limitation, not silently presented
as character-level CRDT behavior.

## Agent and Confirmation Design

### Structured `read_document` compaction

Extend `tool-result-for-llm.ts` with a `read_document` compactor. If the full
result exceeds the 16,000-character LLM budget, return valid JSON containing
document identity, token, a prefix of Markdown that fits the budget, total and
visible character counts, `truncated: true`, and an explicit `_llmNote`. The
note tells the model that full-document replacement is unsafe and that it must
ask the user to narrow the operation. Generic serialization must never slice
this result mid-JSON.

The full result remains persisted for the UI; only the model-facing copy is
compacted.

### Create confirmation

`create_document` remains a write tool with `pre_execute` confirmation and now
sets `confirmationRequired: true`. Conversation-level auto-execute behavior
continues to use the existing centralized policy; the tool itself no longer
bypasses confirmation by default.

### Replacement diff

The confirmation card displays a line-oriented diff for document replacement
instead of rendering the full proposed Markdown twice. Unchanged spans are
collapsed, additions and removals are visually distinct, and the raw proposed
content appears only once in an accessible expandable section. The confirmed
payload and hash remain unchanged.

## MDX Property Editing

Optional properties with an empty string are omitted from the validated
attribute map. Required properties still reject empty or whitespace-only
values. Optional enum properties do not run allowed-value validation when
omitted. The property editor and `validateAttributes` therefore accept the
same serialized state and cannot create a document that later wedges saves.

## Dead Code and Dependencies

Delete `useDocumentAutosave.ts`, `useDocumentStaleCopy.ts`, their dedicated
tests, and `updateDocumentContent` from `documentService.ts`. The collaborative
session remains the only document body write path. Wiring tests continue to
assert that these APIs are absent.

Move `@types/pdfkit` from `dependencies` to `devDependencies`. Remove
`@fontsource/noto-sans-sc` and use PDFKit's supported built-in fallback for the
English-only product surface. Package-lock changes are limited to these
dependency moves and rebase resolution.

## Error Handling

- Permission and CAS failures keep their current typed mappings.
- Invalid or oversized RPC payloads return validation errors without partial
  writes.
- Invalid peer updates are isolated to that event and do not degrade the
  session.
- Durable append failures remain blocking; post-append broadcast failures are
  recoverable transport failures.
- Image failures degrade that image to alt text and never fail the entire
  export unless document generation itself fails.
- Version deletion distinguishes permission denial, protected audit history,
  referenced versions, and stale/missing versions.
- Reconnect remains visible as degraded while retrying and returns to ready
  automatically after durable catch-up.

## Verification

Tests may be written after the corresponding implementation, per the user's
explicit request not to use TDD. The final verification must include:

- migration text tests and Supabase RLS behavior tests;
- import tests with 11 or more image placeholders;
- gateway tests with more than 1,000 update rows and unstable head retries;
- export tests for concurrency, loopback production denial, traversal, and
  bounded failures;
- collaboration tests for append-success/broadcast-failure, invalid peer
  isolation, continuing reconnect, focus/online reconnect, transport-only
  heartbeat reads, and awareness removal;
- agent compaction tests proving valid JSON and `_llmNote`, plus create
  confirmation coverage;
- UI tests for refreshed export tokens and non-duplicated replacement diff;
- MDX property validator parity tests;
- dead-code and dependency assertions;
- `npm run lint`, TypeScript checking, the full unit suite, `npm run build`,
  English-only CI, applicable Supabase behavior tests, and the document
  Playwright matrix.

Any database or end-to-end suite that cannot run locally because its external
service is unavailable will be reported explicitly rather than treated as a
pass.
