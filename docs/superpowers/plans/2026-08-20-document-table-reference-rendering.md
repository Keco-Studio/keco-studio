# Document Table Reference Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render consecutive document table-row references as one linked, readable table while preserving the existing MDX/Yjs reference schema and document-reference chips.

**Architecture:** Extend the existing resolver result with the structured table and row data it already fetches. A focused DOM grouping helper identifies maximal whitespace-separated same-library runs inside one editor block; the first occurrence projects the group as an ARIA table and later occurrences suppress duplicate visuals without changing persisted nodes.

**Tech Stack:** TypeScript, React, Next.js `Link`, MDXEditor/Lexical decorators, TanStack Query, Jest, CSS Modules.

---

### Task 1: Preserve structured table data during resolution

**Files:**
- Modify: `src/lib/documents/resourceReferenceService.ts`
- Test: `tests/unit/documents/resource-reference-service.test.ts`

- [x] **Step 1: Write a failing resolver assertion**

Extend the current-project table target test to require this additional result shape:

```ts
table: {
  libraryId: LIBRARY_ID,
  name: 'Characters',
  href: `/${PROJECT_ID}/${LIBRARY_ID}`,
  fields: [{ id: FIELD_ID, label: 'Status' }],
  row: {
    assetId: ASSET_ID,
    name: 'Ada',
    values: { [FIELD_ID]: 'Active' },
  },
}
```

- [x] **Step 2: Verify the assertion fails**

Run: `npm run test:unit -- --runInBand tests/unit/documents/resource-reference-service.test.ts`

Expected: FAIL because `ResolvedResourceReference` does not expose `table`.

- [x] **Step 3: Add the structured result contract**

Add `ResolvedTableRowReference` and an optional `table` property to `ResolvedResourceReference`, then populate it in `resolveTableReferences` from `library`, ordered `libraryFields`, `asset`, and `rowValues`. Keep `label`, `contextLabel`, and the row-level `href` unchanged.

- [x] **Step 4: Verify resolver behavior**

Run: `npm run test:unit -- --runInBand tests/unit/documents/resource-reference-service.test.ts`

Expected: PASS, including unavailable and cross-project cases.

### Task 2: Group consecutive same-table reference occurrences

**Files:**
- Create: `src/components/documents/useTableReferenceGroup.ts`
- Create: `tests/unit/documents/table-reference-group.test.ts`
- Modify: `src/components/documents/ResourceReferenceProvider.tsx`
- Modify: `tests/unit/documents/resource-reference-provider.test.tsx`

- [x] **Step 1: Write failing DOM grouping tests**

Cover whitespace-separated references, prose separators, different libraries, different blocks, duplicate keys, and promotion of the second occurrence when the first is removed. Each marked occurrence uses:

```html
<span data-resource-reference-kind="table-row"
      data-resource-reference-key="..."
      data-resource-reference-library-id="..."></span>
```

- [x] **Step 2: Verify grouping tests fail**

Run: `npm run test:unit -- --runInBand tests/unit/documents/table-reference-group.test.ts`

Expected: FAIL because `findTableReferenceGroup` does not exist.

- [x] **Step 3: Implement the DOM adapter and hook**

Implement `findTableReferenceGroup(element)` using the nearest paragraph/list/heading/table-cell block, DOM order, library IDs, and a DOM `Range` whitespace check. Implement `useTableReferenceGroup` with a callback ref and layout effect; it returns the ordered occurrence keys and whether the current occurrence is primary.

- [x] **Step 4: Expose provider grouping inputs**

Return the provider's complete resolved map and a registration revision from `useResourceReference`. The revision must count mounted occurrences, so duplicate mounts and unmounts trigger regrouping without changing resolver deduplication.

- [x] **Step 5: Verify grouping and provider tests**

Run: `npm run test:unit -- --runInBand tests/unit/documents/table-reference-group.test.ts tests/unit/documents/resource-reference-provider.test.tsx`

Expected: PASS.

### Task 3: Render grouped references as an accessible table

**Files:**
- Modify: `src/components/documents/ResourceReferenceEditor.tsx`
- Modify: `src/components/documents/MdxDocumentEditor.module.css`
- Modify: `tests/unit/documents/resource-reference-editor.test.tsx`

- [x] **Step 1: Write failing component expectations**

Test a single structured row, multiple ordered rows with one projection, blank/complex cell formatting, partial unavailable rows, and unchanged loading/all-unavailable/document-reference chips. Mock the grouping hook explicitly so server rendering is deterministic.

- [x] **Step 2: Verify component expectations fail**

Run: `npm run test:unit -- --runInBand tests/unit/documents/resource-reference-editor.test.tsx`

Expected: FAIL because table-row references still render chips.

- [x] **Step 3: Implement table projection**

Mark table-row containers with stable data attributes. When any grouped result has structured data, render the table name link followed by an ARIA `table`/`row`/`columnheader`/`cell` grid from ordered fields and occurrence order. Use `cellDisplayString`, render a spanning unavailable row for missing occurrences, and suppress later projections. Preserve every existing chip branch for non-table and fallback states.

- [x] **Step 4: Add restrained table styling**

Add CSS module classes for a full-width inline-block projection, linked table title, horizontally scrollable grid, stable minimum column widths, bordered cells, muted header fill, wrapped cell text, focus states, and hidden duplicate projections.

- [x] **Step 5: Verify component behavior**

Run: `npm run test:unit -- --runInBand tests/unit/documents/resource-reference-editor.test.tsx`

Expected: PASS.

### Task 4: Remove the superseded GDD implementation and verify

**Files:**
- Restore: `src/lib/gdd-generation/tableResources.ts`
- Restore: `src/lib/gdd-generation/tableResources.test.ts`
- Delete: `docs/superpowers/specs/2026-08-20-gdd-table-reference-rendering-design.md`
- Delete: `docs/superpowers/plans/2026-08-20-gdd-table-reference-rendering.md`

- [x] **Step 1: Remove only the task-owned incorrect work**

Restore `renderTableReferences` to its original linked metadata-list output and remove the two untracked GDD-specific documents. Do not touch the concurrent GDD v2/dialogue files.

- [x] **Step 2: Run focused regressions**

Run:

```bash
npm run test:unit -- --runInBand \
  tests/unit/documents/resource-reference-service.test.ts \
  tests/unit/documents/table-reference-group.test.ts \
  tests/unit/documents/resource-reference-provider.test.tsx \
  tests/unit/documents/resource-reference-editor.test.tsx \
  src/lib/gdd-generation/tableResources.test.ts
npx tsc --noEmit
npx eslint src/lib/documents/resourceReferenceService.ts \
  src/components/documents/ResourceReferenceProvider.tsx \
  src/components/documents/useTableReferenceGroup.ts \
  src/components/documents/ResourceReferenceEditor.tsx \
  tests/unit/documents/resource-reference-service.test.ts \
  tests/unit/documents/table-reference-group.test.ts \
  tests/unit/documents/resource-reference-provider.test.tsx \
  tests/unit/documents/resource-reference-editor.test.tsx
```

Expected: all focused tests, TypeScript, and lint pass. Any unrelated pre-existing failure must be reported and excluded from the commit only if it is outside these files.

- [x] **Step 3: Review and commit only owned paths**

Inspect `git diff` and `git status`, stage the plan plus implementation/test/style files, and commit with:

```bash
git commit -m "feat: render document table references"
```
