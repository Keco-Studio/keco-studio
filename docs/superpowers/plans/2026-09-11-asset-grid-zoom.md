# Asset Explorer Grid With Wheel Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows File Explorer-like virtualized asset grid whose tile size and information density change with the mouse wheel while preserving the current table as a switchable view.

**Architecture:** Shared row resolution and filtering remain in `LibraryAssetsTable`; only rendering changes between the existing table and a focused `LibraryAssetsGrid`. Pure helper functions own bounded wheel zoom and safe image-preview extraction so behavior is testable without a browser. The grid uses row virtualization and opens the existing asset detail drawer, keeping all persistence and realtime data flows untouched.

**Tech Stack:** React 19, TypeScript 5.9, CSS Modules, `@tanstack/react-virtual`, Jest 30.

## Global Constraints

- Preserve `src/assets/images/AssetTableIcon.svg` as the fallback visual.
- Do not change the Supabase schema, asset persistence, realtime, filtering, or optimistic mutation contracts.
- Grid is the default view; the current table remains available from an in-content view toggle.
- Wheel zoom is bounded to five density levels and only consumes wheel input while the pointer is over the grid.
- Large datasets mount only visible grid rows plus overscan.

---

### Task 1: Pure Asset Grid Presentation Rules

**Files:**
- Create: `src/components/libraries/utils/assetGridPresentation.ts`
- Test: `tests/unit/asset-grid-presentation.test.ts`

**Interfaces:**
- Consumes: `AssetRow` and `PropertyConfig` from `@/lib/types/libraryAssets`.
- Produces: `ASSET_GRID_SIZES`, `AssetGridSizeIndex`, `nextAssetGridSize(index, deltaY)`, `getAssetGridPreviewUrl(row, properties)`, and `getAssetGridMetadata(row, properties, limit)`.

- [ ] **Step 1: Write the failing zoom tests**

```ts
import { ASSET_GRID_SIZES, nextAssetGridSize } from '@/components/libraries/utils/assetGridPresentation';

test('wheel up enlarges tiles and wheel down shrinks them within bounds', () => {
  expect(nextAssetGridSize(2, -100)).toBe(3);
  expect(nextAssetGridSize(2, 100)).toBe(1);
  expect(nextAssetGridSize(ASSET_GRID_SIZES.length - 1, -100)).toBe(ASSET_GRID_SIZES.length - 1);
  expect(nextAssetGridSize(0, 100)).toBe(0);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx jest --runInBand tests/unit/asset-grid-presentation.test.ts`

Expected: FAIL because `assetGridPresentation` does not exist.

- [ ] **Step 3: Add preview and metadata tests**

```ts
test('uses the first image field URL and rejects non-image media', () => {
  const row = makeRow({ image: { url: 'https://example.test/a.png', fileType: 'image/png' } });
  expect(getAssetGridPreviewUrl(row, properties)).toBe('https://example.test/a.png');
  expect(getAssetGridPreviewUrl(makeRow({ image: { url: 'javascript:alert(1)', fileType: 'image/png' } }), properties)).toBeNull();
});

test('returns only non-empty non-image metadata up to the requested limit', () => {
  expect(getAssetGridMetadata(makeRow({ title: 'Hero', empty: '', count: 3 }), properties, 2))
    .toEqual([{ label: 'Title', value: 'Hero' }, { label: 'Count', value: '3' }]);
});
```

- [ ] **Step 4: Implement the pure rules**

Create a five-entry immutable size list with tile widths `112, 144, 184, 232, 288`, clamp wheel transitions to it, accept only `http:`, `https:`, `data:image/`, and `blob:` image URLs, parse object or JSON-string media values, and convert non-empty field values with `cellDisplayString`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx jest --runInBand tests/unit/asset-grid-presentation.test.ts`

Expected: PASS with all presentation-rule tests green.

- [ ] **Step 6: Commit**

```bash
git add src/components/libraries/utils/assetGridPresentation.ts tests/unit/asset-grid-presentation.test.ts
git commit -m "feat: add asset grid presentation rules"
```

### Task 2: Virtualized Explorer Grid

**Files:**
- Create: `src/components/libraries/components/LibraryAssetsGrid.tsx`
- Create: `src/components/libraries/components/LibraryAssetsGrid.module.css`
- Test: `tests/unit/asset-grid-wiring.test.ts`

**Interfaces:**
- Consumes: `rows: AssetRow[]`, `properties: PropertyConfig[]`, `sizeIndex: AssetGridSizeIndex`, `onSizeIndexChange`, `selectedRowIds`, `onSelectionChange`, and `onOpenAsset`.
- Produces: an accessible grid with `data-testid="library-assets-grid"` and items keyed by asset id.

- [ ] **Step 1: Write a failing static wiring test**

```ts
test('grid virtualizes rows, responds to wheel zoom, and uses the existing fallback icon', () => {
  const source = read('src/components/libraries/components/LibraryAssetsGrid.tsx');
  expect(source).toContain('useVirtualizer');
  expect(source).toContain('nextAssetGridSize');
  expect(source).toContain("@/assets/images/AssetTableIcon.svg");
  expect(source).toContain('data-testid="library-assets-grid"');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx jest --runInBand tests/unit/asset-grid-wiring.test.ts`

Expected: FAIL because `LibraryAssetsGrid.tsx` does not exist.

- [ ] **Step 3: Implement the grid component**

Measure container width with `ResizeObserver`, compute the number of columns from the active tile width, virtualize horizontal grid rows with `useVirtualizer`, and render only virtual rows. Each asset button renders an image preview or `AssetTableIcon.svg`, its display name, and metadata based on the active size level. Single click selects; double click and Enter open the existing detail drawer. `onWheel` calls `preventDefault()` and changes one size step per wheel gesture.

- [ ] **Step 4: Style the explorer**

Use a neutral white canvas, wrapping CSS grid rows, selected/hover focus states, square thumbnail wells, ellipsized names, and metadata visible only at larger size levels. Add a small bottom-right zoom indicator with minus/plus buttons and the percentage-like density label.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx jest --runInBand tests/unit/asset-grid-wiring.test.ts tests/unit/asset-grid-presentation.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/libraries/components/LibraryAssetsGrid.tsx src/components/libraries/components/LibraryAssetsGrid.module.css tests/unit/asset-grid-wiring.test.ts
git commit -m "feat: add virtualized asset explorer grid"
```

### Task 3: Grid/Table Integration and Verification

**Files:**
- Modify: `src/components/libraries/LibraryAssetsTable.tsx`
- Modify: `src/components/libraries/LibraryAssetsTable.module.css`
- Test: `tests/unit/asset-grid-wiring.test.ts`

**Interfaces:**
- Consumes: `LibraryAssetsGrid` from Task 2 and existing `displayRows`, `selectedRowIds`, `setSelectedRowIds`, `handleViewAssetDetail`, and `detailDrawerRowId` state.
- Produces: the library's grid-default/table-switchable content view.

- [ ] **Step 1: Extend the failing wiring test**

```ts
test('library table defaults to grid and retains the existing table branch', () => {
  const source = read('src/components/libraries/LibraryAssetsTable.tsx');
  expect(source).toContain("useState<'grid' | 'table'>('grid')");
  expect(source).toContain('<LibraryAssetsGrid');
  expect(source).toContain('aria-label="Grid view"');
  expect(source).toContain('aria-label="Table view"');
  expect(source).toContain('<LibraryAssetsTableBody');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx jest --runInBand tests/unit/asset-grid-wiring.test.ts`

Expected: FAIL because the parent has no grid/table view state.

- [ ] **Step 3: Wire the view into the parent**

Add `assetViewMode` and `assetGridSizeIndex` state. For normal table libraries, show two icon buttons above the content and branch between `LibraryAssetsGrid` and the existing `<table>`. Keep script libraries on their current script view. Pass `displayRows`, ordered properties, selection state, and detail-open callbacks into the grid. Keep filters and the detail drawer shared across both views.

- [ ] **Step 4: Add integration styling**

Add compact view-toggle styling to `LibraryAssetsTable.module.css`, keeping it within the existing table shell and ensuring the grid fills the same scrollable content area.

- [ ] **Step 5: Run verification**

Run: `npx jest --runInBand tests/unit/asset-grid-wiring.test.ts tests/unit/asset-grid-presentation.test.ts tests/unit/table-scalability-static.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/libraries/LibraryAssetsTable.tsx src/components/libraries/LibraryAssetsTable.module.css tests/unit/asset-grid-wiring.test.ts
git commit -m "feat: make asset explorer grid the default view"
```
