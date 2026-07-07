# GitHub Issues 147-168 Batch 7 Module Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix issue #147 with a low-risk decomposition slice that makes `LibraryDataContext.tsx` and `LibraryAssetsTable.tsx` thinner while preserving public APIs.

**Architecture:** Extract pure Yjs asset hydration and library timestamp side effects from `LibraryDataContext`. Extract table section/property grouping and script-column detection from `LibraryAssetsTable` into focused table structure helpers and a hook.

**Tech Stack:** Next.js, React 19, TypeScript, Jest, Yjs, Supabase.

## Global Constraints

- Commit after this batch; do not push.
- Preserve unrelated worktree changes.
- Keep `LibraryDataProvider`, `useLibraryData`, and `LibraryAssetsTable` public interfaces stable.
- Use focused helper tests before implementation.
- Do not redesign the table UI or change user-facing workflows.
- Translate touched developer comments to English when changing nearby code.

---

### Task 1: Extract Library Data Helpers

**Files:**
- Create: `src/lib/library/yjsAssetHydration.ts`
- Modify: `src/lib/library/updatedAt.ts`
- Modify: `src/lib/contexts/LibraryDataContext.tsx`
- Test: `tests/unit/library-module-decomposition-static.test.ts`
- Test: `tests/unit/yjs-asset-hydration.test.ts`
- Test: `tests/unit/library-updated-at-touch.test.ts`

**Interfaces:**
- Produces: `hydrateYAssetsFromRows(yDoc: Y.Doc, yAssets: Y.Map<Y.Map<unknown>>, rows: AssetRow[]): void`
- Produces: `hydrateYAssetsFromSnapshot(yDoc: Y.Doc, yAssets: Y.Map<Y.Map<unknown>>, snapshotData: LibrarySnapshotData): void`
- Produces: `touchLibraryUpdatedAt(supabase, libraryId, projectId?): Promise<void>`

- [ ] **Step 1: Write failing tests**

Add tests that assert Yjs row/snapshot hydration preserves names, property values, `created_at`, and `row_index`, and that the decomposition guard sees the new helper imports and smaller top-level context file.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:unit -- tests/unit/library-module-decomposition-static.test.ts tests/unit/yjs-asset-hydration.test.ts --runInBand`

Expected: FAIL because extracted helpers do not exist yet.

- [ ] **Step 3: Implement extraction**

Move duplicated Yjs row/snapshot population into `src/lib/library/yjsAssetHydration.ts`. Move the context-local library/folder/project updated-at side effect into `src/lib/library/updatedAt.ts`. Update `LibraryDataContext.tsx` to call the helpers.

- [ ] **Step 4: Verify focused data helpers**

Run: `npm run test:unit -- tests/unit/library-module-decomposition-static.test.ts tests/unit/yjs-asset-hydration.test.ts tests/unit/library-updated-at-touch.test.ts --runInBand`

Expected: PASS.

### Task 2: Extract Library Table Structure Helpers

**Files:**
- Create: `src/components/libraries/utils/tableStructure.ts`
- Create: `src/components/libraries/hooks/useLibraryTableStructure.ts`
- Modify: `src/components/libraries/LibraryAssetsTable.tsx`
- Test: `tests/unit/library-table-structure.test.ts`
- Test: `tests/unit/library-module-decomposition-static.test.ts`

**Interfaces:**
- Produces: `buildPropertyGroups(sections, properties): { groups, orderedProperties }`
- Produces: `detectScriptColumns(orderedProperties): { scriptColumns, hasScriptColumns }`
- Produces: `useLibraryTableStructure(sections, properties)`

- [ ] **Step 1: Write failing tests**

Add table-structure tests covering sorted section groups, ignored orphan properties, ordered properties, and Chinese/English script-column aliases.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:unit -- tests/unit/library-table-structure.test.ts tests/unit/library-module-decomposition-static.test.ts --runInBand`

Expected: FAIL because extracted helpers do not exist yet.

- [ ] **Step 3: Implement extraction**

Move the section/property grouping and script-column detection logic out of `LibraryAssetsTable.tsx` into the new utility and hook. Replace the inline `useMemo` blocks with `useLibraryTableStructure(sections, properties)`.

- [ ] **Step 4: Verify focused table helpers**

Run: `npm run test:unit -- tests/unit/library-table-structure.test.ts tests/unit/library-module-decomposition-static.test.ts --runInBand`

Expected: PASS.

### Task 3: Batch Verification And Commit

**Files:**
- All files touched by Tasks 1 and 2.

- [ ] **Step 1: Run focused verification**

Run: `npm run test:unit -- tests/unit/library-module-decomposition-static.test.ts tests/unit/yjs-asset-hydration.test.ts tests/unit/library-table-structure.test.ts tests/unit/library-updated-at-touch.test.ts --runInBand`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run lint:types`

Expected: PASS.

- [ ] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-github-issues-147-168-batch-7-module-decomposition.md src/lib/library/yjsAssetHydration.ts src/lib/library/updatedAt.ts src/lib/contexts/LibraryDataContext.tsx src/components/libraries/utils/tableStructure.ts src/components/libraries/hooks/useLibraryTableStructure.ts src/components/libraries/LibraryAssetsTable.tsx tests/unit/library-module-decomposition-static.test.ts tests/unit/yjs-asset-hydration.test.ts tests/unit/library-table-structure.test.ts tests/unit/library-updated-at-touch.test.ts
git commit -m "refactor: extract library table data helpers"
```
