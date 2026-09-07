# Chunked Document Update Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan end-to-end. Optimize for implementation speed: do not use TDD and do not pause for review between tasks. Add the planned coverage while implementing, then run one unified verification and code review after all code is complete.

**Goal:** Make Yjs updates larger than 256 KiB autosave through a resumable 128 KiB transport that commits exactly once and remains invisible to collaborators until atomic finalization.

**Architecture:** Keep the existing append RPC for updates at or below 256 KiB. For larger updates, persist the full bytes in IndexedDB, upload immutable content-addressed chunks, then reconstruct and insert one ordinary `document_yjs_updates` row in a database transaction. Peers discover the completed update through the existing 15-second durable heartbeat.

**Tech Stack:** TypeScript 5.9, Yjs, Web Crypto, IndexedDB, Jest 30 with `fake-indexeddb`, Supabase/PostgreSQL PL/pgSQL, Playwright.

## Global Constraints

- Read `docs/superpowers/specs/2026-09-07-chunked-document-update-upload-design.md` completely before editing.
- Work only on branch `copy_bit_limit`.
- Preserve the existing append path for decoded updates of at most `262144` bytes.
- Use decoded chunks of at most `131072` bytes, a reconstructed maximum of `8388608` bytes, and no more than `64` chunks.
- Treat lowercase SHA-256, update ID, document ID, epoch, creator, byte count, and chunk count as immutable identity.
- Network requests may repeat; chunk storage, finalization, and Yjs application must be idempotent.
- Persist the full update locally before the first upload request. Delete it only after authoritative `committed` status.
- Expire only unfinished manifests after 24 hours. Retain committed manifest receipts until document deletion.
- Do not broadcast chunks or the finalized large update. Other users see it through durable heartbeat after commit.
- Do not change Import Document.
- Do not modify, remove, stage, or commit the existing `tmp/` directory or unrelated plugin metadata.
- Implement all tasks without intermediate review gates. Run the unified verification and review in Task 6 only.

## File Map

- Create `src/lib/documents/documentChunkedUpdate.ts`: limits, SHA-256, manifest identity, deterministic slicing, and index validation.
- Create `src/lib/documents/documentUpdateRecoveryStore.ts`: IndexedDB lifecycle behind an injectable interface.
- Create `tests/unit/documents/document-chunked-update.test.ts` and `tests/unit/documents/document-update-recovery-store.test.ts`.
- Modify `package.json` and `package-lock.json` to add `fake-indexeddb` as a dev dependency.
- Create `supabase/migrations/20260907120000_document_chunked_update_upload.sql`.
- Create static and live database tests for the migration.
- Modify `src/lib/documents/documentStateGateway.ts` and its unit test with typed RPC methods.
- Modify `src/lib/documents/documentCollaborationSession.ts` and its unit test for routing, resume, retries, and epoch handling.
- Modify `tests/e2e/specs/document-collaboration.spec.ts` for two-browser large-paste and reload acceptance.

---

### Task 1: Chunk and Local Recovery Primitives

**Files:**
- Create: `src/lib/documents/documentChunkedUpdate.ts`
- Create: `src/lib/documents/documentUpdateRecoveryStore.ts`
- Create: `tests/unit/documents/document-chunked-update.test.ts`
- Create: `tests/unit/documents/document-update-recovery-store.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Install the IndexedDB test implementation:

```bash
npm install --save-dev fake-indexeddb
```

- [ ] Implement `documentChunkedUpdate.ts` with these exports:

```ts
export const NORMAL_DOCUMENT_UPDATE_MAX_BYTES = 256 * 1024;
export const DOCUMENT_UPDATE_CHUNK_BYTES = 128 * 1024;
export const MAX_DOCUMENT_UPDATE_BYTES = 8 * 1024 * 1024;
export const MAX_DOCUMENT_UPDATE_CHUNKS = 64;

export type ChunkedDocumentUpdateIdentity = {
  updateId: string;
  documentId: string;
  userId: string;
  epoch: number;
};

export type ChunkedDocumentUpdateManifest = ChunkedDocumentUpdateIdentity & {
  totalBytes: number;
  chunkCount: number;
  sha256: string;
};

export async function sha256Hex(bytes: Uint8Array): Promise<string>;
export function sliceChunkedUpdate(bytes: Uint8Array): Uint8Array[];
export function validateChunkIndexes(indexes: unknown, chunkCount: number): number[];
export function missingChunkIndexes(receivedIndexes: unknown, chunkCount: number): number[];
export async function createChunkedUpdateManifest(
  identity: ChunkedDocumentUpdateIdentity,
  bytes: Uint8Array
): Promise<ChunkedDocumentUpdateManifest>;
```

`sha256Hex` must hash the exact view bytes with Web Crypto and emit lowercase 64-hex. Slicing returns copied views, rejects empty/over-8-MiB input, and enforces at most 64 chunks. Manifest creation additionally rejects input at or below the normal 256 KiB threshold and validates UUIDs and epoch. Index validation rejects duplicates, non-integers, and values outside `[0, chunkCount)`, then sorts.

- [ ] Implement `documentUpdateRecoveryStore.ts` with:

```ts
export type DocumentUpdateRecoveryRecord = ChunkedDocumentUpdateManifest & {
  bytes: Uint8Array;
  createdAt: string;
};

export interface DocumentUpdateRecoveryStore {
  put(record: DocumentUpdateRecoveryRecord): Promise<void>;
  listForDocument(userId: string, documentId: string): Promise<DocumentUpdateRecoveryRecord[]>;
  delete(key: string): Promise<void>;
}

export function recoveryRecordKey(
  record: Pick<DocumentUpdateRecoveryRecord, 'userId' | 'documentId' | 'epoch' | 'updateId'>
): string;

export class IndexedDbDocumentUpdateRecoveryStore
  implements DocumentUpdateRecoveryStore {
  constructor(factory?: IDBFactory | null);
}
```

Use database `keco-document-collaboration`, version `1`, object store `chunked-update-recovery` with `keyPath: 'key'`, and compound index `by-user-document` on `['userId', 'documentId']`. Clone byte arrays on write/read, sort records by `createdAt` then `updateId`, propagate request/transaction errors, and fail explicitly when IndexedDB is unavailable. Do not fall back to memory in production.

- [ ] Add unit coverage for exact `262145`, `270019`, and `8388608` boundaries; final chunk sizes; over-limit/empty data; the known SHA-256 of `new Uint8Array(262145)` (`b27a032984ea8a6bec700c3d6f63f8fcfbf8ff8ef87e972891feda4eea4aad0c`); invalid index sets; isolated record round-trip; stable ordering; deletion; and unavailable IndexedDB.

Do not pause for review or commit yet; continue to Task 2.

---

### Task 2: Atomic Database Protocol

**Files:**
- Create: `supabase/migrations/20260907120000_document_chunked_update_upload.sql`
- Create: `tests/unit/database/document-chunked-update-upload-migration.test.ts`
- Create: `tests/unit/database/document-chunked-update-upload.rls.behavior.test.ts`

- [ ] Create private storage tables:

`document_yjs_update_uploads` contains `id`, document cascade FK, epoch, immutable `created_by`, total bytes, chunk count, full SHA-256, status (`uploading|committed`), created/updated timestamps, and expiry. Its checks enforce `262145..8388608` bytes, `2..64` chunks, exactly `ceil(total_bytes / 131072)` chunks, lowercase 64-hex, and `expires_at IS NULL` exactly when committed.

`document_yjs_update_upload_chunks` contains `(upload_id, chunk_index)` primary key, cascade FK, decoded `bytea`, byte count, per-chunk SHA-256, and timestamp.

Enable RLS on both tables, create no authenticated policies, and revoke all direct privileges from `anon, authenticated`.

- [ ] Add an immutable identity validator plus these `SECURITY DEFINER SET search_path = ''` RPCs:

```sql
prepare_document_yjs_update_upload(
  p_upload_id uuid, p_document_id uuid, p_epoch bigint,
  p_total_bytes integer, p_chunk_count integer, p_sha256 text
) returns jsonb

put_document_yjs_update_chunk(
  p_upload_id uuid, p_document_id uuid, p_epoch bigint,
  p_total_bytes integer, p_chunk_count integer, p_sha256 text,
  p_chunk_index integer, p_chunk_base64 text, p_chunk_sha256 text
) returns jsonb

get_document_yjs_update_upload_status(
  p_upload_id uuid, p_document_id uuid, p_epoch bigint,
  p_total_bytes integer, p_chunk_count integer, p_sha256 text
) returns jsonb

finalize_document_yjs_update_upload(
  p_upload_id uuid, p_document_id uuid, p_epoch bigint,
  p_total_bytes integer, p_chunk_count integer, p_sha256 text
) returns jsonb
```

Every RPC derives `auth.uid()`, authorizes only owner/admin/editor against the document project, validates every immutable field and creator, and uses `42501`, `PT409`, and `22023` consistently with the current document functions.

Use exact response contracts:

```json
{"status":"uploading","receivedIndexes":[0,2]}
{"status":"ready","receivedIndexes":[0,1,2]}
{"status":"committed","receivedIndexes":[]}
{"receivedCount":2}
{"status":"uploading","missingIndexes":[1]}
{"status":"ready","missingIndexes":[]}
{"status":"committed","missingIndexes":[]}
{"status":"expired","missingIndexes":[0,1,2]}
```

The first three are prepare results, the fourth is put, and the final four are status results. Finalize returns `{"status":"committed"}`.

- [ ] Implement idempotent chunk writes. Validate canonical base64 before decode; normal chunks are exactly `131072` bytes, the final chunk is the computed remainder, and the request hash must match `extensions.digest(decoded, 'sha256')`. Equal `(upload_id, chunk_index)` bytes succeed; conflicting bytes/hash raise `22023`. Refresh unfinished expiry to 24 hours after successful prepare/put.

- [ ] Implement atomic finalize. Lock manifest and document rows, recheck permission/identity/current epoch, require every index exactly once, then reconstruct with:

```sql
decode(
  string_agg(pg_catalog.encode(chunk_data, 'hex'), '' order by chunk_index),
  'hex'
)
```

Verify total bytes and full SHA-256, insert one canonical base64 `document_yjs_updates` row using the manifest ID, reject any conflicting existing update, mark the manifest committed with `expires_at = null`, and delete its chunks in the same transaction. Repeated finalize returns committed. The committed manifest remains valid even after update-tail compaction.

- [ ] Add `cleanup_expired_document_yjs_update_uploads(p_limit integer default 100)` using a bounded `FOR UPDATE SKIP LOCKED` selection of expired `uploading` rows. Grant it only to `service_role`. Prepare/put may opportunistically remove a small bounded batch. Never delete committed receipts.

- [ ] Add a static migration test covering table constraints, RLS/revokes, security definer/search path, grants, size/hash validation, row locks, ordered reconstruction, atomic insert/commit/chunk deletion, and uploading-only cleanup.

- [ ] Add a live suite using `RLS_DB_TESTS_ENABLED` and `buildProjectFixture` covering:

- owner/admin/editor success, reordered chunks, and one canonical update row;
- viewer/outsider/anonymous denial and no direct authenticated table access;
- repeated prepare, identical chunk, finalize, and status idempotency;
- immutable identity collisions and conflicting duplicate chunk rejection;
- missing/wrong-size/noncanonical/hash-mismatched chunks and full-hash mismatch;
- stale epoch, over-8-MiB, and over-64-chunk rejection without an update row;
- expired unfinished cleanup;
- committed receipt survival after `compact_document_collab_state`;
- cascade deletion with the document.

Do not pause for review or commit yet; continue to Task 3.

---

### Task 3: Typed Gateway

**Files:**
- Modify: `src/lib/documents/documentStateGateway.ts`
- Modify: `tests/unit/documents/document-state-gateway.test.ts`

- [ ] Add strict result types:

```ts
export type PrepareDocumentYjsUpdateUploadResult = {
  status: 'uploading' | 'ready' | 'committed';
  receivedIndexes: number[];
};

export type PutDocumentYjsUpdateChunkResult = { receivedCount: number };

export type DocumentYjsUpdateUploadStatus = {
  status: 'uploading' | 'ready' | 'committed' | 'expired';
  missingIndexes: number[];
};

export type FinalizeDocumentYjsUpdateUploadResult = { status: 'committed' };
```

- [ ] Export `prepareDocumentYjsUpdateUpload`, `putDocumentYjsUpdateChunk`, `getDocumentYjsUpdateUploadStatus`, and `finalizeDocumentYjsUpdateUpload`. Each sends the exact snake-case parameters from Task 2, validates result shape/index bounds without unchecked casts, and reuses `throwMutationError` for `PT409`/`42501`.

- [ ] Add these methods to `documentStateGateway` and `DocumentCollaborationGateway`:

```ts
prepareUpdateUpload(client, manifest): Promise<PrepareDocumentYjsUpdateUploadResult>;
putUpdateChunk(client, input): Promise<PutDocumentYjsUpdateChunkResult>;
getUpdateUploadStatus(client, manifest): Promise<DocumentYjsUpdateUploadStatus>;
finalizeUpdateUpload(client, manifest): Promise<FinalizeDocumentYjsUpdateUploadResult>;
```

- [ ] Extend gateway unit coverage for exact RPC names/arguments, all valid response states, malformed response/index rejection, and conflict/read-only error mapping.

Do not pause for review or commit yet; continue to Task 4.

---

### Task 4: Active-Session Large Update Flow

**Files:**
- Modify: `src/lib/documents/documentCollaborationSession.ts`
- Modify: `tests/unit/documents/document-collaboration-session.test.ts`

- [ ] Extend `DocumentCollaborationSessionOptions` with injectable recovery store, upload concurrency (default `3`), retry attempts (default `5`), and a testable delay function. Production retries use capped exponential backoff with jitter; unit tests use immediate delay.

- [ ] Keep `materializePendingUpdate()` producing one stable pending ID/base64/byte array. In `persistPendingUpdates()`, retain the current append/broadcast behavior for `bytes.byteLength <= 262144`; route larger bytes to the new flow.

- [ ] For each large pending update:

1. create one stable manifest from pending ID plus document/user/current epoch;
2. store `{manifest, bytes, createdAt}` in IndexedDB before any network call;
3. prepare the server manifest;
4. upload only missing indexes, with at most three in flight;
5. after a missing/ambiguous put response, query status before resending anything;
6. finalize only after all chunks are present;
7. after an ambiguous finalize response, query status and finalize again only when status is still ready;
8. accept success only from finalize committed or authoritative status committed;
9. apply bytes to `durableDoc` once, add tail counters, clear only the same pending object, schedule compaction, then delete local recovery;
10. do not send a Realtime `yjs-update` for the large branch; continue the loop to persist later edits.

When status is expired, recreate the same immutable manifest and upload from IndexedDB. Permanent validation/auth failures and exhausted transient retries set degraded status and retain memory plus IndexedDB. `retry()`, reconnect, online, and focus recovery reuse the same update ID and upload flow.

- [ ] Extend the session harness with an in-memory recovery store and the four gateway methods. Add unit coverage for:

- 256 KiB stays on append; approximately 270019 bytes takes the chunk path;
- local store happens before prepare;
- only missing chunks upload and concurrency never exceeds three;
- no pending clear/durable application/compaction/local deletion before commit;
- committed update applies once, local recovery deletes afterward, and later edits drain next;
- large updates do not broadcast; small updates still do;
- lost put response followed by status does not resend the stored chunk;
- lost finalize response followed by committed status does not duplicate apply/insert;
- retry exhaustion retains recovery and later `retry()` resumes the same ID;
- IndexedDB failure sends no upload request and keeps navigation flush pending.

Do not pause for review or commit yet; continue to Task 5.

---

### Task 5: Reload Recovery and Epoch Fencing

**Files:**
- Modify: `src/lib/documents/documentCollaborationSession.ts`
- Modify: `tests/unit/documents/document-collaboration-session.test.ts`
- Modify: `tests/e2e/specs/document-collaboration.spec.ts`

- [ ] During `runInitialHydration`, after applying authoritative snapshot/tail but before installing writable listeners or transitioning to ready, list recovery records for the current user/document in stable order.

- [ ] For a same-epoch uploading/ready/expired record, apply its bytes to the active document with a non-local origin and resume Task 4's flow. For committed status, idempotently apply it to active and durable documents, track the update ID, then delete local recovery. This handles a read/finalize race without duplicate visible content.

- [ ] Implement epoch handling:

- same epoch: resume normally;
- current epoch is exactly old epoch + 1 with `epochReason === 'normalization'`: apply recovered bytes over current active state, derive a fresh update against current `durableDoc`, persist its new manifest before deleting the old record, then upload it;
- restore/agent epoch, skipped epoch, or otherwise incompatible lineage: retain the record, send nothing, fail closed with a recoverable conflict;
- an upload RPC `PT409` re-reads transport state and enters the same branch, never writes an old-epoch upload.

- [ ] Add unit coverage for startup ordering, same-epoch resume, committed-read race, multiple records, user/document isolation, refresh/destroy interruption, normalization rebase, and restore/agent conflict retention.

- [ ] Add a serial two-browser Playwright case that pastes a marker plus at least 90,000 Chinese characters, delays a middle chunk, and proves the peer sees none of the marker before finalize. After finalize and the existing heartbeat, both browsers must contain the exact content; isolated reload must retain it.

- [ ] In the same acceptance area, abort a middle chunk response and reload the owner. Assert IndexedDB preserves the task, the same upload ID is used, received indexes are not resent, finalization happens once, the peer sees content only after commit, and a second reload finds no matching local recovery record.

Do not pause for review. Continue directly to unified verification.

---

### Task 6: Unified Verification, Review, and Commits

- [ ] Apply/reset the local database and run the static plus live database coverage:

```bash
supabase db reset
npm run test:unit -- --runInBand \
  tests/unit/database/document-chunked-update-upload-migration.test.ts
RLS_DB_TESTS=1 npm run test:unit -- --runInBand \
  tests/unit/database/document-chunked-update-upload.rls.behavior.test.ts
```

The live suite must execute, not skip.

- [ ] Run focused client tests and browser acceptance:

```bash
npm run test:unit -- --runInBand \
  tests/unit/documents/document-chunked-update.test.ts \
  tests/unit/documents/document-update-recovery-store.test.ts \
  tests/unit/documents/document-state-gateway.test.ts \
  tests/unit/documents/document-collaboration-session.test.ts \
  tests/unit/documents/document-collaboration-wiring.test.ts \
  tests/unit/documents/document-collaboration-adapter.test.ts
npm run test:e2e -- tests/e2e/specs/document-collaboration.spec.ts --workers=1
```

- [ ] Run full regression verification:

```bash
npm run lint
npm run typecheck
npm run test:unit -- --runInBand
npm run build
git diff --check
```

- [ ] Perform one unified code review after all commands finish. Inspect the full branch diff and explicitly verify:

- one Yjs update is never split into independently applied updates;
- local persistence precedes network upload and deletion follows committed status;
- immutable identity checks include creator and survive update-tail compaction;
- duplicate chunks/finalize responses cannot duplicate storage or Yjs application;
- incomplete uploads are never visible and only unfinished uploads expire;
- epoch rebases preserve edits while restore/agent conflicts retain recovery data;
- small edits, Import Document, compaction, restore, and navigation flush still work;
- `tmp/` and plugin metadata are untouched.

Fix all review findings, then rerun every affected focused command. Rerun `lint`, `typecheck`, and `git diff --check` after the final fix.

- [ ] Commit in coherent implementation groups without staging `tmp/`:

```bash
git add package.json package-lock.json \
  src/lib/documents/documentChunkedUpdate.ts \
  src/lib/documents/documentUpdateRecoveryStore.ts \
  tests/unit/documents/document-chunked-update.test.ts \
  tests/unit/documents/document-update-recovery-store.test.ts
git commit -m "feat: add recoverable document update chunks"

git add supabase/migrations/20260907120000_document_chunked_update_upload.sql \
  tests/unit/database/document-chunked-update-upload-migration.test.ts \
  tests/unit/database/document-chunked-update-upload.rls.behavior.test.ts
git commit -m "feat: add atomic chunked document update RPCs"

git add src/lib/documents/documentStateGateway.ts \
  src/lib/documents/documentCollaborationSession.ts \
  tests/unit/documents/document-state-gateway.test.ts \
  tests/unit/documents/document-collaboration-session.test.ts
git commit -m "feat: autosave large document updates"

git add tests/e2e/specs/document-collaboration.spec.ts
git commit -m "test: verify resumable large document pastes"
```

- [ ] Report commit hashes, migration name, focused/live/E2E/full command results, unified review findings/fixes, and any environmental limitation. Do not claim completion from unit tests alone.
