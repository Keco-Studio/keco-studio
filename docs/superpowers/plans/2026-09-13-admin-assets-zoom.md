# Admin Assets Gallery Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded asset-size controls and `Ctrl/Cmd + wheel` zoom to the `/admin/assets` gallery without changing its aspect-ratio-preserving layout.

**Architecture:** Reuse the existing `ASSET_GRID_SIZES` and `nextAssetGridSize` helpers. `GameAssetsPage` owns the selected size index and maps it to the justified gallery target row height; the gallery container intercepts modified wheel events while normal wheel scrolling remains native. The existing `LibraryAssetsGrid` remains unchanged.

**Tech Stack:** React, Next.js, TypeScript, CSS Modules, Jest, Playwright.

## Global Constraints

- Preserve the current gallery aspect ratios, upload flow, category filtering, selection, and detail panel.
- Only `Ctrl/Cmd + wheel` changes asset size; ordinary wheel events continue to scroll.
- Size changes are bounded by the existing shared asset-grid size levels.
- Keep the implementation ASCII-only in source and tests.

---

### Task 1: Add pure sizing coverage

**Files:**
- Modify: `tests/unit/asset-grid-presentation.test.ts`
- Modify: `src/components/libraries/utils/assetGridPresentation.ts`

**Interfaces:**
- Produce a reusable `getAdminAssetTargetRowHeight(sizeIndex)` helper returning a positive row height for every `AssetGridSizeIndex`.

- [x] **Step 1: Write and run the sizing test**
- [x] **Step 2: Implement the helper and rerun the focused test**

### Task 2: Wire `/admin/assets` controls and wheel behavior

**Files:**
- Modify: `src/components/admin/GameAssetsPage.tsx`
- Modify: `src/components/admin/GameAssetsPage.module.css`

**Interfaces:**
- Consume `ASSET_GRID_SIZES`, `getAdminAssetTargetRowHeight`, and `nextAssetGridSize`.
- Keep `buildJustifiedRows` unchanged except for receiving the active target row height.

- [x] **Step 1:** Add the size state and derived target height.
- [x] **Step 2:** Intercept modified wheel events with a non-passive listener.
- [x] **Step 3:** Recompute rows using the selected size.
- [x] **Step 4:** Add accessible lower-right size controls.
- [x] **Step 5:** Add responsive control styling.

### Task 3: Add regression coverage and verify

**Files:**
- Create: `tests/unit/admin-assets-gallery-zoom.test.ts`
- Create: `tests/e2e/specs/admin-assets-zoom.spec.ts`

- [x] **Step 1:** Add browser assertions for controls, modified wheel behavior, page zoom stability, and detail opening.
- [x] **Step 2:** Run focused unit tests. The browser fixture requires the `project_game_assets` migration in the target Supabase database; local remote schema currently lacks that table.
- [x] **Step 3:** Run lint, typecheck, and production build.

