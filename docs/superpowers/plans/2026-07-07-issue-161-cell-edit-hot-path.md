# Issue 161 Cell Edit Hot Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce per-cell edit database round trips by caching formula metadata, replacing timestamp fan-out writes with one RPC, and removing the fixed broadcast delay.

**Architecture:** Keep the hot-path behavior in `LibraryDataContext` but move cache and timestamp primitives into focused helpers under `src/lib/library`. The client performs one RPC for cell-edit timestamp updates; the migration owns the ancestor timestamp cascade.

**Tech Stack:** Next.js 16, React 18, Supabase JS 2, Postgres PL/pgSQL, Jest/ts-jest.

## Global Constraints

- Work sequentially from `specs/011-issue-161-cell-edit-hot-path/spec.md`.
- Do not start the next spec until PR #171 is green.
- Preserve persisted values and broadcast payload shapes.
- Cache formula metadata per library and invalidate on schema changes or library switch.
- Verify migration behavior through the gated `RLS_DB_TESTS` harness.

---

### Task 1: Formula Metadata Cache

**Files:**
- Create: `src/lib/library/formulaFieldMetaCache.ts`
- Modify: `src/lib/contexts/LibraryDataContext.tsx`
- Test: `tests/unit/formula-field-meta-cache.test.ts`

**Interfaces:**
- Consumes: `createFormulaFieldMetaCache(fetcher)` where `fetcher(libraryId)` returns `Promise<FormulaFieldMetaRow[]>`.
- Produces: `cache.get(libraryId)`, `cache.invalidate(libraryId)`, `cache.clear()`.

- [x] **Step 1: Write failing test**

```bash
npm run test:unit -- tests/unit/formula-field-meta-cache.test.ts --runInBand
```

Expected before implementation: fails because `@/lib/library/formulaFieldMetaCache` does not exist.

- [ ] **Step 2: Implement cache helper**

```ts
export function createFormulaFieldMetaCache<T>(
  fetcher: (libraryId: string) => Promise<T[]>
) {
  const entries = new Map<string, Promise<T[]>>();
  return {
    get(libraryId: string) {
      let entry = entries.get(libraryId);
      if (!entry) {
        entry = fetcher(libraryId).catch((error) => {
          entries.delete(libraryId);
          throw error;
        });
        entries.set(libraryId, entry);
      }
      return entry;
    },
    invalidate(libraryId: string) {
      entries.delete(libraryId);
    },
    clear() {
      entries.clear();
    },
  };
}
```

- [x] **Step 3: Wire cache into `LibraryDataContext`**

Use a provider-local `createFormulaFieldMetaCache(fetchFormulaFieldMeta)`, call `cache.get(libraryId)` from `getFormulaFieldMeta`, clear on `libraryId` switch, and invalidate on `schemaUpdated` events for the active library.

- [x] **Step 4: Verify cache test passes**

```bash
npm run test:unit -- tests/unit/formula-field-meta-cache.test.ts --runInBand
```

Expected: PASS.

### Task 2: Single Timestamp Touch RPC

**Files:**
- Create: `src/lib/library/updatedAt.ts`
- Create: `supabase/migrations/20260707010000_touch_library_asset_edit_updated_at.sql`
- Create: `tests/unit/database/library-asset-edit-touch.behavior.test.ts`
- Test: `tests/unit/library-updated-at-touch.test.ts`

**Interfaces:**
- Consumes: Supabase client with `rpc(name, args)`.
- Produces: `touchLibraryAssetEditUpdatedAt(supabase, { assetId, libraryId })`.

- [x] **Step 1: Write failing unit test**

```bash
npm run test:unit -- tests/unit/library-updated-at-touch.test.ts --runInBand
```

Expected before implementation: fails because `@/lib/library/updatedAt` does not exist.

- [x] **Step 2: Implement client helper**

Call one RPC named `touch_library_asset_edit_updated_at` with `{ p_asset_id, p_library_id }`, throw any RPC error, return the timestamp string or null.

- [x] **Step 3: Add migration**

Create a `security definer` PL/pgSQL function that verifies the asset belongs to the library, updates `library_assets.updated_at`, `libraries.updated_at`, parent `projects.updated_at`, optional parent `folders.updated_at`, and returns the asset timestamp.

- [x] **Step 4: Add gated behavior test**

Seed one asset in the existing RLS fixture, call the RPC as an editor, and assert asset/library/project timestamps advanced. The test is skipped unless `RLS_DB_TESTS=1` points to local Supabase.

- [x] **Step 5: Verify unit test passes**

```bash
npm run test:unit -- tests/unit/library-updated-at-touch.test.ts --runInBand
```

Expected: PASS.

### Task 3: Hot Path Wiring

**Files:**
- Modify: `src/lib/contexts/LibraryDataContext.tsx`
- Test: `tests/unit/library-data-hot-path-static.test.ts`

**Interfaces:**
- Consumes: `getFormulaFieldMeta()`, `touchLibraryAssetEditUpdatedAt(...)`, existing `broadcastCellUpdate(...)`.
- Produces: cell edits still persist the same values and broadcast the same payload values.

- [x] **Step 1: Write failing static test**

```bash
npm run test:unit -- tests/unit/library-data-hot-path-static.test.ts --runInBand
```

Expected before implementation: fails because `setTimeout(resolve, 100)` is present.

- [x] **Step 2: Replace asset + ancestor timestamp writes in `updateAssetField`**

Call `touchLibraryAssetEditUpdatedAt` once before the value upsert, preserving the existing server timestamp ordering for database change handlers. Keep the returned `serverUpdatedAt` passed to `broadcastCellUpdate`.

- [x] **Step 3: Remove fixed broadcast sleep**

Delete `await new Promise(resolve => setTimeout(resolve, 100));`; the persisted upsert and timestamp RPC are the awaited concrete dependencies.

- [x] **Step 4: Verify static test passes**

```bash
npm run test:unit -- tests/unit/library-data-hot-path-static.test.ts --runInBand
```

Expected: PASS.

### Task 4: Local Verification and PR Gate

**Files:**
- All files above.

**Interfaces:**
- Produces: one commit pushed to `git-issues-fix`, then PR #171 monitored until green.

- [x] **Step 1: Run focused tests**

```bash
npm run test:unit -- tests/unit/formula-field-meta-cache.test.ts tests/unit/library-updated-at-touch.test.ts tests/unit/library-data-hot-path-static.test.ts tests/unit/schema-updated-dispatch-static.test.ts tests/unit/database/library-asset-edit-touch-migration.test.ts tests/unit/database/library-asset-edit-touch.behavior.test.ts --runInBand
```

Expected locally without Supabase: PASS, with the RLS behavior suite skipped unless enabled.

- [x] **Step 2: Run build and lint**

```bash
npm run build
npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Commit and push**

```bash
git add docs/superpowers/plans/2026-07-07-issue-161-cell-edit-hot-path.md src/lib/library/formulaFieldMetaCache.ts src/lib/library/updatedAt.ts src/lib/contexts/LibraryDataContext.tsx 'src/app/(dashboard)/[projectId]/[libraryId]/page.tsx' src/components/libraries/components/TableHeader.tsx src/components/libraries/components/EditColumnModal.tsx supabase/migrations/20260707010000_touch_library_asset_edit_updated_at.sql tests/unit/formula-field-meta-cache.test.ts tests/unit/library-updated-at-touch.test.ts tests/unit/library-data-hot-path-static.test.ts tests/unit/database/library-asset-edit-touch.behavior.test.ts tests/unit/database/library-asset-edit-touch-migration.test.ts tests/unit/schema-updated-dispatch-static.test.ts
git commit -m "fix: optimize cell edit hot path"
git push
```

- [ ] **Step 4: Poll PR checks**

```bash
gh pr list --head git-issues-fix --base main --json number,state,url,headRefOid,statusCheckRollup
```

Expected: poll every 3 minutes; if any check fails, fix this spec's fallout before moving on.
