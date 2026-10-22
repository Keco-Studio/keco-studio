# Library Table Sort And Durable Undo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add display-only numeric sorting and 24-hour, per-user durable undo/redo for every mutation made from the document table UI.

**Architecture:** All document-table writes go through an authoritative Supabase RPC that records forward and inverse snapshots atomically. The browser owns only a non-persisted stack of returned operation IDs; undo and redo ask the RPC to apply validated snapshots. Media removals are recorded as deferred storage cleanup, not deleted by the browser.

**Tech Stack:** Next.js/React 19, TypeScript, Jest, Supabase Postgres RPCs, Supabase Storage.

**Spec:** `docs/superpowers/specs/2026-10-22-library-table-sort-undo-design.md`

## Global Constraints

- Operation journal entries expire exactly 24 hours after creation.
- A caller may undo or redo only their own non-expired operation.
- Browser refresh clears displayed undo/redo history; do not use localStorage or sessionStorage for stacks.
- Undo/redo must reject precondition conflicts without overwriting collaborator changes.
- Preserve original IDs and `row_index` when restoring rows or fields.
- Numeric sorting is display-only and never writes row order.
- Existing agent, script-system, sidebar, and other non-table mutation callers remain outside this feature.

---

### Task 1: Define Durable Operation Data And RPC Contract

**Files:**
- Create: `supabase/migrations/20261022020000_library_table_operations.sql`
- Create: `tests/unit/database/library-table-operations-migration.test.ts`
- Modify: `tests/unit/database/helpers/rlsTestClient.ts`

**Interfaces:**
- Produces `public.apply_library_table_operation(p_library_id uuid, p_operation jsonb) returns jsonb`.
- Produces `public.undo_library_table_operation(p_operation_id uuid) returns jsonb`.
- Produces `public.redo_library_table_operation(p_operation_id uuid) returns jsonb`.
- Produces `public.expire_library_table_operations(p_limit integer default 100) returns integer`, callable by `service_role` only.
- `p_operation` is `{ kind, forward, inverse, expected }`; the returned JSON is `{ operationId, kind, state, affectedAssetIds, schemaChanged }`.

- [ ] **Step 1: Write failing migration-contract tests.**

```ts
expect(migration).toContain('create table if not exists public.library_table_operations');
expect(migration).toContain("expires_at timestamptz not null default (now() + interval '24 hours')");
expect(migration).toContain('create or replace function public.apply_library_table_operation');
expect(migration).toContain('create or replace function public.undo_library_table_operation');
expect(migration).toContain('created_by = v_actor');
expect(migration).toContain("raise exception 'Table operation conflict' using errcode = '40001'");
```

- [ ] **Step 2: Run the migration-contract test and verify it fails because the migration is absent.**

Run: `npx jest --runInBand tests/unit/database/library-table-operations-migration.test.ts`

Expected: FAIL because `20261022020000_library_table_operations.sql` does not exist.

- [ ] **Step 3: Add the journal schema and security-definer RPC skeletons.**

```sql
create table if not exists public.library_table_operations (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  forward_payload jsonb not null,
  inverse_payload jsonb not null,
  expected_payload jsonb not null,
  state text not null default 'active' check (state in ('active', 'undone', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index library_table_operations_actor_active_idx
  on public.library_table_operations (created_by, library_id, state, created_at desc);
```

Use `auth.uid()`, lock the library with `FOR UPDATE`, check owner/editor/admin access through the existing helper predicates, and revoke `PUBLIC` access to each RPC before granting authenticated/service-role access as appropriate.

- [ ] **Step 4: Extend the RLS test fixture with an editor and a second editor operation helper.**

```ts
async function applyAsEditor(operation: Record<string, unknown>) {
  return fx.editor.client.rpc('apply_library_table_operation', {
    p_library_id: fx.libraryId,
    p_operation: operation,
  });
}
```

- [ ] **Step 5: Run migration-contract tests and typecheck the fixture.**

Run: `npx jest --runInBand tests/unit/database/library-table-operations-migration.test.ts && npm run typecheck`

Expected: PASS.

### Task 2: Implement Atomic Snapshot Apply, Undo, Redo, And Expiry

**Files:**
- Modify: `supabase/migrations/20261022020000_library_table_operations.sql`
- Modify: `tests/unit/database/library-table-operations-migration.test.ts`
- Create: `tests/unit/database/library-table-operations.behavior.test.ts`

**Interfaces:**
- `cells_updated` snapshots contain `{ assets: [{ id, name, rowIndex, values: [{ fieldId, value }] }] }` before and after values.
- `rows_created` and `rows_deleted` snapshots contain each original `library_assets` row and all `library_asset_values` rows.
- `field_created`, `field_updated`, and `field_deleted` snapshots contain original `library_field_definitions` metadata and dependent values.
- `rows_reordered` and `fields_reordered` snapshots contain the complete ordered ID list and expected current order.

- [ ] **Step 1: Add failing live-database tests for ownership, exact restoration, redo, and conflicts.**

```ts
const created = await applyAsEditor({
  kind: 'rows_deleted',
  forward: { rows: [rowSnapshot] },
  inverse: { rows: [rowSnapshot] },
  expected: { rowsPresent: [rowSnapshot.id] },
});
const undo = await fx.editor.client.rpc('undo_library_table_operation', {
  p_operation_id: created.data.operationId,
});
expect(undo.error).toBeNull();
expect(restored.id).toBe(rowSnapshot.id);
expect(restored.row_index).toBe(rowSnapshot.rowIndex);
await expect(secondEditorUndo(created.data.operationId)).rejects.toMatchObject({ code: '42501' });
```

- [ ] **Step 2: Run the live-database suite with `RLS_DB_TESTS=1` and verify it fails in the missing apply paths.**

Run: `RLS_DB_TESTS=1 npx jest --runInBand tests/unit/database/library-table-operations.behavior.test.ts`

Expected: FAIL because the RPC does not yet apply snapshots.

- [ ] **Step 3: Implement typed apply handlers in the migration.**

```sql
case v_kind
  when 'cells_updated' then perform public.apply_library_table_cell_snapshot(v_library.id, v_forward);
  when 'rows_created', 'rows_deleted' then perform public.apply_library_table_row_snapshot(v_library.id, v_forward);
  when 'field_created', 'field_updated', 'field_deleted' then perform public.apply_library_table_field_snapshot(v_library.id, v_forward);
  when 'rows_reordered' then perform public.apply_library_table_row_order(v_library.id, v_forward);
  when 'fields_reordered' then perform public.apply_library_table_field_order(v_library.id, v_forward);
  else raise exception 'Unsupported table operation' using errcode = '22023';
end case;
```

Use upserts that specify original IDs on restore, `FOR UPDATE` checks of every expected value/order before undo or redo, and change operation state only after the snapshot succeeds. Touch library/project/folder timestamps through the existing table mutation conventions.

- [ ] **Step 4: Implement expiration and deferred-media-path collection.**

```sql
update public.library_table_operations
set state = 'expired', forward_payload = jsonb_build_object('deferredMediaPaths', v_paths)
where id = v_operation.id and state in ('active', 'undone');
```

Do not call Storage from SQL. Return expired paths for a privileged server cleanup worker only after verifying no unexpired operation still references the same path.

- [ ] **Step 5: Add tests for field/value cascade restoration, redo, conflict rejection, and expired operations.**

```ts
expect((await fx.editor.client.rpc('redo_library_table_operation', {
  p_operation_id: operationId,
})).error).toBeNull();
expect(conflictingUndo.error?.code).toBe('40001');
expect(expiredUndo.error?.code).toBe('22023');
```

- [ ] **Step 6: Run the migration contract and live behavior suites.**

Run: `npm run test:unit:db -- --runInBand tests/unit/database/library-table-operations.behavior.test.ts tests/unit/database/library-table-operations-migration.test.ts`

Expected: PASS when the local Supabase test environment is available; otherwise report the required CI-gated suite separately.

### Task 3: Add Server-Side Deferred Media Cleanup

**Files:**
- Create: `src/lib/server/libraryTableOperationCleanup.ts`
- Create: `src/app/api/internal/library-table-operations/cleanup/route.ts`
- Create: `tests/unit/library-table-operation-cleanup.test.ts`
- Modify: `supabase/migrations/20261022020000_library_table_operations.sql`

**Interfaces:**
- Produces `cleanupExpiredLibraryTableOperations(limit?: number): Promise<{ expired: number; deletedPaths: string[] }>`.
- The internal route requires the existing scheduled-job service authentication convention and is never callable by browser users.
- The expiration RPC returns only paths released by the current cleanup batch.

- [ ] **Step 1: Write failing cleanup tests.**

```ts
await cleanupExpiredLibraryTableOperations();
expect(service.rpc).toHaveBeenCalledWith('expire_library_table_operations', { p_limit: 100 });
expect(bucket.remove).toHaveBeenCalledWith(['user/project/deleted.png']);
expect(service.rpc).toHaveBeenCalledWith('service_settle_project_storage_file_deletion', {
  p_bucket_id: 'library-media-files',
  p_object_path: 'user/project/deleted.png',
});
```

- [ ] **Step 2: Run the focused cleanup test and verify it fails because the cleanup module is absent.**

Run: `npx jest --runInBand tests/unit/library-table-operation-cleanup.test.ts`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement cleanup through the service Supabase client.**

```ts
const { data, error } = await service.rpc('expire_library_table_operations', { p_limit: limit });
if (error) throw new Error(error.message);
for (const path of data.releasedMediaPaths as string[]) {
  await service.storage.from('library-media-files').remove([path]);
  await service.rpc('service_settle_project_storage_file_deletion', {
    p_bucket_id: 'library-media-files', p_object_path: path,
  });
}
```

Treat absent storage objects as successfully cleaned, retain failed paths for retry, and ensure a cleanup request cannot expose journal data to an authenticated browser session.

- [ ] **Step 4: Run the cleanup test and relevant storage-accounting checks.**

Run: `npx jest --runInBand tests/unit/library-table-operation-cleanup.test.ts && npm run check:storage-writes`

Expected: PASS.

### Task 4: Build Client Operation Types, RPC Client, And Session Stack

**Files:**
- Create: `src/lib/services/libraryTableOperationsService.ts`
- Create: `src/components/libraries/hooks/useTableOperationHistory.ts`
- Create: `tests/unit/libraries/table-operation-history.test.tsx`
- Create: `tests/unit/library-table-operations-service.test.ts`

**Interfaces:**
- `applyLibraryTableOperation(supabase, libraryId, operation): Promise<TableOperationResult>`.
- `undoLibraryTableOperation(supabase, operationId): Promise<TableOperationResult>`.
- `redoLibraryTableOperation(supabase, operationId): Promise<TableOperationResult>`.
- `useTableOperationHistory` returns `{ record, undo, redo, canUndo, canRedo, clear }` and accepts callbacks that execute operation IDs.

- [ ] **Step 1: Write failing service and stack tests.**

```tsx
await result.current.record('op-1');
await result.current.undo();
expect(undoOperation).toHaveBeenCalledWith('op-1');
expect(result.current.canRedo).toBe(true);
await result.current.record('op-2');
expect(result.current.canRedo).toBe(false);
```

- [ ] **Step 2: Run the focused tests and verify they fail because the service and hook are absent.**

Run: `npx jest --runInBand tests/unit/library-table-operations-service.test.ts tests/unit/libraries/table-operation-history.test.tsx`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement typed RPC wrappers and the serialized in-memory ID stack.**

```ts
const { data, error } = await supabase.rpc('undo_library_table_operation', {
  p_operation_id: operationId,
});
if (error) throw toTableOperationError(error);
return parseTableOperationResult(data);
```

The hook must serialize undo/redo calls, move an ID only after a successful response, remove a conflict-failed ID, and contain no browser persistence API.

- [ ] **Step 4: Run focused tests and verify a remount starts empty.**

Run: `npx jest --runInBand tests/unit/library-table-operations-service.test.ts tests/unit/libraries/table-operation-history.test.tsx`

Expected: PASS.

### Task 5: Route Table Mutations Through One Gateway

**Files:**
- Create: `src/components/libraries/hooks/useLibraryTableMutationGateway.ts`
- Modify: `src/components/libraries/LibraryAssetsTable.tsx`
- Modify: `src/components/libraries/LibraryAssetsTableAdapter.tsx`
- Modify: `src/components/libraries/hooks/useCellEditing.ts`
- Modify: `src/components/libraries/hooks/useClipboardOperations.ts`
- Modify: `src/components/libraries/hooks/useBatchFill.ts`
- Modify: `src/components/libraries/hooks/useRowOperations.ts`
- Modify: `src/components/libraries/hooks/useFormulaCellCustomization.ts`
- Modify: `src/components/libraries/hooks/useMediaFileUpdate.ts`
- Modify: `src/components/libraries/hooks/useReferenceModal.ts`
- Modify: `src/components/libraries/components/TableHeader.tsx`
- Modify: `src/components/libraries/components/EditColumnModal.tsx`
- Create: `tests/unit/libraries/table-mutation-gateway.test.tsx`
- Modify: `tests/unit/library-media-clear.test.tsx`

**Interfaces:**
- `mutate(operation: TableOperationInput): Promise<TableOperationResult>` is the only table UI persistence entry point.
- On success, the gateway records the returned operation ID, refreshes changed schema or rows, and broadcasts existing realtime events from authoritative result data.
- `onSaveAsset` returns the created asset ID so row-create snapshots can use the original ID.

- [ ] **Step 1: Write failing gateway tests for exact before/after cell snapshots and every operation kind.**

```tsx
await result.current.mutate({
  kind: 'cells_updated',
  forward: { assets: [{ id: 'row-1', values: [{ fieldId: 'score', value: 4 }] }] },
  inverse: { assets: [{ id: 'row-1', values: [{ fieldId: 'score', value: 1 }] }] },
  expected: { assets: [{ id: 'row-1', values: [{ fieldId: 'score', value: 1 }] }] },
});
expect(record).toHaveBeenCalledWith('operation-1');
```

- [ ] **Step 2: Update the media-clear test to require no browser `deleteMediaFile` call.**

```tsx
await waitFor(() => expect(onMutate).toHaveBeenCalled());
expect(deleteMediaFile).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run gateway and media tests to verify they fail under direct writes.**

Run: `npx jest --runInBand tests/unit/libraries/table-mutation-gateway.test.tsx tests/unit/library-media-clear.test.tsx`

Expected: FAIL because the gateway is absent and media deletion remains direct.

- [ ] **Step 4: Implement the gateway and replace direct table writes.**

```ts
const result = await applyLibraryTableOperation(supabase, libraryId, input);
await refreshAssetsFromServer();
if (result.schemaChanged) {
  invalidateFormulaFieldMeta();
  await invalidateLibrarySchemaData(queryClient, { libraryId, refetchActiveSchema: true });
}
history.record(result.operationId);
return result;
```

Capture all selected rows/cells before updating optimistic state. Replace header/modal direct `updateLibraryField`, `deleteLibraryField`, and `reorderLibraryFields` calls with gateway inputs. Replace direct `deleteMediaFile` calls with deferred-media paths in the operation. Keep optimistic display behavior, but roll it back when the RPC fails.

- [ ] **Step 5: Run gateway, row, clipboard, media, formula, and column tests.**

Run: `npx jest --runInBand tests/unit/libraries/table-mutation-gateway.test.tsx tests/unit/library-media-clear.test.tsx tests/unit/library-field-rename-formula-sync.test.ts tests/unit/libraries/table-column-actions.test.tsx tests/unit/libraries/table-reorder.test.ts tests/unit/library-rich-clipboard.test.ts`

Expected: PASS.

### Task 6: Add Numeric Sorting, Undo/Redo Controls, And Keyboard Routing

**Files:**
- Create: `src/components/libraries/utils/tableNumericSorting.ts`
- Create: `src/components/libraries/hooks/useTableUndoShortcuts.ts`
- Modify: `src/components/libraries/LibraryAssetsTable.tsx`
- Modify: `src/components/libraries/components/TableHeader.tsx`
- Modify: `src/components/libraries/LibraryAssetsTable.module.css`
- Create: `tests/unit/libraries/table-numeric-sorting.test.ts`
- Create: `tests/unit/libraries/table-undo-shortcuts.test.tsx`

**Interfaces:**
- `sortRowsByNumericColumn(rows, fieldId, direction): AssetRow[]`.
- `NumericSortState` is `{ propertyId: string; direction: 'asc' | 'desc' } | null`.
- `useTableUndoShortcuts({ canUndo, canRedo, undo, redo, isTableFocused })` consumes only table-owned keyboard events.

- [ ] **Step 1: Write failing numeric sorting tests.**

```ts
expect(sortRowsByNumericColumn(rows, 'score', 'asc').map((row) => row.id))
  .toEqual(['negative', 'low', 'high', 'empty', 'invalid']);
expect(sortRowsByNumericColumn(rows, 'score', 'desc').map((row) => row.id))
  .toEqual(['high', 'low', 'negative', 'empty', 'invalid']);
```

- [ ] **Step 2: Write failing keyboard and header tests.**

```tsx
fireEvent.keyDown(table, { key: 'z', ctrlKey: true });
expect(undo).toHaveBeenCalledTimes(1);
fireEvent.keyDown(table, { key: 'z', ctrlKey: true, shiftKey: true });
expect(redo).toHaveBeenCalledTimes(1);
fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
expect(undo).toHaveBeenCalledTimes(1);
```

- [ ] **Step 3: Run the focused tests and verify they fail because sorter and shortcut hook are absent.**

Run: `npx jest --runInBand tests/unit/libraries/table-numeric-sorting.test.ts tests/unit/libraries/table-undo-shortcuts.test.tsx`

Expected: FAIL with module-not-found.

- [ ] **Step 4: Implement stable sorting and three-state numeric headers.**

```ts
return rows
  .map((row, index) => ({ row, index, value: Number(row.propertyValues[fieldId]) }))
  .sort((a, b) => {
    const aValid = Number.isFinite(a.value);
    const bValid = Number.isFinite(b.value);
    if (aValid !== bValid) return aValid ? -1 : 1;
    return aValid && a.value !== b.value
      ? direction === 'asc' ? a.value - b.value : b.value - a.value
      : a.index - b.index;
  })
  .map(({ row }) => row);
```

Compose sorting after `useColumnValueFilters`. Add icon-only undo/redo controls with accessible labels and disabled state. Keyboard routing must reject document-level commands unless focus is within the table and let active native editor history win.

- [ ] **Step 5: Run focused UI tests.**

Run: `npx jest --runInBand tests/unit/libraries/table-numeric-sorting.test.ts tests/unit/libraries/table-undo-shortcuts.test.tsx tests/unit/libraries/table-reorder.test.ts`

Expected: PASS and no call to persisted row-order APIs from sort controls.

### Task 7: Verify, Review, And Commit The Repair

**Files:**
- Modify: all scoped implementation and test files from Tasks 1-6.

- [ ] **Step 1: Run the complete targeted suite.**

Run: `npx jest --runInBand tests/unit/database/library-table-operations-migration.test.ts tests/unit/database/library-table-operations.behavior.test.ts tests/unit/library-table-operation-cleanup.test.ts tests/unit/library-table-operations-service.test.ts tests/unit/libraries/table-operation-history.test.tsx tests/unit/libraries/table-mutation-gateway.test.tsx tests/unit/libraries/table-numeric-sorting.test.ts tests/unit/libraries/table-undo-shortcuts.test.tsx tests/unit/library-media-clear.test.tsx tests/unit/libraries/table-column-actions.test.tsx tests/unit/libraries/table-reorder.test.ts`

Expected: PASS, with the RLS behavior suite reported as CI-gated if `RLS_DB_TESTS` is not enabled locally.

- [ ] **Step 2: Run static validation.**

Run: `npm run lint && npm run typecheck && npm run check:storage-writes && git diff --check`

Expected: PASS. Investigate any new failure before proceeding; report unrelated pre-existing failures separately.

- [ ] **Step 3: Perform an implementation review against the spec.**

Verify every table mutation entry point uses the gateway, snapshots preserve IDs, no client-side immediate media deletion remains, and sort state cannot mutate `row_index`.

- [ ] **Step 4: Commit only scoped files.**

```bash
git add docs/superpowers/specs/2026-10-22-library-table-sort-undo-design.md \
  docs/superpowers/plans/2026-10-22-library-table-sort-undo.md \
  supabase/migrations/20261022020000_library_table_operations.sql \
  src/lib/services/libraryTableOperationsService.ts \
  src/components/libraries \
  src/lib/server/libraryTableOperationCleanup.ts \
  src/app/api/internal/library-table-operations/cleanup/route.ts \
  tests/unit
git commit -m "fix: add durable library table undo and numeric sorting"
```

Do not stage unrelated game-design-system or GDD migration files present in the working tree.
