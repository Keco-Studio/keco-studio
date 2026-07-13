# In-App Documents: Design (Revised after Review of `using-MDXEditor@ae5e588`)

**Date:** 2026-07-13 (rev 2)
**Supersedes:** the original "Document Yjs Collaboration Design" (Phase 2A only).
**Scope:** MDXEditor documents end to end — Phase 1 authoring (harden + close lifecycle), Phase 2A realtime collaboration (gate correctly), delivery hygiene.
**Status:** Re-planning. `ae5e588` is **Request Changes** — do not merge as-is.

---

## Why this revision exists

The branch `using-MDXEditor@ae5e588` bundled Phase 1, unfinished Phase 2 collaboration,
a destructive migration, a shared-authorization change, and Sidebar integration into a
**single monolithic commit**. Beyond individual bugs, the core problems are structural:

- **Data authority is undefined.** `yjs_state` is declared authoritative, but production
  code writes only Markdown via `updateDocumentContent`; the `yjs_state`+`content` writer
  exists but is never called. The two columns can permanently diverge.
- **Lifecycle is not closed.** Autosave has multiple data-loss paths; navigation flush is a
  hidden global singleton that only covers part of the Sidebar.
- **Module boundaries leak.** One `document` entity forced edits across ~10 layout files;
  `DocumentEditor` owns query + permission + autosave state machine + cache + broadcast +
  lifecycle + upload + rendering.
- **Realtime is unauthenticated.** Public channels would let any client with an ID read/write.
- **Delivery is unreviewable.** No PR/CI, behind `origin/main` by 8 commits, `git diff --check`
  fails, unrelated dep bump (`js-yaml`).

This spec re-scopes the work into **small, independently reviewable slices** with explicit
data authority, closed lifecycles, and reuse of existing infrastructure.

---

## Guiding principles

1. **One authority per concern.** Exactly one write path per phase. No dual writers.
2. **Ship Phase 1 first, alone.** Phase 1 (single-user Markdown authoring) must be correct,
   tested, and mergeable **without** any Yjs code present.
3. **Phase 2A is opt-in until it is safe.** Collaboration lands only when the editor binding,
   channel authorization, and persistence are all closed. No half-wired collab in `main`.
4. **Reuse, don't reimplement.** `queryKeys`, `NavigationContext`, `useUpdateEntityName`,
   a single shared UUID validator, existing modal/create patterns.
5. **Small PRs.** Each phase below is one or more PRs against `main`, each green in CI.

---

## Delivery slicing (replaces the single commit)

| PR | Title | Contains | Merge gate |
|----|-------|----------|------------|
| PR-0 | chore: rebase branch on main | Rebase, drop `js-yaml` bump, fix `git diff --check` | CI green, no unrelated diff |
| PR-1 | feat(db): documents table + safe shared_documents retirement | New `documents` table + RLS; **guarded** retirement of `shared_documents` | Migration tests; drop is conditional |
| PR-2 | feat(docs): document service + query keys | `documentService` CRUD, `queryKeys.document(s)`, cross-project FK validation | Unit tests |
| PR-3 | feat(docs): document actions + sidebar integration | `useSidebarDocumentActions` mutation layer; NavigationContext exposes `documentId` | Unit tests; no URL regex in Sidebar |
| PR-4 | feat(docs): editor shell + authoring | `DocumentEditor` decomposed; robust autosave; MDX editor | Autosave loss tests |
| PR-5 | feat(docs): realtime sidebar notifications | Private channel + `document-updated` handling incl. `create`; cache invalidation of open doc | Channel authz test |
| PR-6 | feat(docs): collaboration (Phase 2A) | `yjs_state`, provider, MDX binding, awareness, single authoritative persist | Two-client + authz + reload tests |

Phases 1–5 are **Phase 1 product**. PR-6 is **Phase 2A** and must not be merged until its
acceptance criteria (below) pass.

---

## Phase 1 — authoring (must be correct standalone)

### Data model

`documents`: `id`, `project_id` NOT NULL, `folder_id` NULL, `name`, `content` (Markdown),
`created_by`, `created_at`, `updated_at`.

- `project_id` NOT NULL from day one (lesson from #172).
- **Cross-project integrity:** `folder_id` must belong to the same `project_id`. Enforce in a
  DB check/trigger *and* validate in `createDocument`/`moveDocument` (do not trust the client).
- RLS mirrors `is_project_owner` / `is_accepted_collaborator`; writes require admin/editor.

### `shared_documents` retirement (fix destructive migration)

Do **not** `DROP TABLE ... CASCADE` unconditionally. Required order:

1. Migration asserts row count is 0 (or archives rows to `shared_documents_archive`) before drop.
2. If non-empty and not archived, the migration **raises** rather than dropping.
3. Retirement is its own migration file, separable from `documents` creation, so it can be
   reverted independently.

### Service layer (single authority)

`src/lib/services/documentService.ts`:

- CRUD, first arg `SupabaseClient`, no `'use client'`.
- **Phase 1 has exactly one content writer:** `updateDocumentContent(client, id, content, userId?)`.
- **Do not ship** `persistDocumentCollabState` in Phase 1 (it belongs to PR-6). No unused
  second writer in the tree.
- Introduce **one** shared UUID validator (e.g. `isUuid` in `src/lib/utils/`) and use it
  everywhere; the branch currently duplicates the `8-4-4-4-12` regex in multiple files.
- `getDocument` must distinguish "not found / no access" (throw or return a typed error) from
  "loading", so the editor can render an error state instead of a permanent spinner.
- Validate `document.project_id === projectId` at the page boundary before granting the
  URL-derived role.

### Autosave lifecycle (close every loss path)

State machine in a dedicated hook `useDocumentAutosave` (extracted from `DocumentEditor`):

- **Coalesce during save:** edits arriving while a save is in flight set `pendingDirty` and
  re-run after completion; UI never shows `Saved` while `pendingDirty` is true.
- **Empty body:** an explicit user clear (onChange `""`) *is* saved; a `""` snapshot produced by
  navigation/unmount teardown is **not** allowed to overwrite a known non-empty body.
- **Flush failure blocks navigation:** the navigation flush **awaits and propagates** failure;
  the Sidebar must not route away on a rejected flush (surface an error / keep the user on page).
- **`beforeunload`:** use `navigator.sendBeacon` (or a synchronous keepalive request) — an async
  save started in `beforeunload` cannot block unload and silently loses data.
- Cache write-through on success updates `queryKeys.document(id)` so returning shows fresh text.

### Editor decomposition (fix "one component does everything")

Split `DocumentEditor` into:

- `DocumentEditor` — layout + wiring only.
- `useDocumentAutosave` — dirty/save state machine.
- `useDocumentPermissions` — role/read-only resolution (validates project match).
- `MdxDocumentEditor` — MDXEditor instance only.

### Sidebar / navigation integration (reduce coupling)

- New `useSidebarDocumentActions` mutation layer centralizes **create / rename / move / delete**
  (today they are scattered across `Sidebar`, `useSidebarContextMenuActions`, and realtime hook).
- Reuse `useUpdateEntityName` for rename (do not reimplement optimistic update/rollback).
- **NavigationContext exposes `currentDocumentId`** (already parsed in `routeParams`); Sidebar
  and TopBar consume context — no ad-hoc URL regex in `Sidebar`.
- Replace the global `documentFlushRegistry` singleton with a navigation-guard approach that
  covers **all** exits (Sidebar, TopBar, breadcrumb, browser back) — e.g. a route-change guard
  in NavigationContext, or block navigation until the editor reports clean. The flush must not
  be bypassable by other `router.push` sites.
- Give documents their own tree node type/icon; stop reusing `libraryRow` /
  `_isLibraryUnderFolder` for document semantics.
- Use `queryKeys.document(s)` everywhere; no hardcoded `['document']` / `['documents']`.

### `create` broadcast + open-doc refresh (fix stale views)

- Creating a document sends `action: 'create'` on the sidebar channel (currently defined but
  never emitted) so remote sidebars update.
- `save`/`rename` handlers invalidate **both** `queryKeys.documents(projectId)` **and**
  `queryKeys.document(id)` so a remote body and a renamed title both refresh.
- Document lists must not keep `refetchOnMount: false` in a way that strands missed changes;
  invalidate on realtime events and on focus-return.

### Modal / interaction correctness

- `NewDocumentModal`: Enter respects `submitting` (no duplicate create); `onCreated` is awaited.
- Either make `folderId` create actually reachable (create into the selected folder) or remove
  the dead parameter — do not keep a create path that is always cleared to root.
- Reuse the `NewFolderModal` form/state pattern instead of copying it.

### Phase 1 acceptance

1. Create → edit → reload shows saved Markdown; no data loss on slow save, clear-then-navigate,
   or tab close.
2. Switching documents (Sidebar / TopBar / back button) always persists the previous doc.
3. Flush failure keeps the user on the page with a visible error; never silent.
4. No-access / missing document renders an error, not an infinite spinner.
5. Rename/create/delete/move reflect on remote sidebars.
6. **No Yjs code in the tree** for Phase 1 PRs.

---

## Phase 2A — realtime collaboration (PR-6, gated)

Only starts after Phase 1 merges. Reintroduces Yjs with the boundaries below.

### Single data authority

- `documents.yjs_state` (base64 `Y.encodeStateAsUpdate`) is authoritative; `content` is a
  derived Markdown snapshot; `updated_at` is persist-time only (no LWW).
- **Exactly one production writer:** `persistDocumentCollabState(client, id, {yjsStateBase64, content})`.
  When collaboration is on, `updateDocumentContent` is **not** used for the editor body.
- On open: hydrate `Y.Doc` from `yjs_state`; if null, bootstrap once from `content`.

### Editor binding (fix the crash class)

The prior binding threw `Invalid access: Add Yjs type…`, doubled IME input, and
`syncChildrenFromYjs` errors. PR-6 must resolve the MDXEditor↔`@lexical/yjs` binding such that:

- No structural sync error on keystroke.
- IME composition never commits pinyin intermediates to the CRDT (skip while `isComposing()`).
- Initial hydrate runs once, outside any nested `editor.update`.

If a stable Lexical binding cannot be achieved, the **fallback is a Markdown-level CRDT**
(`Y.Text` over the Markdown string) rather than shipping a broken node binding. The chosen
approach is decided in PR-6 with a spike, not assumed.

### Realtime access control (fix public channel)

- Collaboration channel `doc-collab:{documentId}` and the sidebar notification channel must be
  **private** (Supabase private channels + `realtime.messages` RLS policy), so only members of
  the document's project can subscribe/broadcast.
- Sidebar broadcasts must not leak document id/name/activity to non-members.
- Channel authorization is verified by a test before collab is enabled.

### Permissions

| Role | Sync | Edit | Persist |
|------|------|------|---------|
| owner / admin / editor | yes | yes | yes |
| viewer | yes | read-only | no |

### Performance

- Autosave must not run 3 auth/role queries + UPDATE + a fresh Realtime channel every 500ms.
  Cache project-id/role for the open document; reuse a persistent channel; debounce persistence
  independently from broadcast.

### Phase 2A acceptance

1. Two editors co-edit live; characters are not duplicated (incl. Chinese IME).
2. Remote cursors with name + color.
3. Reload restores from `yjs_state`; `content` stays fresh; the two never diverge.
4. Viewer syncs read-only, cannot persist.
5. Non-member cannot subscribe to either channel (verified).
6. `getMarkdown() === ""` from a torn-down editor never overwrites saved content.

---

## Shared-authorization change (scope it down)

The `getCurrentUserId` change to trust local `getSession()` touches ~33 call sites and can feed
stale/spoofable IDs into `created_by`, upload paths, and app-layer pre-checks.

- **Do not** change the shared `getCurrentUserId` for this feature.
- If autosave needs to avoid `getUser()` network churn, pass the already-resolved `userId` from
  the editor (from `AuthContext`) into `updateDocumentContent` / `persistDocumentCollabState`
  **only**, leaving the shared helper untouched.
- Any change to `getCurrentUserId` is a separate, reviewed PR with its own risk assessment.

---

## Reuse checklist (avoid duplication)

- `queryKeys.document(id)` / `queryKeys.documents(projectId)` added to `queryKeys.ts`; used in all
  9 current hardcoded sites.
- Rename via `useUpdateEntityName`.
- Single shared UUID validator import (no duplicated `8-4-4-4-12` regex).
- `NavigationContext.currentDocumentId` instead of Sidebar URL regex.
- Single source for the sidebar topic string (`projectSidebarTopic()`), imported by both sender
  and receiver (no duplicated literal).
- Collaboration config typed once and shared by `MdxDocumentEditorProps` and
  `DocumentCollaborationParams`.
- Remove dead code until connected: stale-banner CSS, unused broadcast fields
  (`updatedAt`/`name`/`action` on the receiver), color-util re-export, collab persist API — each
  lands in the PR that actually consumes it.

## Testing requirements (per phase, gate merge)

Phase 1:
- Slow-save coalescing; clear-then-navigate; flush-failure-blocks-navigation; tab-close via beacon.
- Cross-project folder rejected; duplicate-create prevented; cache consistency after save/rename.
- No-access/missing document renders error.

Phase 2A:
- Two-client merge via the real provider path (`connect()` exercised, not just raw Yjs).
- Private channel rejects non-members.
- Viewer read-only; reload authority; empty-snapshot guard.

## Delivery hygiene

- Rebase onto `origin/main` (currently 8 behind); no unrelated dep bumps (`js-yaml`).
- `git diff --check` clean (trailing whitespace in docs).
- Each PR: `npm run typecheck` + `typecheck:api` + targeted `test:unit` + `build` green in CI.
- Package count growth reviewed; keep `@lexical/yjs` pinned.

## Out of scope (unchanged)

Offline/IndexedDB, version history, comments, full MDX/JSX, dedicated `y-websocket` service,
changing library Yjs (#214), sharded large-doc persistence, a duplicate `/api/documents` layer
(direct service + RLS remains the pattern).
