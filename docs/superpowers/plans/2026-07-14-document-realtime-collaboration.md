# Document Realtime Collaboration and Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 1 Markdown LWW autosave with durable, private, Yjs-based document co-editing and editor presence for project collaborators.

**Architecture:** A document's authoritative state is a compacted Yjs snapshot plus an immutable, ordered update tail for one epoch. An isomorphic gateway owns initialization, append, read, and transactional compaction; a private Supabase Realtime session broadcasts only updates that Postgres has accepted. A focused Lexical adapter binds the MDXEditor root to the session and fails closed on reconciliation errors.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase Postgres/RLS/Realtime Broadcast, Yjs 13, `@lexical/yjs` 0.35, MDXEditor 4, Jest, Playwright.

## Global Constraints

- The detailed design is `docs/superpowers/specs/2026-07-14-document-realtime-collaboration-design.md`.
- Broadcast is low-latency transport only; Postgres snapshot plus update tail is authoritative.
- Persist before broadcast. Never overwrite a complete client-generated `yjs_state` outside guarded initialization/compaction.
- Viewers receive live state but cannot send Broadcast, Presence, updates, compaction, or initialization.
- Any provider, persistence, or Lexical reconciliation failure makes the editor read-only; Phase 1 autosave never resumes.
- Every payload is schema-versioned, document-scoped, epoch-scoped, runtime-validated, and size-limited.
- The editor and collaboration dependencies remain behind the existing `next/dynamic({ ssr: false })` boundary.
- Services remain isomorphic, accept a caller-scoped `SupabaseClient`, and never use a service-role client.
- Code and comments are English.

---

### Task 1: Collaboration schema, RPCs, and private-channel authorization

**Files:**
- Create: `supabase/migrations/20260716030000_document_realtime_collaboration.sql`
- Create: `tests/unit/database/document-realtime-collaboration-migration.test.ts`
- Create: `tests/unit/database/document-realtime-collaboration.rls.behavior.test.ts`

**Interfaces:**
- Produces columns `documents.collab_epoch`, `documents.collab_revision`.
- Produces immutable table `document_yjs_updates(id, document_id, epoch, update_data, created_by, created_at)`.
- Produces RPCs `initialize_document_collab_state` and `compact_document_collab_state`.
- Produces `document_id_from_collab_topic(text)` and `realtime.messages` select/insert policies.

- [x] **Step 1: Write static migration tests** asserting the exact columns, only `(document_id, epoch, created_at, id)` payload-tail index, no payload indexes, fixed `search_path`, row lock/CAS checks, included-row-only deletion, exact canonical topic parsing, private receive/send role split, and revocation of direct authenticated body-column updates.
- [x] **Step 2: Run the static test and verify RED** with `npm run test:unit -- --runInBand tests/unit/database/document-realtime-collaboration-migration.test.ts`; expect failure because the migration is missing.
- [x] **Step 3: Write live RLS behavior tests** for owner/admin/editor/viewer/non-member/cross-project read and write behavior, stale epoch rejection, idempotent update ids, viewer compaction rejection, and malformed/private topic authorization.
- [x] **Step 4: Add the migration**. Use `(select auth.uid())`, correlated membership checks, `security definer set search_path = ''`, `FOR UPDATE` document locks, and deterministic SQLSTATE values for epoch/revision conflicts. Revoke table-level authenticated `UPDATE`, then grant metadata-only `UPDATE(name, folder_id)`; body writes occur only in guarded functions.
- [x] **Step 5: Run static tests GREEN** with the command from Step 2.
- [x] **Step 6: Apply the migration and run live behavior tests when `RLS_DB_TESTS=1`** using the existing local Supabase harness; expect every role matrix case to pass.
- [x] **Step 7: Commit** with `git add supabase/migrations/20260716030000_document_realtime_collaboration.sql tests/unit/database/document-realtime-collaboration* && git commit -m "feat: add durable document collaboration schema"`.

### Task 2: Shared state types, errors, encoding, and wire validation

**Files:**
- Create: `src/lib/documents/documentStateTypes.ts`
- Create: `src/lib/documents/documentCollaborationProtocol.ts`
- Create: `tests/unit/documents/document-collaboration-protocol.test.ts`

**Interfaces:**
- Produces `DocumentStateToken`, `AuthoritativeDocumentState`, `DurableYjsUpdate`, `DocumentStateConflictError`, `DocumentCollaborationUnavailableError`.
- Produces `encodeBase64`, `decodeBase64`, `parseDocumentCollaborationEvent`, and typed v1 event payloads.

- [x] **Step 1: Write failing tests** for byte round-trips in Node and browser-compatible environments, malformed base64, wrong UUID/document/epoch/version, oversized update/state-vector/awareness payloads, and accepted event variants (`yjs-update`, `yjs-sync-request`, `yjs-sync-response`, `yjs-awareness`, `document-state-reset`).
- [x] **Step 2: Verify RED** with `npm run test:unit -- --runInBand tests/unit/documents/document-collaboration-protocol.test.ts`; expect missing-module failure.
- [x] **Step 3: Implement minimal shared types and Zod discriminated-union validators**. Base64 helpers use `Buffer` only when available and otherwise `btoa`/`atob`; validators reject unknown keys and cap encoded collaboration payloads at the design limits.
- [x] **Step 4: Verify GREEN** with the command from Step 2.
- [x] **Step 5: Commit** with `git add src/lib/documents/documentStateTypes.ts src/lib/documents/documentCollaborationProtocol.ts tests/unit/documents/document-collaboration-protocol.test.ts && git commit -m "feat: define document collaboration protocol"`.

### Task 3: Isomorphic Phase 1 Markdown to Lexical-Yjs codec

**Files:**
- Create: `src/lib/documents/documentContentCodec.ts`
- Create: `src/lib/documents/headlessDocumentNodes.ts`
- Create: `tests/unit/documents/document-content-codec.test.ts`

**Interfaces:**
- Produces `DocumentContentCodec.validate`, `markdownToYjsState`, `yjsStateToMarkdown`, and `mergeYjsState`.
- Uses the same Yjs root name and Lexical node types/properties as the browser adapter.

- [x] **Step 1: Write failing round-trip tests** for paragraphs, empty documents, headings, bold/italic/underline/inline-code, ordered/unordered/check lists, block quotes, links, images, thematic breaks, fenced code blocks, and GFM tables.
- [x] **Step 2: Add structural merge tests** proving two concurrent node-level updates merge without converting the whole document to `Y.Text`, and that snapshot plus an arbitrarily ordered deduplicated tail serializes deterministically.
- [x] **Step 3: Verify RED** with `npm run test:unit -- --runInBand tests/unit/documents/document-content-codec.test.ts`.
- [x] **Step 4: Implement the minimal headless codec** with a non-DOM Lexical editor and mirror node registrations for MDXEditor's custom image/table/code-block representation. Parse/serialize through a shared Phase 1 Markdown AST configuration; do not import `@mdxeditor/editor/style.css` or browser components.
- [x] **Step 5: Verify GREEN** with the command from Step 3 and add a Node entry-point smoke test so server consumers cannot accidentally depend on DOM globals.
- [x] **Step 6: Commit** with `git add src/lib/documents/documentContentCodec.ts src/lib/documents/headlessDocumentNodes.ts tests/unit/documents/document-content-codec.test.ts && git commit -m "feat: add isomorphic document content codec"`.

### Task 4: Authoritative document state gateway

**Files:**
- Create: `src/lib/documents/documentStateGateway.ts`
- Create: `tests/unit/documents/document-state-gateway.test.ts`
- Modify: `src/lib/services/documentService.ts`

**Interfaces:**
- Produces `readDocumentState`, `initializeDocumentState`, `appendDocumentYjsUpdates`, `compactDocumentState` and `documentStateGateway`.
- `readDocumentState(client, id)` returns snapshot, ordered tail, derived current Markdown, and `{epoch, revision}`.

- [x] **Step 1: Write failing service tests** for payload-aware open reads, tail ordering, initialization winner/conflict, idempotent append batches, stale epoch errors, compaction CAS, delete-only-included ids, and typed access/conflict errors.
- [x] **Step 2: Verify RED** with `npm run test:unit -- --runInBand tests/unit/documents/document-state-gateway.test.ts`.
- [x] **Step 3: Implement the gateway** using caller-provided Supabase clients. Keep encoded compaction RPC arguments private, map Postgres conflict codes to `DocumentStateConflictError`, and serialize Markdown from exactly the merged snapshot that is submitted to the RPC.
- [x] **Step 4: Narrow Phase 1 content mutation** by marking `updateDocumentContent` as legacy-only and ensuring collaborative UI code cannot call it after session construction.
- [x] **Step 5: Verify GREEN** with the targeted gateway and existing document-service tests.
- [x] **Step 6: Commit** with `git add src/lib/documents/documentStateGateway.ts src/lib/services/documentService.ts tests/unit/documents/document-state-gateway.test.ts && git commit -m "feat: add authoritative document state gateway"`.

### Task 5: Durable private Supabase collaboration session

**Files:**
- Replace: `src/lib/documents/documentYjsProvider.ts`
- Create: `src/lib/documents/documentCollaborationSession.ts`
- Replace: `tests/unit/documents/document-yjs-provider.test.ts`
- Create: `tests/unit/documents/document-collaboration-session.test.ts`

**Interfaces:**
- Produces `DocumentCollaborationSession` with `doc`, `awareness`, `status`, `token`, `connect`, `attachBinding`, `flush`, `retry`, `subscribe`, `destroy`.
- Implements the `@lexical/yjs` provider event surface consumed by the adapter.

- [x] **Step 1: Write failing state-machine tests** for `idle -> authorizing -> connecting -> hydrating -> syncing -> ready`, viewer `legacy-view`, initialization races, private channel options, and access-token forwarding/refresh.
- [x] **Step 2: Write failing durability tests** using two fake authenticated clients: merge local updates for 50-100 ms, append once, broadcast only after append resolves, retain pending data on failure, reject stale epoch events, and flush before sync response.
- [x] **Step 3: Write failing reconnect/reset tests** for durable-tail hydration, database-head comparison on reconnect/focus/heartbeat, exactly-once rehydrate on reset, no response containing non-durable data, and cleanup of timers/channel/awareness.
- [x] **Step 4: Verify RED** with `npm run test:unit -- --runInBand tests/unit/documents/document-yjs-provider.test.ts tests/unit/documents/document-collaboration-session.test.ts`.
- [x] **Step 5: Implement the session**. Subscribe to `doc-collab:<uuid>` with `{ private: true, broadcast: { self: false }, presence: { key: userId } }`; buffer incoming messages until durable hydration; only editors install local update/awareness senders; use gateway append before channel send.
- [x] **Step 6: Implement compaction thresholds** at 100 tail rows or 1 MiB and an idle/background trigger. A losing compactor reloads and retries with bounded backoff; metadata `document-updated` is emitted only after successful compaction.
- [x] **Step 7: Verify GREEN** with the command from Step 4.
- [x] **Step 8: Commit** with `git add src/lib/documents/documentYjsProvider.ts src/lib/documents/documentCollaborationSession.ts tests/unit/documents/document-yjs-provider.test.ts tests/unit/documents/document-collaboration-session.test.ts && git commit -m "feat: add durable document collaboration session"`.

### Task 6: Fail-closed MDXEditor Lexical adapter and presence cursors

**Files:**
- Replace: `src/components/documents/documentCollaborationPlugin.ts`
- Modify: `src/components/documents/MdxDocumentEditor.tsx`
- Modify: `src/components/documents/MdxDocumentEditor.module.css`
- Create: `tests/unit/documents/document-collaboration-adapter.test.ts`

**Interfaces:**
- Consumes `DocumentCollaborationSession.attachBinding` and provider events.
- Produces adapter failure callbacks and stable cursor overlays for the root editor.

- [ ] **Step 1: Write failing adapter tests** for hydration after `observeDeep`, node identity, Chinese IME suppression/one-time commit, queued remote apply after composition, Undo/Redo, focus awareness, cursor mapping, and fatal reconciliation propagation.
- [ ] **Step 2: Verify RED** with `npm run test:unit -- --runInBand tests/unit/documents/document-collaboration-adapter.test.ts`.
- [ ] **Step 3: Replace the spike adapter**. Remove every catch-and-continue path around Lexical/Yjs reconciliation; report errors to the session, unregister the binding, and make the surrounding editor read-only. Do not use whole-document `Y.Text`.
- [ ] **Step 4: Keep cursor layout stable** with an absolute non-interactive overlay, deterministic user colors, and name labels that cannot resize the editor.
- [ ] **Step 5: Verify GREEN** with the command from Step 2 plus codec round-trips.
- [ ] **Step 6: Commit** with `git add src/components/documents/documentCollaborationPlugin.ts src/components/documents/MdxDocumentEditor.tsx src/components/documents/MdxDocumentEditor.module.css tests/unit/documents/document-collaboration-adapter.test.ts && git commit -m "feat: bind document collaboration to MDXEditor"`.

### Task 7: React session wiring and fail-closed editor UX

**Files:**
- Create: `src/components/documents/useDocumentCollaboration.ts`
- Replace: `src/components/documents/DocumentEditor.tsx`
- Modify: `src/components/documents/DocumentEditor.module.css`
- Modify: `src/lib/utils/queryKeys.ts`
- Modify: `src/lib/documents/documentFlushRegistry.ts`
- Modify: `tests/unit/documents/document-editor-wiring.test.ts`
- Create: `tests/unit/documents/document-collaboration-wiring.test.ts`

**Interfaces:**
- Produces `useDocumentCollaboration` view state and retry/flush actions.
- Adds `queryKeys.documentState(id)` and, for Phase 2B, leaves `queryKeys.documentVersions(id)` available without loading payloads.

- [ ] **Step 1: Write failing static and hook tests** proving `DocumentEditor` no longer constructs Phase 1 autosave/stale-copy/beacon writers, starts exactly one session, passes collaboration only after hydration, keeps viewers read-only, and registers durable `flush` for navigation.
- [ ] **Step 2: Write failing UX tests** for authorizing/connecting/syncing labels, degraded/error read-only banner, retry, unsaved-change `beforeunload`, and navigation blocking when flush rejects.
- [ ] **Step 3: Verify RED** with `npm run test:unit -- --runInBand tests/unit/documents/document-editor-wiring.test.ts tests/unit/documents/document-collaboration-wiring.test.ts`.
- [ ] **Step 4: Implement the hook and editor shell**. Fetch document metadata/content for the legacy viewer only; collaborative open state comes from the gateway. Render MDXEditor once with stable dimensions, update read-only as status changes, and preserve pending in-memory Yjs edits across retry.
- [ ] **Step 5: Remove the runtime LWW path** from `DocumentEditor` while retaining Phase 1 modules only as pre-release fallback code that is no longer reachable after a collaboration session begins.
- [ ] **Step 6: Verify GREEN** with the targeted tests and all existing Phase 1 document tests.
- [ ] **Step 7: Commit** with `git add src/components/documents src/lib/utils/queryKeys.ts src/lib/documents/documentFlushRegistry.ts tests/unit/documents/document-editor-wiring.test.ts tests/unit/documents/document-collaboration-wiring.test.ts && git commit -m "feat: enable collaborative document editor sessions"`.

### Task 8: Real provider, RLS, multi-client, and browser release gate

**Files:**
- Create: `tests/e2e/specs/document-collaboration.spec.ts`
- Modify: `tests/e2e/specs/documents.spec.ts`
- Modify: `tests/unit/documents/mdx-editor-lazy-load.test.ts`

**Interfaces:**
- Exercises two editor JWTs plus one viewer/non-member against real Supabase Realtime and Postgres.

- [ ] **Step 1: Add a two-context Playwright test** that concurrently changes paragraphs, headings, lists, quotes, links, images, tables, and code blocks; assert both editors and a viewer converge and show stable remote cursors.
- [ ] **Step 2: Add Chinese IME and Undo/Redo coverage** using composition events and assert pinyin intermediates never persist or duplicate.
- [ ] **Step 3: Add disconnect/durability coverage**: block Realtime or append, assert immediate read-only/degraded state and blocked navigation, retry, reconnect, reload, and verify exact merged content from snapshot plus tail.
- [ ] **Step 4: Add authorization coverage** proving viewer/non-member cannot send, append, compact, or inject awareness and that cross-document/wrong-epoch payloads are ignored.
- [ ] **Step 5: Run the focused gate**: targeted Jest tests, `RLS_DB_TESTS=1` behavior tests, and `npx playwright test tests/e2e/specs/document-collaboration.spec.ts --workers=1`.
- [ ] **Step 6: Run repository verification**: `npm run lint`, `npm run typecheck`, `npm run typecheck:api`, `npm run test:unit -- --runInBand`, `npm run build`, and `git diff --check`.
- [ ] **Step 7: Confirm the main dashboard chunk guard** remains green and collaboration code is reachable only through the dynamic document editor chunk.
- [ ] **Step 8: Commit** with `git add tests/e2e/specs/document-collaboration.spec.ts tests/e2e/specs/documents.spec.ts tests/unit/documents/mdx-editor-lazy-load.test.ts && git commit -m "test: verify realtime document collaboration"`.

## Self-Review

- Spec coverage: schema, private authorization, codec, gateway, append-before-broadcast, compaction, reset/reconnect, viewer behavior, fail-closed binding, IME/cursors/Undo, lazy loading, RLS, and two-client tests are each assigned to a task.
- Placeholder scan: no TBD/TODO/implement-later placeholders remain.
- Type consistency: `DocumentStateToken`, `AuthoritativeDocumentState`, `DurableYjsUpdate`, `DocumentCollaborationSession`, and gateway method names are defined once and consumed consistently.
- Dependency gate: Phase 2B may begin only after Task 8 is green.
