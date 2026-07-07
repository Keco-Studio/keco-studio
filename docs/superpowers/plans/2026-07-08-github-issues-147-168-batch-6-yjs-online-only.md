# GitHub Issues 147-168 Batch 6 Yjs Online Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix issue #160 by removing misleading Yjs IndexedDB persistence while keeping the existing in-memory Yjs table state.

**Architecture:** `LibraryDataContext` remains the single online data bridge from Supabase/Realtime into an in-memory Yjs map. `YjsContext` remains an in-memory row-order helper for the table. No live code should create `y-indexeddb` persistence stores or claim offline-edit merge support.

**Tech Stack:** Next.js, React 19, TypeScript, Jest, Yjs, Supabase Realtime.

## Global Constraints

- Commit after this batch; do not push.
- Preserve unrelated worktree changes.
- Keep Yjs in memory for current table state; do not attempt a full table refactor in this batch.
- Remove `y-indexeddb` from production dependencies when no live imports remain.
- Use tests before implementation and run fresh verification before claiming completion.

---

### Task 1: Remove Yjs IndexedDB Persistence

**Files:**
- Create: `tests/unit/yjs-online-only-static.test.ts`
- Modify: `src/lib/contexts/LibraryDataContext.tsx`
- Modify: `src/lib/contexts/YjsContext.tsx`
- Delete: `src/lib/yjs/persistence.ts`
- Delete: `tests/unit/yjs-persistence-reset.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `getLibraryAssetsWithProperties(supabase, libraryId): Promise<AssetRow[]>`
- Produces: `loadInitialData()` still repopulates in-memory `yAssets` from Supabase rows.
- Produces: `YjsProvider` still exposes `{ ydoc, yRows, isConnected }`, with `isConnected` meaning the in-memory document is ready.

- [ ] **Step 1: Write the failing static test**

Create `tests/unit/yjs-online-only-static.test.ts` with assertions that live source no longer imports `y-indexeddb`, no longer uses `IndexeddbPersistence`, no longer calls `repopulateWithResetPersistence`, no longer uses `library-${libraryId}` or `asset-table-${libraryId}` IndexedDB persistence names, and no longer depends on `y-indexeddb` in `package.json`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/yjs-online-only-static.test.ts --runInBand`

Expected: FAIL because the current code still imports and depends on `y-indexeddb`.

- [ ] **Step 3: Remove the persistence path**

In `LibraryDataContext.tsx`, remove `IndexeddbPersistence`, `repopulateWithResetPersistence`, `libraryPersistenceName`, and `yPersistenceRef`. `loadInitialData()` should fetch rows and directly transact over `yAssets.clear()` plus the existing row population logic, then set `isSynced` to true when the in-memory state is loaded. The initial load effect should call `loadInitialData()` once auth is ready and no longer wait for IndexedDB.

In `YjsContext.tsx`, remove `IndexeddbPersistence` and the persistence effect. Use an effect that marks the in-memory doc ready for the current `libraryId`.

Delete `src/lib/yjs/persistence.ts` and the obsolete persistence-reset test.

- [ ] **Step 4: Remove dependency**

Run: `npm uninstall y-indexeddb`

Expected: `package.json` and `package-lock.json` remove `y-indexeddb` and its now-unused transitive persistence packages.

- [ ] **Step 5: Run focused verification**

Run: `npm run test:unit -- tests/unit/yjs-online-only-static.test.ts --runInBand`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run lint:types`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-github-issues-147-168-batch-6-yjs-online-only.md tests/unit/yjs-online-only-static.test.ts src/lib/contexts/LibraryDataContext.tsx src/lib/contexts/YjsContext.tsx src/lib/yjs/persistence.ts tests/unit/yjs-persistence-reset.test.ts package.json package-lock.json
git commit -m "fix: remove misleading yjs indexeddb persistence"
```
