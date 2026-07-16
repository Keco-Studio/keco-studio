# In-App Documents Implementation Plan (Revised after Review)

> **For agentic workers:** Implement PR-by-PR, in order. Each PR must be typecheck + test +
> build green and independently mergeable to `main`. Do **not** combine phases into one commit.
> Steps use checkbox syntax.

**Supersedes** the single-commit plan behind `using-MDXEditor@ae5e588`.

**Design:** `docs/superpowers/specs/2026-07-13-document-yjs-collab-design.md` (rev 2).

**Core rules**
- One authority per concern; no dual writers.
- Phase 1 (PR-1..PR-5) ships with **no Yjs code** in the tree.
- Phase 2A (PR-6) is gated on Phase 1 + its own acceptance tests.
- Reuse `queryKeys`, `NavigationContext`, `useUpdateEntityName`, one shared UUID validator.
- English comments only. Do not touch shared `getCurrentUserId`.

---

## PR-0 — Rebase & hygiene

- [ ] Rebase branch onto `origin/main` (currently ~8 behind).
- [ ] Revert unrelated `js-yaml 4.1.1 → 4.2.0` bump.
- [ ] `git diff --check` clean (strip trailing whitespace in design/plan docs).
- [ ] Open a draft PR so CI runs from here on.

## PR-1 — DB: documents table + safe retirement

- [ ] Migration: create `documents` (`project_id` NOT NULL, nullable `folder_id`, `content`,
      `created_by`, timestamps); RLS via `is_project_owner` / `is_accepted_collaborator`.
- [ ] DB-level cross-project guard: `folder_id`'s project must equal `project_id` (check/trigger).
- [ ] **Separate** migration for `shared_documents`: guard with row-count assertion / archive
      table; raise instead of `DROP ... CASCADE` when non-empty; independently revertible.
- [ ] Update static RLS/migration assertion tests.

## PR-2 — Service + query keys

- [ ] `documentService.ts`: `createDocument`, `getDocument`, `listDocuments`,
      `updateDocumentContent(client, id, content, userId?)`, `renameDocument`, `moveDocument`,
      `deleteDocument`. First arg `SupabaseClient`. **No** `persistDocumentCollabState` yet.
- [ ] `getDocument` returns typed not-found/no-access (not silent `null`).
- [ ] Validate `folder_id` belongs to `project_id` in create/move.
- [ ] Add `queryKeys.document(id)` and `queryKeys.documents(projectId)`.
- [ ] Add one shared UUID validator in `src/lib/utils/` and remove per-file `8-4-4-4-12` copies.
- [ ] Unit tests: CRUD, cross-project folder rejected, not-found path.

## PR-3 — Actions layer + navigation context

- [ ] `useSidebarDocumentActions` mutation layer: create / rename / move / delete in one place.
- [ ] Rename delegates to `useUpdateEntityName` (no reimplemented optimistic/rollback).
- [ ] Expose `currentDocumentId` from `NavigationContext`; remove Sidebar URL regex.
- [ ] Single `projectSidebarTopic()` imported by sender and receiver.
- [ ] Document tree node gets its own type/icon; stop reusing `libraryRow` /
      `_isLibraryUnderFolder` for documents.
- [ ] Replace all hardcoded `['document']`/`['documents']` with `queryKeys`.
- [ ] Unit tests for the mutation layer + cache invalidation.

## PR-4 — Editor shell + autosave

- [ ] Decompose `DocumentEditor` → `DocumentEditor` (wiring), `useDocumentAutosave`,
      `useDocumentPermissions`, `MdxDocumentEditor`.
- [ ] `useDocumentPermissions` validates `document.project_id === URL projectId` before role.
- [ ] `useDocumentAutosave`:
  - [ ] Coalesce edits during in-flight save (`pendingDirty`); never show `Saved` while dirty.
  - [ ] Save explicit user-clear `""`; guard against teardown `""` overwriting saved content.
  - [ ] Navigation flush awaits + propagates failure; caller blocks navigation on failure.
  - [ ] `beforeunload` uses `sendBeacon`/keepalive, not an async save.
  - [ ] Write-through `queryKeys.document(id)` on success.
- [ ] Pass resolved `userId` (from AuthContext) into service calls; do **not** modify
      `getCurrentUserId`.
- [ ] No-access/missing → error state, not infinite spinner.
- [ ] `NewDocumentModal`: Enter respects `submitting`; `await onCreated`; folder create either
      wired or removed; reuse `NewFolderModal` pattern.
- [ ] Navigation guard covers Sidebar + TopBar + breadcrumb + browser back (replace global
      `documentFlushRegistry` singleton).
- [ ] Tests: slow-save coalescing, clear-then-navigate, flush-failure-blocks-nav, tab-close beacon.

## PR-5 — Realtime sidebar notifications (Phase 1 complete)

- [ ] Emit `action: 'create'` broadcast on document creation.
- [ ] `save`/`rename` handlers invalidate both `queryKeys.documents(projectId)` and
      `queryKeys.document(id)`.
- [ ] Fix `refetchOnMount: false` stranding: invalidate on realtime + focus-return.
- [ ] Use a **private** sidebar channel (`realtime.messages` policy) so ids/names don't leak.
- [ ] Tests: create updates remote sidebar; rename refreshes open doc title; non-member rejected.
- [ ] **Merge Phase 1 to `main`.** Confirm no Yjs code present.

## PR-6 — Collaboration (Phase 2A, gated)

- [ ] Migration: add `documents.yjs_state text`.
- [ ] Add single authoritative writer `persistDocumentCollabState(client, id, {yjsStateBase64, content})`;
      route the editor body through it when collab is on (retire `updateDocumentContent` for body).
- [ ] Spike + decide binding: `@lexical/yjs` node binding **or** Markdown-level `Y.Text` fallback.
      Do not ship a broken node binding.
- [ ] `documentYjsProvider.ts` over a **private** `doc-collab:{documentId}` channel; connect()
      exercised in tests.
- [ ] Collaboration plugin: hydrate once outside nested update; skip Lexical→Yjs while
      `isComposing()`; flush queued remote ops on `compositionend`.
- [ ] Awareness cursors (name + color); viewer read-only, cannot persist.
- [ ] Perf: cache role/project for open doc; persistent channel; separate persist debounce from
      broadcast.
- [ ] Config type shared by `MdxDocumentEditorProps` and `DocumentCollaborationParams`.
- [ ] Remove any remaining dead code (stale banner CSS, unused broadcast fields, color re-export).
- [ ] Tests: two-client merge via provider; private channel rejects non-member; reload authority;
      empty-snapshot guard; IME no-duplication.
- [ ] Pin `@lexical/yjs`; review new dependency count.

---

## Per-PR merge gate

- [ ] `npm run typecheck` and `npm run typecheck:api`
- [ ] Targeted `npm run test:unit`
- [ ] `npm run build`
- [ ] CI green on the PR; rebased on `main`; `git diff --check` clean.
