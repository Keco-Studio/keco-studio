# Conditional Assets Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide project Assets navigation until a user creates the Assets workspace, without changing the existing page-level Upload flow.

**Architecture:** Persist `projects.assets_workspace_enabled`, which remains true for an empty workspace. The project create menu activates it and navigates to the existing Assets route. The sidebar adds its fixed node only for an active workspace or the Assets route.

**Tech Stack:** Next.js 16, React 19, TypeScript, TanStack Query, Supabase PostgreSQL/RLS, Jest.

## Global Constraints

- `Create Asset` enters the workspace. It does not upload a file.
- `Upload` remains owned by the existing Assets page.
- Admins and editors may activate the workspace, matching asset upload permissions.
- Deleting all assets does not hide an activated workspace.

---

### Task 1: Persist workspace activation

**Files:**
- Create: `supabase/migrations/20260915120000_add_project_assets_workspace.sql`
- Modify: `src/lib/services/projectService.ts`
- Modify: `src/app/api/projects/[projectId]/game-assets/route.ts`
- Test: `tests/unit/database/project-assets-workspace-migration.test.ts`
- Test: `tests/unit/project-game-assets-route.test.ts`

**Interfaces:** `Project.assets_workspace_enabled?: boolean`; `POST /api/projects/:projectId/game-assets` accepts `{ action: 'activate-workspace' }` and returns `{ assetsWorkspaceEnabled: true }`.

- [ ] Write migration and route tests for the non-null false-default column, backfill of projects with existing manual/map/character assets, editor/admin activation, and repeated activation.
- [ ] Run `npx jest --runInBand tests/unit/database/project-assets-workspace-migration.test.ts tests/unit/project-game-assets-route.test.ts` and verify they fail before implementation.
- [ ] Add the migration; extend `Project`; parse the new action after the existing role check; set `assets_workspace_enabled` to true only for the target project.
- [ ] Re-run the focused tests and verify they pass.
- [ ] Commit: `git add supabase/migrations/20260915120000_add_project_assets_workspace.sql src/lib/services/projectService.ts src/app/api/projects/[projectId]/game-assets/route.ts tests/unit/database/project-assets-workspace-migration.test.ts tests/unit/project-game-assets-route.test.ts && git commit -m "feat: persist project assets workspace activation"`.

### Task 2: Add Create Asset to the project create menu

**Files:**
- Modify: `src/components/libraries/AddLibraryMenu.tsx`
- Modify: `src/components/folders/LibraryToolbar.tsx`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Test: `tests/unit/layout/add-library-menu.test.tsx`

**Interfaces:** `AddLibraryMenuProps.onCreateAsset?: () => void`; `LibraryToolbarProps.onCreateAsset?: () => void`; `library-toolbar-create-asset` has `{ projectId }`.

- [ ] Write a menu test that verifies `Create Asset` renders only with its callback and invokes that callback exactly once.
- [ ] Run `npx jest --runInBand tests/unit/layout/add-library-menu.test.tsx` and verify it fails.
- [ ] Render `Create Asset` in the shared menu; pass it only from project/recent toolbars; dispatch the event in `TopBar`; in `Sidebar`, activate with the API, invalidate `['projects', userId]`, and call existing `navigateWithFlush('/<projectId>/admin/assets')`.
- [ ] Re-run the focused test and verify it passes.
- [ ] Commit: `git add src/components/libraries/AddLibraryMenu.tsx src/components/folders/LibraryToolbar.tsx src/components/layout/TopBar.tsx src/components/layout/Sidebar.tsx tests/unit/layout/add-library-menu.test.tsx && git commit -m "feat: add create asset project action"`.

### Task 3: Make the sidebar Assets node conditional

**Files:**
- Modify: `src/components/layout/hooks/useSidebarTree.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/app/(dashboard)/[projectId]/admin/assets/page.tsx`
- Modify: `tests/unit/documents/document-derived-sidebar.test.tsx`

**Interfaces:** `SidebarCurrentIds.assetsWorkspaceEnabled?: boolean`; the tree includes `GAME_ASSETS_TREE_KEY` only for an active workspace or `isGameAssetsPage`.

- [ ] Write inactive, active, and active-route sidebar tree assertions.
- [ ] Run `npx jest --runInBand tests/unit/documents/document-derived-sidebar.test.tsx` and verify it fails because the inactive tree contains `game-assets`.
- [ ] Read the active project flag in `Sidebar`; pass it into the hook; construct the Assets root conditionally; activate idempotently on direct Assets-page load so bookmarks retain a usable sidebar node.
- [ ] Re-run the focused tree test and verify it passes.
- [ ] Run `npm run typecheck && npm run lint && npx jest --runInBand tests/unit/project-game-assets-route.test.ts tests/unit/layout/add-library-menu.test.tsx tests/unit/documents/document-derived-sidebar.test.tsx tests/unit/database/project-assets-workspace-migration.test.ts` and verify every command exits 0.
- [ ] Commit: `git add src/components/layout/hooks/useSidebarTree.tsx src/components/layout/Sidebar.tsx src/app/(dashboard)/[projectId]/admin/assets/page.tsx tests/unit/documents/document-derived-sidebar.test.tsx && git commit -m "feat: show assets navigation after workspace creation"`.
