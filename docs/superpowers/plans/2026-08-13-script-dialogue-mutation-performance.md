# Script Dialogue Mutation Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce normal Script dialogue add/delete to one Supabase RPC and update the visible script from React Query cache without waiting for a full-library refetch.

**Architecture:** Add transactional authenticated PostgreSQL functions for insert/delete, expose them through typed client mutation helpers, and make the Script editor apply returned rows to its asset query cache immediately. Keep generic table CRUD and undo/redo unchanged; schedule reconciliation refetches in the background.

**Tech Stack:** Next.js, TypeScript, Supabase PostgreSQL RPC, React Query, Jest.

---

### Task 1: Lock the client RPC contract with failing tests

**Files:**
- Create: `src/lib/script-system/scriptDialogueRpc.test.ts`
- Create: `src/lib/script-system/scriptDialogueRpc.ts`

- [x] **Step 1: Write failing tests for one-call insert/delete wrappers and cache transforms**

```ts
it('inserts a dialogue block through one RPC and returns typed rows', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: {
    action_row: { id: 'a2', library_id: 'lib', name: 'Hero', row_index: 2, property_values: { type: '3' } },
    speech_row: { id: 's2', library_id: 'lib', name: 'Hero', row_index: 3, property_values: { type: '1' } },
    action_row_index: 2,
  }, error: null });
  const result = await insertScriptDialogueBlock({
    supabase: { rpc } as never, libraryId: 'lib', afterRowId: 'a1', speaker: 'Hero',
    speechType: '1', fields: { typeKey: 'type', nameKey: 'name', contentKey: 'content' },
  });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(result.speechRowId).toBe('s2');
});

it('deletes a block through one RPC', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: { deleted_ids: ['a2', 's2'] }, error: null });
  await deleteScriptDialogueBlock({ supabase: { rpc } as never, libraryId: 'lib', actionRowId: 'a2', speechRowId: 's2' });
  expect(rpc).toHaveBeenCalledWith('delete_script_dialogue_block', expect.any(Object));
});

it('applies returned insert rows and removes deleted rows without refetching', () => {
  const rows = [{ id: 'a1', libraryId: 'lib', name: 'Old', propertyValues: {}, rowIndex: 1 }];
  expect(applyInsertedDialogueRows(rows, {
    actionRow: { id: 'a2', libraryId: 'lib', name: 'Hero', propertyValues: {}, rowIndex: 2 },
    speechRow: { id: 's2', libraryId: 'lib', name: 'Hero', propertyValues: {}, rowIndex: 3 },
    actionRowIndex: 2,
  })).toHaveLength(3);
  expect(removeDeletedDialogueRows([...rows, { id: 's2', libraryId: 'lib', name: 'Hero', propertyValues: {}, rowIndex: 2 }], ['s2'])).toHaveLength(1);
});
```

- [x] **Step 2: Run the focused test and verify it fails because the wrappers do not exist**

Run: `npx jest src/lib/script-system/scriptDialogueRpc.test.ts --runInBand`

Expected: FAIL with missing exports from `scriptDialogueRpc.ts`.

- [x] **Step 3: Implement the typed RPC wrappers and pure cache transforms**

Define `insertScriptDialogueBlock`, `deleteScriptDialogueBlock`,
`applyInsertedDialogueRows`, and `removeDeletedDialogueRows`. The insert wrapper calls
`supabase.rpc('insert_script_dialogue_block', { p_library_id, p_after_row_id,
p_speaker, p_speech_type, p_type_field_id, p_name_field_id, p_content_field_id })`.
Throw on a non-null RPC error. Preserve returned `AssetRow` fields and sort cache rows
by `rowIndex` after each transform.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npx jest src/lib/script-system/scriptDialogueRpc.test.ts --runInBand`

Expected: PASS.

### Task 2: Add transactional database RPCs

**Files:**
- Create: `supabase/migrations/20260813110000_script_dialogue_mutation_rpc.sql`
- Create: `tests/unit/script-dialogue-mutation-rpc-static.test.ts`

- [x] **Step 1: Write failing static contract assertions**

Assert the migration contains both function names, `auth.uid()`, owner/editor/admin
authorization, explicit `search_path`, `REVOKE ALL`, grants to `authenticated`, field
ownership checks, one insert of both action/speech rows, and one `DELETE ... IN` path.

- [x] **Step 2: Run the static test and verify it fails because the migration is absent**

Run: `npx jest tests/unit/script-dialogue-mutation-rpc-static.test.ts --runInBand`

Expected: FAIL because the migration file cannot be read.

- [x] **Step 3: Implement the insert RPC**

Use `SECURITY DEFINER`, `SET search_path = public`, reject null `auth.uid()`, resolve
library project/folder, require `is_project_owner(...) OR is_editor_or_admin_collaborator(...)`,
validate all field IDs belong to the library, lock rows with `FOR UPDATE`, normalize
indexes when needed, shift following indexes, insert two assets, insert six-or-fewer
non-empty property values in one statement, touch ancestor timestamps once, and return
the two complete rows plus `action_row_index` as JSON.

- [x] **Step 4: Implement the delete RPC**

Validate at least one row ID, validate both IDs belong to the requested library,
authorize once, delete matching asset IDs in one statement (asset values and embedding
chunks continue to cascade/trigger), touch ancestor timestamps once, and return
`deleted_ids`.

- [x] **Step 5: Run the static test and verify it passes**

Run: `npx jest tests/unit/script-dialogue-mutation-rpc-static.test.ts --runInBand`

Expected: PASS.

### Task 3: Wire add/delete to one RPC and immediate cache updates

**Files:**
- Modify: `src/components/script-system/useScriptDialogueEditor.ts`
- Modify: `src/lib/script-system/scriptDialogueMutations.ts`
- Modify: `src/lib/script-system/scriptDialogueMutations.rollback.test.ts`
- Modify: `src/components/script-system/useScriptDialogueEditor.test.ts`

- [x] **Step 1: Add failing editor tests**

Mock the RPC wrappers and query client. Assert add/delete update cached rows immediately,
record history only after success, and return before a deferred `invalidateQueries`
promise resolves. Assert RPC rejection leaves the cached rows unchanged.

- [x] **Step 2: Run focused editor tests and verify the new expectations fail**

Run: `npx jest src/components/script-system/useScriptDialogueEditor.test.ts src/lib/script-system/scriptDialogueMutations.rollback.test.ts --runInBand`

Expected: FAIL on the new one-RPC and non-blocking-refresh assertions.

- [x] **Step 3: Replace normal insert/delete service calls**

Call the typed RPC wrappers from `insertAfterBlock` and `deleteBlock`. Apply the pure
cache transforms with `queryClient.setQueryData` before scheduling
`void queryClient.invalidateQueries(...)`. Keep the existing error toast and refresh
fallback only for failed mutations.

- [x] **Step 4: Run focused tests and verify they pass**

Run: `npx jest src/components/script-system/useScriptDialogueEditor.test.ts src/lib/script-system/scriptDialogueMutations.rollback.test.ts src/lib/script-system/scriptDialogueRpc.test.ts --runInBand`

Expected: PASS.

### Task 4: Regression verification and review

**Files:**
- No additional production files.

- [x] **Step 1: Run all Script-system unit tests**

Run: `npx jest src/components/script-system src/lib/script-system --runInBand`

Expected: PASS with zero failures.

- [x] **Step 2: Run TypeScript and static migration checks**

Run: `npm run typecheck` and `npx jest tests/unit --runInBand --testPathPattern='(migration|script-dialogue|realtime)'`.

Expected: exit code 0 for both commands.

- [x] **Step 3: Inspect the diff and verify scope**

Run: `git diff --check` and `git diff --stat`.

Expected: no whitespace errors; only the migration, RPC helper/tests, editor wiring,
and the design/plan documents are changed in this task.
