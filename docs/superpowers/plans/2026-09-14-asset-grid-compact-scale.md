# Compact Asset Grid Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend asset zoom down to a `10%` compact/list mode where one asset occupies each row, while preserving the existing multi-column levels and default `100%` view.

**Architecture:** Add a shared scale descriptor with an explicit `layout` (`grid` or `list`) and a shared default index. The library grid and admin gallery continue to own their layout-specific rendering, but consume the same scale descriptors, labels, bounds, and compact-mode predicate.

**Tech Stack:** React 19, TypeScript, CSS Modules, Jest, Playwright.

## Global Constraints

- `100%` remains the default size.
- The smallest scale is `10%` and renders one asset per row.
- `Ctrl/Cmd + wheel` changes only asset size and must continue to prevent browser page zoom.
- Existing upload, selection, preview, detail, filtering, and keyboard behavior must remain intact.
- Preserve the repository's English-character gate and existing local style conventions.

---

### Task 1: Extend Shared Scale Model

**Files:**
- Modify: `src/components/libraries/utils/assetGridPresentation.ts`
- Test: `tests/unit/asset-grid-presentation.test.ts`

**Interfaces:**
- Produce `ASSET_GRID_SIZES` entries with `layout: 'grid' | 'list'`.
- Produce `DEFAULT_ASSET_GRID_SIZE_INDEX` and `isAssetGridListMode(sizeIndex)`.

- [ ] **Step 1: Write the failing tests**

Add assertions that the shared sizes include `10%`, that the default label is `100%`, that `isAssetGridListMode` is true only for `10%`, and that decreasing from the default eventually reaches the `10%` lower bound.

- [ ] **Step 2: Run the focused test and verify it fails**

Run `npm test -- --runInBand tests/unit/asset-grid-presentation.test.ts`.
Expected: FAIL because the new default and compact helpers do not exist.

- [ ] **Step 3: Implement the minimal shared model**

Use ordered levels `10%` list, `25%` grid, `40%` grid, `60%` grid, `75%` grid, `100%` grid, `125%` grid, and `150%` grid. Set `DEFAULT_ASSET_GRID_SIZE_INDEX` to the index whose label is `100%`; keep `nextAssetGridSize` bounded by the new array.

- [ ] **Step 4: Run the focused test and verify it passes**

Run `npm test -- --runInBand tests/unit/asset-grid-presentation.test.ts`.
Expected: PASS.

- [ ] **Step 5: Commit**

Run `git add src/components/libraries/utils/assetGridPresentation.ts tests/unit/asset-grid-presentation.test.ts && git commit -m "feat: add compact asset grid scale levels"`.

### Task 2: Add Compact Rendering to Admin Assets

**Files:**
- Modify: `src/components/admin/GameAssetsPage.tsx`
- Modify: `src/components/admin/GameAssetsPage.module.css`
- Test: `tests/unit/admin-assets-gallery-zoom.test.ts`

**Interfaces:**
- Consume `DEFAULT_ASSET_GRID_SIZE_INDEX` and `isAssetGridListMode`.
- `AssetCard` accepts `listMode` and renders a fixed small preview beside the asset name in compact mode.

- [ ] **Step 1: Write the failing source-level tests**

Assert that the page consumes the shared default index and compact predicate, and that the card exposes a compact/list class or data marker.

- [ ] **Step 2: Run the focused test and verify it fails**

Run `npm test -- --runInBand tests/unit/admin-assets-gallery-zoom.test.ts`.
Expected: FAIL because the page still uses a positional default and has no compact card branch.

- [ ] **Step 3: Implement compact admin layout**

Use the shared default index, derive `listMode`, and make `buildJustifiedRows` return one-item rows when list mode is active. In list mode, `AssetCard` spans the row, gives the thumbnail a fixed `56px` box with `object-fit: contain`, and places the existing name to its right. Keep normal justified rows unchanged.

- [ ] **Step 4: Run unit tests and typecheck**

Run `npm test -- --runInBand tests/unit/admin-assets-gallery-zoom.test.ts tests/unit/asset-grid-presentation.test.ts` and `npm run typecheck`.
Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

Run `git add src/components/admin/GameAssetsPage.tsx src/components/admin/GameAssetsPage.module.css tests/unit/admin-assets-gallery-zoom.test.ts && git commit -m "feat: render compact admin asset list"`.

### Task 3: Add Compact Rendering to Library Grid

**Files:**
- Modify: `src/components/libraries/components/LibraryAssetsGrid.tsx`
- Modify: `src/components/libraries/components/LibraryAssetsGrid.module.css`
- Test: `tests/unit/asset-grid-wiring.test.ts`

**Interfaces:**
- Consume `DEFAULT_ASSET_GRID_SIZE_INDEX` and `isAssetGridListMode` from the shared presentation module.

- [ ] **Step 1: Write the failing wiring assertions**

Assert that the library grid uses the shared default/compact helpers and has a compact card class or data marker.

- [ ] **Step 2: Run the focused test and verify it fails**

Run `npm test -- --runInBand tests/unit/asset-grid-wiring.test.ts`.
Expected: FAIL because the library grid currently assumes every scale is a tiled grid.

- [ ] **Step 3: Implement one-item compact rows**

Set `columnCount` to `1` in list mode, use a compact row height, stretch the single card to the available width, and style the preview as a fixed small square with the name beside it. Preserve selection, keyboard navigation, virtualization, metadata, and double-click behavior.

- [ ] **Step 4: Run focused unit tests and typecheck**

Run `npm test -- --runInBand tests/unit/asset-grid-wiring.test.ts tests/unit/asset-grid-presentation.test.ts` and `npm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

Run `git add src/components/libraries/components/LibraryAssetsGrid.tsx src/components/libraries/components/LibraryAssetsGrid.module.css tests/unit/asset-grid-wiring.test.ts && git commit -m "feat: render compact library asset list"`.

### Task 4: Verify Browser Behavior

**Files:**
- Modify: `tests/e2e/specs/admin-assets-zoom.spec.ts`

- [ ] **Step 1: Extend the browser test**

After the existing `100%` assertions, use the decrease control repeatedly until `10%`, assert the compact/list marker and one-item rows, then click an asset and assert the detail dialog still opens. Keep the page-width assertion after modified wheel input.

- [ ] **Step 2: Run the focused browser test**

Run `npx playwright test tests/e2e/specs/admin-assets-zoom.spec.ts` with the repository's configured Supabase test environment.
Expected: PASS; if the local database lacks required schema, record that environment limitation and rely on CI migration replay.

- [ ] **Step 3: Run repository verification**

Run `npm run lint`, `npm run typecheck`, `npm run build`, `npm test -- --runInBand tests/unit/asset-grid-presentation.test.ts tests/unit/admin-assets-gallery-zoom.test.ts tests/unit/asset-grid-wiring.test.ts`, and the English-character gate.
Expected: PASS with no new errors.

- [ ] **Step 4: Commit test updates**

Run `git add tests/e2e/specs/admin-assets-zoom.spec.ts && git commit -m "test: cover compact asset zoom behavior"`.
