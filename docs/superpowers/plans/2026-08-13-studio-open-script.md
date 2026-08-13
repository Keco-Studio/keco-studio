# Studio Open Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Studio document `Open script` action that immediately enters Script, shows the source Document while opening/import/generation runs, then replaces it with the newest existing script or a newly generated script for admins/editors. Viewers import and open the Script document without generation.

**Architecture:** A thin Script transition route delegates to a dependency-injected orchestration service. Script lookup stays in the derived-library service; generation reuses the existing document-derived pipeline; the existing `ScriptSplitView` and Flow chart remain the final UI. Permission changes are narrowly scoped to conversation generation and Script workspace membership.

**Tech Stack:** Next.js App Router, React 19, TypeScript, TanStack Query, Supabase/Postgres RLS, Jest, Playwright.

---

### Task 1: Studio Menu And Navigation

**Files:**
- Modify: `tests/unit/documents/document-derived-sidebar.test.tsx`
- Modify: `src/components/layout/ContextMenu.tsx`
- Modify: `src/components/layout/hooks/useSidebarContextMenuActions.ts`

- [ ] Add failing tests that `Open script` renders for admin/editor/viewer and routes to `/script-system/project/open/doc`.
- [ ] Run `npx jest --runInBand tests/unit/documents/document-derived-sidebar.test.tsx`; expect failure because the action is missing.
- [ ] Add `open-script` to `ContextMenuAction`, render it for every document role, and handle it by closing the menu then calling `router.push` with the transition route.
- [ ] Re-run the focused test; expect pass.
- [ ] Commit only these files with `feat: add Studio Open script entry`.

### Task 2: Newest Script Lookup

**Files:**
- Modify: `src/lib/services/documentDerivedLibraryService.ts`
- Create: `src/lib/services/documentDerivedLibraryService.test.ts`

- [ ] Add a failing fake-client test for `findNewestDocumentScript`: filter by project, source document, and `script`; order by `created_at DESC` then `id DESC`; return one row or null; throw query errors.
- [ ] Run `npx jest --runInBand src/lib/services/documentDerivedLibraryService.test.ts`; expect missing export failure.
- [ ] Implement `findNewestDocumentScript(supabase, projectId, documentId): Promise<{id: string; createdAt: string} | null>` with the exact filters/order above.
- [ ] Re-run the focused test; expect pass.
- [ ] Commit with `feat: find newest document script`.

### Task 3: Open-Script Orchestration

**Files:**
- Create: `src/lib/script-system/openScriptFromStudio.ts`
- Create: `src/lib/script-system/openScriptFromStudio.test.ts`

- [ ] Add failing dependency-injected tests for membership-first ordering, existing-script reuse, admin/editor generation, viewer document fallback, final lookup after generation failure, and membership errors.
- [ ] Run `npx jest --runInBand src/lib/script-system/openScriptFromStudio.test.ts`; expect module-not-found failure.
- [ ] Implement `openScriptFromStudio` returning `{kind:'script', libraryId}` or `{kind:'document', documentId}` and phases `opening|generating`; only admins/editors call `generate`; generation catch performs one last lookup before rethrow.
- [ ] Re-run the focused test; expect pass.
- [ ] Commit with `feat: orchestrate Studio Open script`.

### Task 4: Script Transition Page

**Files:**
- Create: `src/app/(dashboard)/script-system/[projectId]/open/[documentId]/page.tsx`
- Create: `src/app/(dashboard)/script-system/[projectId]/open/[documentId]/page.module.css`
- Create: `tests/unit/script-system/open-script-page.test.tsx`

- [ ] Add failing tests for script/document `router.replace`, phase copy, retry, Studio-back route, `aria-live`, and single-flight behavior.
- [ ] Run `npx jest --runInBand tests/unit/script-system/open-script-page.test.tsx`; expect route/module failure.
- [ ] Implement the page with `useParams`, project role, Supabase session, query invalidation, existing import helpers, and guarded attempts. Render the source `DocumentEditor` immediately without a custom status overlay; reuse the blue `Generating…` toast emitted by the existing import pipeline.
- [ ] Re-run the focused test; expect pass.
- [ ] Commit with `feat: add Script opening transition`.

### Task 5: Editor Conversation Permission In Script UI

**Files:**
- Modify: `tests/unit/script-system/script-context-menu.test.tsx`
- Modify: `tests/unit/script-system/script-generate-conversation.test.ts`
- Modify: `src/components/script-system/ScriptContextMenu.tsx`
- Modify: `src/components/script-system/useScriptSidebarActions.ts`

- [ ] Change tests to require generation for admin/editor and denial for viewer.
- [ ] Run both focused tests; expect editor failures.
- [ ] Use `userRole === 'admin' || userRole === 'editor'` in menu and action handler.
- [ ] Re-run both tests; expect pass.
- [ ] Commit with `feat: allow editors to generate conversations`.

### Task 6: Narrow Server Authorization

**Files:**
- Modify: `tests/unit/auth/authorization-role.test.ts`
- Modify: `src/lib/services/authorizationService.ts`
- Modify: `src/lib/services/scriptImportService.test.ts`
- Modify: `src/lib/services/scriptImportService.ts`
- Modify: `tests/unit/documents/document-export-source-service.test.ts`
- Modify: `src/lib/server/documentExportSourceService.ts`
- Modify: `src/app/api/import-script/route.ts`

- [ ] Add failing tests for a dedicated admin/editor conversation permission, editor export snapshots, viewer denial, and selection of the new helper only for document-derived `script` imports.
- [ ] Run the three focused test files; expect failures.
- [ ] Add `verifyDerivedConversationCreationPermission` without changing admin-only `verifyLibraryCreationPermission`. Use it for document-derived scripts and export snapshots; retain old permission for ordinary/file/table imports; map its error to HTTP 403.
- [ ] Re-run the focused tests; expect pass.
- [ ] Commit with `feat: authorize editor conversation generation`.

### Task 7: Viewer Workspace Import RLS

**Files:**
- Create: `supabase/migrations/20260813100000_allow_viewer_script_workspace_import.sql`
- Create: `tests/unit/database/script-workspace-viewer-import-migration.test.ts`
- Modify: `tests/unit/api/script-workspace-route.test.ts`

- [ ] Add a failing migration test requiring insert policy checks for owner or any accepted collaborator, not only editor/admin. Add an API contract test showing viewer project access reaches the upsert service.
- [ ] Run both focused tests; expect missing migration failure.
- [ ] Replace only `script_workspace_documents_insert` with `is_project_owner OR is_accepted_collaborator`; keep delete policy unchanged.
- [ ] Re-run focused tests; expect pass.
- [ ] Commit with `feat: allow viewers to import Script documents`.

### Task 8: Integration And Final Verification

**Files:**
- Modify when fixture support is available: `tests/e2e/specs/keco-script-workspace.spec.ts`

- [ ] Add an E2E path from Studio document context menu to an existing seeded script and assert `Flow chart` is visible without invoking the LLM.
- [ ] Run all focused Jest tests from Tasks 1-7 together; expect all pass with no unhandled rejections.
- [ ] Run `npm run typecheck` and ESLint on touched production files; expect exit 0.
- [ ] Run `npx playwright test tests/e2e/specs/keco-script-workspace.spec.ts --workers=1` when local auth/Supabase is available; capture desktop/mobile transition and final-page screenshots and check for blank/overlapping content. Record unavailable infrastructure rather than weakening tests.
- [ ] Run `git diff --check` and inspect `git status --short`; preserve unrelated user changes.
- [ ] Commit E2E coverage separately with `test: cover Studio Open script workflow`.
