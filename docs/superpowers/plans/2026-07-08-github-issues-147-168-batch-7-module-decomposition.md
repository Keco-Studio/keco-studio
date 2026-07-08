# GitHub Issues 147-168 Batch 7 Module Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Acceptance authority:** This plan executes Batch 7 (#147) of `docs/superpowers/specs/2026-07-08-github-issues-147-160-168-completion-spec.md`. That spec owns the acceptance criteria (AC-147-1..7) and the anti-gaming red lines. This plan may not weaken any threshold defined there. Run Batch 6 (#160) before this plan, since it deletes Yjs code this plan would otherwise relocate.

**Goal:** Fix issue #147 by decomposing `LibraryAssetsTable.tsx` to **≤ 1300 lines** (from 2229) and `LibraryDataContext.tsx` to **≤ 650 lines** (from 1129), matching the ~40% Sidebar precedent the issue cites, while preserving public APIs (AC-147-1, AC-147-2, AC-147-6).

**Architecture:** Extract in verified slices, each its own commit (AC-147-7):
- Pure helpers already scoped: Yjs asset hydration + library timestamp side effects out of `LibraryDataContext`; table section/property grouping + script-column detection out of `LibraryAssetsTable`.
- Logic clusters (the bulk of the reduction): asset mutation orchestration and realtime event handlers and reference-sync out of `LibraryDataContext` into focused hooks (AC-147-4); JSX render body and section-edit / find-replace handler clusters out of `LibraryAssetsTable` into subview components and hooks (AC-147-5).
Top-level files become composition surfaces.

**Tech Stack:** Next.js, React 19, TypeScript, Jest, Yjs, Supabase.

## Global Constraints

- Commit after each slice; do not push. Do not close GitHub issues (manual step for the user).
- Preserve unrelated worktree changes.
- Keep `LibraryDataProvider`, `useLibraryData`, and `LibraryAssetsTable` public interfaces stable until a dedicated caller-migration step (AC-147-6).
- Use focused helper tests before implementation.
- Do not redesign the table UI or change user-facing workflows.
- Translate touched developer comments to English when changing nearby code.
- **Anti-gaming red lines (spec Non-Negotiable Constraints):** do not delete tests or inflate `.skip`/`.todo` counts to pass; do not add `@ts-ignore` / `@ts-expect-error` / `eslint-disable` / `: any` / `as any` in touched files; do not comment out live code — extraction *moves* code, it does not stub it. Record the pre-batch skip-count baseline in the completion note.
- **Final size targets are hard gates:** `LibraryAssetsTable.tsx` ≤ 1300 lines, `LibraryDataContext.tsx` ≤ 650 lines. If a target is infeasible without behavior change, amend the completion spec with rationale rather than shipping under it.

---

### Task 0: Rewrite The Decomposition Guard Test (TDD anchor — do first)

The existing `tests/unit/library-module-decomposition-static.test.ts` is broken: it
asserts `LibraryDataContext.tsx < 1060` and `LibraryAssetsTable.tsx < 2150` (both
already pass with no work), and it asserts pre-existing files (`SectionTabs.tsx`,
`LibraryTableTopBar.tsx`, `ViewerBanner.tsx`) exist as if they were this batch's
output. Fix the bar before refactoring, so it locks the target and fails now.

**Files:**
- Modify: `tests/unit/library-module-decomposition-static.test.ts`

- [ ] **Step 1: Rewrite the guard assertions**

  - Set the size gates to the spec thresholds (AC-147-1/2): `LibraryAssetsTable.tsx`
    line count `< 1301`, `LibraryDataContext.tsx` line count `< 651`.
  - Remove all `existsSync` assertions for files that predate this batch. Replace
    with assertions that (a) the newly extracted units exist AND (b) the moved
    logic is no longer inline in the top-level file — e.g.
    `expect(dataContextSource).not.toContain('const updateAssetField = useCallback')`
    and the equivalent for realtime handlers and the JSX subview blocks (AC-147-3).
  - Add anti-gaming static gates (spec red lines): assert no new
    `@ts-ignore` / `@ts-expect-error` / `eslint-disable` / `as any` / `: any` in the
    two top-level files, and keep the `not.toContain` useMemo assertions.

- [ ] **Step 2: Run to verify it FAILS now**

  Run: `npm run test:unit -- tests/unit/library-module-decomposition-static.test.ts --runInBand`

  Expected: FAIL — the files are still 2143 / 1022 lines and the logic is still inline. This failing test is the anchor for Tasks 1–5.

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

> **Note:** Tasks 1 and 2 extract only pure helpers and do NOT reach the size gates on their own. Tasks 3–5 do the bulk reduction and are required for AC-147-1/2. Each task below is its own commit (AC-147-7); run typecheck + `lint:types` + the guard test after each, all green, before the next.

### Task 3: Extract Library Data Context Logic Clusters (AC-147-4)

**Files:**
- Create: `src/components/libraries/hooks/useLibraryAssetMutations.ts`
- Create: `src/components/libraries/hooks/useLibraryRealtimeHandlers.ts`
- Create: `src/lib/library/referenceSync.ts`
- Modify: `src/lib/contexts/LibraryDataContext.tsx`
- Test: `tests/unit/library-asset-mutations.test.ts` (focused, where a practical surface exists)
- Test: `tests/unit/library-module-decomposition-static.test.ts`

**Interfaces (keep provider public API identical — AC-147-6):**
- Produces: `useLibraryAssetMutations(...)` owning `updateAssetField`, `updateAssetName`, `createAsset`, `deleteAsset`, `updateMultipleFields`, `updateAssetsBatch`.
- Produces: `useLibraryRealtimeHandlers(...)` owning `handleCellUpdateEvent`, `handleAssetCreateEvent`, `handleAssetDeleteEvent`, `handleConflictEvent`, `handleRowOrderChangeEvent`, `handleCellsBatchUpdateEvent`.
- Produces: `applyReferenceSyncToLocalState` / `syncReferencesAfterSourceChange` helpers.

- [ ] **Step 1:** Extract mutation orchestration into `useLibraryAssetMutations`; the provider calls the hook and re-exposes the same context values. Commit.
- [ ] **Step 2:** Extract realtime handlers into `useLibraryRealtimeHandlers`; wire into the existing realtime config. Commit.
- [ ] **Step 3:** Extract reference-sync into `referenceSync.ts`. Commit.
- [ ] **Step 4:** Verify — guard test shows `LibraryDataContext.tsx` `< 651` and the `not.toContain('const updateAssetField = useCallback')` assertion passes; typecheck + lint:types green.

Run: `npm run test:unit -- tests/unit/library-module-decomposition-static.test.ts tests/unit/library-asset-mutations.test.ts --runInBand`

Expected: PASS, and `LibraryDataContext.tsx` ≤ 650 lines.

### Task 4: Extract Library Assets Table Render Subviews (AC-147-5)

**Files:**
- Create subviews under `src/components/libraries/components/` for the JSX render body (currently ~lines 1600–2140): table body / row rendering and the detail-drawer wiring. Reuse existing subview components where present rather than duplicating.
- Modify: `src/components/libraries/LibraryAssetsTable.tsx`
- Test: `tests/unit/library-module-decomposition-static.test.ts`

- [ ] **Step 1:** Extract the largest JSX block (table body / rows) into a subview component, passing the needed props. Commit.
- [ ] **Step 2:** Extract remaining render clusters (drawer/detail panel wiring) into subviews. Commit.
- [ ] **Step 3:** Verify — guard test shows `LibraryAssetsTable.tsx` trending toward `< 1301`; typecheck + lint:types green; existing library table tests stay green.

### Task 5: Extract Library Assets Table Handler Clusters (AC-147-5)

**Files:**
- Create: `src/components/libraries/hooks/useLibrarySectionEditing.ts`
- Create: `src/components/libraries/hooks/useLibraryTableFindReplaceWiring.ts`
- Modify: `src/components/libraries/LibraryAssetsTable.tsx`
- Test: `tests/unit/library-module-decomposition-static.test.ts`

- [ ] **Step 1:** Move section-editing handlers (`handleSectionEditStart/End`, `handleSelectSection`, `handleAddSectionFromTabs`, related refs/state) into `useLibrarySectionEditing`. Commit.
- [ ] **Step 2:** Move find/replace highlight/scroll handlers into `useLibraryTableFindReplaceWiring`. Commit.
- [ ] **Step 3:** Verify — guard test shows `LibraryAssetsTable.tsx` `< 1301`; typecheck + lint:types green.

Run: `npm run test:unit -- tests/unit/library-module-decomposition-static.test.ts --runInBand`

Expected: PASS, and `LibraryAssetsTable.tsx` ≤ 1300 lines.

### Task 6: Batch Verification And Final Note

**Files:**
- All files touched by Tasks 0–5.

- [ ] **Step 1: Run focused verification**

Run: `npm run test:unit -- tests/unit/library-module-decomposition-static.test.ts tests/unit/yjs-asset-hydration.test.ts tests/unit/library-table-structure.test.ts tests/unit/library-updated-at-touch.test.ts tests/unit/library-asset-mutations.test.ts --runInBand`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run lint:types`

Expected: PASS.

- [ ] **Step 2: Confirm acceptance and record evidence**

  - `LibraryAssetsTable.tsx` ≤ 1300, `LibraryDataContext.tsx` ≤ 650 (paste `wc -l`).
  - `LibraryDataProvider` / `useLibraryData` / `LibraryAssetsTable` public signatures unchanged (AC-147-6).
  - Skip count did not rise vs. the Task 0 baseline; no new suppressions introduced.
  - Paste the command output + pass/skip counts into this note.

- [ ] **Step 3: Final commit**

The per-task commits above already cover the code. Ensure the working tree is clean and this plan file is committed. Do not push. Do not close the GitHub issue — that is the user's manual step after review.
