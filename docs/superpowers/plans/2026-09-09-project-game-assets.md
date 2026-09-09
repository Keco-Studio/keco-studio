# Project Game Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Keco-native, project-scoped Game assets workspace that aggregates authoritative generated assets and supports verified manual image uploads.

**Architecture:** A server-side service normalizes manual library images, map assets, and character/animation generations into one `ProjectGameAsset` contract. A project-authorized API exposes the list and a multipart upload endpoint; the client page handles search, category/status filters, previews, and per-file upload state. Existing project navigation and Keco settings styles remain the shell.

**Tech Stack:** Next.js App Router, React, Supabase, TanStack Query, Jest, CSS Modules.

**Spec:** `docs/superpowers/specs/2026-09-09-project-game-assets-design.md`

## Global Constraints

- All reads and writes are project-scoped and repeat authorization at the API boundary.
- Provider and signed URLs are ephemeral; stable IDs, storage paths, and SHA-256 values are the asset identity.
- Generated records are read-only in this first slice; manual uploads are image-only and item-scoped.
- UI must use existing Keco spacing, typography, blue accent, sidebar, top bar, and role rules.
- Use TDD: write a failing focused test, run it RED, then implement the smallest GREEN change.

### Task 1: Asset contract and normalization

**Files:**
- Create: `src/lib/services/gameAssetsService.ts`
- Create: `src/lib/services/gameAssetsService.test.ts`

- [ ] Write tests for category mapping, status mapping, manual image normalization, generated asset normalization, category counts, and project isolation inputs.
- [ ] Run `npx jest src/lib/services/gameAssetsService.test.ts --runInBand` and verify RED.
- [ ] Implement exported `ProjectGameAsset`, `normalizeManualImage`, `normalizeMapAsset`, `normalizeCharacterAsset`, `countAssetCategories`, and `aggregateProjectGameAssets` with bounded source warnings.
- [ ] Run the focused test and verify GREEN.

### Task 2: Project game-assets API and upload write-back

**Files:**
- Create: `src/app/api/projects/[projectId]/game-assets/route.ts`
- Create: `supabase/migrations/20260909130000_project_game_assets_upload_registry.sql`
- Create: `src/app/api/projects/[projectId]/game-assets/route.test.ts`

- [ ] Write route tests for viewer GET authorization, project filtering, malformed project IDs, and item-scoped upload failure.
- [ ] Run the route test and verify RED.
- [ ] Implement `GET` with `withAuth`, `getUserProjectRole`, normalized aggregation, signed preview URLs only for ready private objects, and bounded warnings.
- [ ] Implement `POST` multipart image upload with 5 MiB/type validation, project-scoped storage path, verified metadata, registry insert, and per-file result reporting; never persist signed URLs.
- [ ] Add the registry table/storage policies needed for manual uploads and project isolation.
- [ ] Run route tests and typecheck the API.

### Task 3: Navigation and route shell

**Files:**
- Create: `src/app/(dashboard)/[projectId]/admin/assets/page.tsx`
- Modify: `src/components/layout/components/SidebarProjectQuickNav.tsx`
- Modify: `src/components/admin/AdminTabs.tsx`
- Modify: `src/components/layout/TopBar.tsx` (only if route title branching requires it)

- [ ] Add a failing navigation test asserting Game assets is below Settings and only active on `/admin/assets`.
- [ ] Run the test RED, then add the route and active-state wiring.
- [ ] Run navigation tests and typecheck.

### Task 4: Keco-styled asset workspace

**Files:**
- Create: `src/components/admin/GameAssetsPage.tsx`
- Create: `src/components/admin/GameAssetsPage.module.css`
- Create: `src/components/admin/GameAssetsPage.test.tsx`

- [ ] Write failing component tests for loading, category counts, search/status filtering, viewer upload visibility, grid/list switching, preview fallback, and per-file upload errors.
- [ ] Run the component test RED.
- [ ] Implement the two-column category rail + file list, detail drawer, upload drawer, and responsive Keco styling using existing primitives and role query.
- [ ] Wire refresh after successful upload and preserve partial warnings.
- [ ] Run component tests and lint/typecheck.

### Task 5: Verification

- [ ] Run focused service, route, and component tests.
- [ ] Run `npm run typecheck` and `npm run typecheck:api`.
- [ ] Run the relevant existing settings/sidebar tests and inspect the final diff for unrelated changes.
