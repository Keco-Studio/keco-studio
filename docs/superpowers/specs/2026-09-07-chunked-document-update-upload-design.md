# Chunked Document Update Upload Design

**Date:** 2026-09-07

## Goal

Allow a large paste or other large editor mutation to save automatically when
its encoded Yjs update exceeds the existing 256 KiB per-update transport limit.
The upload may retry at the network layer, but the update must be committed to
the document at most once, must never become partially visible, and must resume
after a refresh without retransmitting chunks the server already holds.

## Current Failure

`DocumentCollaborationSession` batches local editor mutations and materializes
the difference between the active Yjs document and its durable copy as one Yjs
update. The normal append RPC rejects any decoded update larger than 262,144
bytes. A large paste therefore leaves the same update in `pendingDurable`, puts
the session into `degraded`, and causes every automatic or navigation flush to
fail indefinitely.

The failure is deterministic: 90,000 Chinese characters produce a 270,019-byte
Yjs update. Import Document succeeds with equivalent content because it writes
a complete snapshot through a separately bounded import path.

## Reliability Contract

The design does not promise that an HTTP request is never repeated. A response
can be lost after the server commits a request, so zero network retransmission
is impossible to guarantee. It instead provides these guarantees:

- every chunk position is stored at most once for an upload manifest;
- a repeated identical chunk succeeds idempotently, while conflicting bytes at
  the same position are rejected;
- finalization inserts the reconstructed Yjs update at most once;
- incomplete uploads never enter `document_yjs_updates` and are invisible to
  readers and collaborators;
- a client resumes by querying missing chunk indexes and sends only those
  indexes;
- a lost finalize response is resolved by querying status: the authoritative
  update row makes the task report `committed` without a second application;
- the browser keeps a local recovery copy until authoritative `committed`
  status is observed.

Completion is guaranteed while the application can eventually reconnect. If
the browser is closed before some chunks reach the server, the server cannot
invent the missing bytes; the locally persisted recovery copy resumes the task
when the same user next opens the document. A permanent loss of browser storage
before upload completion remains outside the guarantee.

The no-unnecessary-retransmission guarantee applies while the server still
holds an unexpired manifest. After its 24-hour expiry, the client uses the
local recovery copy to recreate the same manifest and must upload every chunk
again because none remains on the server.

## Limits

- Normal updates of at most 256 KiB continue to use the existing append RPC.
- Larger updates use 128 KiB decoded transport chunks.
- A reconstructed update is limited to 8 MiB, matching the existing maximum
  collaborative snapshot size.
- An upload has at most 64 chunks.
- An unfinished manifest expires 24 hours after its last accepted activity.
- Expired `uploading` rows are deleted opportunistically by upload RPCs and by
  a bounded cleanup function callable by service maintenance. Committed
  manifest rows are retained as idempotency receipts until their document is
  deleted.

These are decoded byte limits. Base64 length is validated separately before
decoding so malformed or unexpectedly large request bodies fail early.

## Durable Data Model

Add a private `document_yjs_update_uploads` manifest table containing:

- `id`: the final update UUID and stable idempotency key;
- `document_id`, `epoch`, and `created_by`: authorization and conflict fence;
- `total_bytes`, `chunk_count`, and `sha256`: immutable payload identity;
- `status`: `uploading` or `committed`;
- `created_at`, `updated_at`, and `expires_at`.

Add a private `document_yjs_update_upload_chunks` table containing:

- `upload_id` and zero-based `chunk_index` as the composite primary key;
- decoded `chunk_data` as `bytea`;
- `byte_count` and `sha256` for conflict detection;
- `created_at`.

Chunks cascade-delete with their manifest. Neither table permits direct
authenticated writes or reads. Security-definer RPCs perform project-scoped
authorization and expose only bounded status metadata, never chunk contents.

The committed manifest is the durable final idempotency receipt. It must remain
after normal document compaction deletes the corresponding
`document_yjs_updates` tail row, and it is deleted only by document cascade.
Before reporting `committed`, the RPC checks the manifest's document, epoch,
decoded byte count, and SHA-256 against the requested immutable identity; a
UUID match alone is insufficient. The existing `document_yjs_updates.id`
provides an additional fence while the update is still in the tail.

## RPC Contract

### Create or inspect

`prepare_document_yjs_update_upload` accepts the manifest identity. It locks or
creates the manifest and returns `uploading` plus the received indexes, or
`committed` if the final update already exists. Reusing an ID with a different
document, epoch, total size, chunk count, hash, or creator is rejected.

### Put chunk

`put_document_yjs_update_chunk` accepts the immutable manifest identity,
`chunk_index`, and one base64 chunk. It validates authorization, current epoch,
index bounds, decoded length, expected final-chunk length, and SHA-256.

An insert uses `(upload_id, chunk_index)` as its conflict key. Equal existing
bytes return success; different bytes return `22023`. The response includes the
received count but no payload data.

### Read status

`get_document_yjs_update_upload_status` returns one of:

- `uploading` with sorted missing indexes;
- `ready` when all chunks exist but finalization has not committed;
- `committed` when the immutable manifest is marked committed, including after
  document compaction has removed the corresponding tail row;
- `expired` when no resumable server manifest remains.

Status is authoritative for recovery after any lost response.

### Finalize

`finalize_document_yjs_update_upload` runs in one database transaction:

1. Lock the manifest and document rows.
2. Recheck actor authorization, manifest identity, and document epoch.
3. Require every index from zero through `chunk_count - 1` exactly once.
4. Concatenate decoded chunks in index order.
5. Verify total bytes and `extensions.digest(..., 'sha256')` against the
   manifest.
6. Canonically base64-encode the reconstructed bytes.
7. Insert one `document_yjs_updates` row using the manifest ID.
8. Mark the manifest committed as a durable receipt and delete its chunks.

If the final row already exists with the same document and epoch, finalize
returns `committed`. An ID collision with another state or payload is rejected.
Any validation or epoch failure rolls back the entire transaction, so no
partial update is observable.

## Client Flow

When `materializePendingUpdate` produces at most 256 KiB, the session keeps the
existing fast path. For a larger update it performs this sequence:

1. Generate the stable update ID and SHA-256.
2. Store the update bytes and immutable manifest in IndexedDB before the first
   upload request.
3. Prepare or inspect the server manifest.
4. Upload only indexes reported missing, with bounded parallelism.
5. Finalize and then query status if the response is missing or ambiguous.
6. Apply the update to `durableDoc`, clear `pendingDurable`, and schedule normal
   compaction only after authoritative `committed` status.
7. Delete the IndexedDB recovery entry only after that state transition.

Local edits made while a large update uploads remain in `localUpdates`. Once
the first update commits, the existing persistence loop materializes and saves
the later edits against the new durable state.

The recovery record is scoped by user ID, document ID, epoch, and update ID. On
document open, the same user checks each applicable record before accepting
new persistence work. If the server reports `committed`, the record is removed.
If it reports missing indexes, only those chunks are sent.
If the manifest expired but the final update does not exist, the client
recreates it with the same immutable identity and resumes from its IndexedDB
copy.

The existing unload guard and sidebar flush remain active until final commit.
Online/focus recovery invokes the same idempotent resume operation. Transient
failures use bounded exponential backoff; after the active retry budget is
exhausted the editor remains degraded and preserves both the in-memory and
IndexedDB copies.

## Epoch Conflicts

The manifest is fenced to the epoch in which its Yjs update was produced.
Finalization never writes it into a different epoch.

- A same-epoch concurrent append is safe because Yjs updates commute.
- A one-step normalization epoch change uses the session's existing pending
  update rebase behavior, then creates a new manifest for the rebased update.
- A restore or agent replacement conflict does not discard the IndexedDB
  record or claim success. The session surfaces a recoverable conflict and
  requires the authoritative replacement flow to resolve before a new update
  can be produced.

This preserves existing conflict semantics while preventing a long-running
upload from committing into a document state it was not created against.

## Collaborator Visibility

No chunk is broadcast over Realtime. Other sessions continue to read only the
authoritative snapshot and `document_yjs_updates` tail, so they cannot observe
an incomplete upload. After finalize commits, the existing 15-second durable
heartbeat discovers and applies the complete update. Immediate visibility is
not required, so this change does not add a second Realtime protocol event.

## Error Handling

- Invalid manifest or chunk input fails permanently and keeps the local
  recovery record for inspection rather than retrying endlessly.
- Network, timeout, and lost-response failures are ambiguous and trigger a
  status read before any resend.
- A hash or byte-count mismatch prevents finalization and records no durable
  update.
- Authentication or write permission loss freezes the editor and does not
  expose upload contents through status responses.
- IndexedDB unavailability is surfaced before starting a chunked upload; the
  editor retains the in-memory pending update and blocks navigation rather than
  claiming durable recovery.
- Cleanup deletes only expired `uploading` manifests and their chunks. It never
  deletes a committed manifest or any `document_yjs_updates` row.

## Verification

- Pure unit tests cover deterministic 128 KiB slicing, final-chunk sizing,
  SHA-256 identity, missing-index calculation, and IndexedDB record lifecycle.
- Session tests reproduce the current 270,019-byte failure and prove that it
  takes the chunked path, remains pending before finalize, commits once, drains
  later edits, and clears local recovery only after confirmed commit.
- Recovery tests drop chunk and finalize responses, recreate the session, and
  assert that only missing chunks are transmitted and no final update is
  duplicated.
- Database behavior tests cover authorization, immutable manifests, identical
  duplicate chunks, conflicting duplicate chunks, missing chunks, reordered
  arrival, hash mismatch, epoch conflict, repeated finalize, and expiry cleanup.
- A two-browser test pastes content larger than 256 KiB, verifies that the peer
  sees none of the partial upload, waits for finalize and heartbeat, then
  verifies exact content on both clients and after reload.
- Existing normal-size collaboration, compaction, import, restore, and document
  version tests remain green.

## Non-goals

- No byte-splitting of a Yjs update into independently applied Yjs updates.
- No immediate broadcast of large content or upload progress to collaborators.
- No change to Import Document or its limits.
- No guarantee of completion after permanent loss of all client-side recovery
  data before every chunk reaches the server.
- No general-purpose background job framework or service-worker uploader.
