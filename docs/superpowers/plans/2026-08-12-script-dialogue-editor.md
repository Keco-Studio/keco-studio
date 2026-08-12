# Script Dialogue Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete inline dialogue insertion, autosave editing, confirmed deletion, persistent drag sorting, and undo/redo in the Script workspace.

**Architecture:** Keep dialogue grouping and database operations in pure/service modules, mutation sequencing in `useScriptDialogueEditor`, sortable-list coordination in `VisualNovelScriptView`, and local presentation state in `ScriptEditableDialogBlock`. Script-library rows remain authoritative; this feature never writes to the linked source document.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase, TanStack Query, Ant Design, `@dnd-kit/core`, `@dnd-kit/sortable`, Jest, Playwright.

---

## File Map

- `src/lib/script-system/scriptDialogueBlocks.ts`: derive editable blocks and complete-library character choices.
- `src/lib/script-system/scriptDialogueBlocks.test.ts`: grouping and character-discovery tests.
- `src/lib/script-system/scriptDialogueMutations.ts`: persistent insert/update/delete/reorder helpers and pure order calculation.
- `src/lib/script-system/scriptDialogueMutations.test.ts`: order preservation and mutation contract tests.
- `src/components/script-system/useScriptDialogueEditor.ts`: serialized async commands, history, busy/error outcomes.
- `src/components/script-system/ScriptEditableDialogBlock.tsx`: hover, picker, edit drafts, keyboard save, confirmation, sortable item.
- `src/components/script-system/ScriptEditableDialogBlock.test.tsx`: structural and callback-contract checks supported by the current Jest setup.
- `src/components/libraries/components/VisualNovelScriptView.tsx`: DnD context, sortable block rendering, toolbar icons.
- `src/components/libraries/components/VisualNovelScriptView.module.css`: stable hover/edit/picker/drag visuals and responsive constraints.
- `src/components/script-system/ScriptSplitView.tsx`: connect async editor actions and busy state.
- `src/components/script-system/ScriptSplitView.test.tsx`: editing-prop wiring regression coverage.
- `tests/e2e/specs/script-dialogue-editor.spec.ts`: actual pointer, keyboard, confirmation, persistence, and reload behavior where an authenticated fixture is available.

### Task 1: Preserve Non-Dialogue Row Positions During Reorder

**Files:**
- Create: `src/lib/script-system/scriptDialogueMutations.test.ts`
- Modify: `src/lib/script-system/scriptDialogueMutations.ts`

- [ ] **Step 1: Write the failing pure-order tests**

Add tests for a row sequence such as `title, a1, s1, scene, a2, s2, choice` and assert moving block 2 before block 1 yields `title, a2, s2, scene, a1, s1, choice`. Also cover action-only and speech-only blocks and invalid/no-op indexes.

```ts
expect(reorderDialogueRowIds({
  orderedRowIds: ['title', 'a1', 's1', 'scene', 'a2', 's2', 'choice'],
  blockOrderIds: ['s1', 's2'],
  blockRowIds: new Map([['s1', ['a1', 's1']], ['s2', ['a2', 's2']]]),
  fromIndex: 1,
  toIndex: 0,
})).toEqual(['title', 'a2', 's2', 'scene', 'a1', 's1', 'choice']);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run `npx jest src/lib/script-system/scriptDialogueMutations.test.ts --runInBand`.
Expected: FAIL because `reorderDialogueRowIds` is not exported.

- [ ] **Step 3: Implement slot-preserving row order calculation**

Export a pure `reorderDialogueRowIds` helper. Treat each dialogue block's current occupied row slots as a replaceable group: remove block-owned rows, reorder block groups, then fill each original block slot group without moving unrelated rows. Make `reorderDialogueBlock` call the helper and persist the complete resulting order through `normalizeRowIndices`.

- [ ] **Step 4: Run focused tests**

Run `npx jest src/lib/script-system/scriptDialogueMutations.test.ts --runInBand`.
Expected: PASS.

### Task 2: Make Editor Commands Awaitable And Serialized

**Files:**
- Modify: `src/components/script-system/useScriptDialogueEditor.ts`
- Modify: `src/components/script-system/ScriptSplitView.tsx`
- Modify: `src/components/script-system/ScriptSplitView.test.tsx`

- [ ] **Step 1: Add failing contract assertions**

Update the split-view test mock and assertions so insert, save, delete, reorder, undo, and redo return promises; expose `isBusy`; and require `saveBlockField` to resolve `true` on success/no-op and `false` on failure.

- [ ] **Step 2: Run the split-view test and verify failure**

Run `npx jest src/components/script-system/ScriptSplitView.test.tsx --runInBand`.
Expected: FAIL on the missing busy/async editing contract.

- [ ] **Step 3: Replace dropped-overlap behavior with a serialized queue**

Replace the `busyRef.current` early returns with a promise chain that executes commands in order. Return explicit `Promise<boolean>` results, expose `isBusy`, disable undo/redo while busy, refresh authoritative rows after structural failures, and retain current error toasts. Ensure history changes only after successful writes.

- [ ] **Step 4: Pass async actions through without discarding their promises**

Update `ScriptDialogueEditingProps` and `ScriptSplitView` callbacks to return the hook promises. This lets blocks await autosave before leaving edit mode or starting structural actions.

- [ ] **Step 5: Run focused tests and typecheck**

Run `npx jest src/components/script-system/ScriptSplitView.test.tsx --runInBand` and `npm run typecheck`.
Expected: PASS.

### Task 3: Complete Hover, Edit, Autosave, Picker, And Delete UI

**Files:**
- Create: `src/components/script-system/ScriptEditableDialogBlock.test.tsx`
- Modify: `src/components/script-system/ScriptEditableDialogBlock.tsx`
- Modify: `src/components/libraries/components/VisualNovelScriptView.module.css`

- [ ] **Step 1: Write failing component contract tests**

Cover accessible labels, button types, edit entry targets, empty-character menu state, `Escape` picker dismissal wiring, async save return types, Ant Design confirmation copy, action `Enter`, and dialogue `Ctrl/Cmd+Enter`. Add source-level assertions only for event behavior that the repository's Node Jest environment cannot dispatch.

- [ ] **Step 2: Run the component test and verify failure**

Run `npx jest src/components/script-system/ScriptEditableDialogBlock.test.tsx --runInBand`.
Expected: FAIL because the component lacks confirmation, keyboard exit, target-only edit entry, and complete picker behavior.

- [ ] **Step 3: Implement target-only editing and stable drafts**

Remove the edit handler from the whole body. Attach it to the avatar, action chip, and dialogue bubble. Keep drafts synchronized only when the backing block changes and the block is not holding a failed local draft. Focus the action input when a newly inserted block enters edit mode.

- [ ] **Step 4: Implement autosave transitions**

Create one `commitDrafts(): Promise<boolean>` callback that saves changed action then dialogue. Call it on input blur and before picker open, drag start, delete, or edit exit. Use an in-flight promise ref to coalesce duplicate blur/click sequences. Keep the block editing and preserve drafts when it resolves `false`.

- [ ] **Step 5: Implement picker and delete confirmation**

Close the picker on outside click or Escape, restore focus to the add button, and show a disabled `No characters available` item when empty. Wrap the delete command in Ant Design `Popconfirm` with explicit confirm/cancel labels; await autosave before opening or confirming as appropriate.

- [ ] **Step 6: Replace text glyphs with project icons and refine CSS**

Use Ant Design icons for drag, delete, add, undo, and redo. Keep icon buttons at fixed dimensions, add tooltips/accessibility labels, constrain the picker to the split pane, prevent text overflow, and add active/drop-target styles.

- [ ] **Step 7: Run focused tests**

Run `npx jest src/components/script-system/ScriptEditableDialogBlock.test.tsx --runInBand`.
Expected: PASS.

### Task 4: Add Persistent Pointer And Keyboard Sorting

**Files:**
- Modify: `src/components/libraries/components/VisualNovelScriptView.tsx`
- Modify: `src/components/script-system/ScriptEditableDialogBlock.tsx`
- Modify: `src/components/libraries/components/VisualNovelScriptView.module.css`
- Modify: `src/components/script-system/ScriptSplitView.test.tsx`

- [ ] **Step 1: Add failing sortable wiring assertions**

Require `DndContext`, pointer and keyboard sensors, `SortableContext`, `sortableKeyboardCoordinates`, stable block IDs, and an awaited `onReorderBlock(activeIndex, overIndex)` callback.

- [ ] **Step 2: Run the test and verify failure**

Run `npx jest src/components/script-system/ScriptSplitView.test.tsx --runInBand`.
Expected: FAIL because the current implementation uses incomplete native drag events.

- [ ] **Step 3: Implement the DnD context**

Configure pointer and keyboard sensors in `VisualNovelScriptView`. Wrap editable dialogue blocks in a vertical sortable context and resolve active/over IDs to current branch block indexes. Ignore no-op drops and await persistent reorder.

- [ ] **Step 4: Make each block sortable**

Use `useSortable({ id: block.id, disabled: isBusy })`; apply transform/transition styles to the outer block and attach attributes/listeners only to the three-line drag handle. Flush drafts before allowing the drag gesture.

- [ ] **Step 5: Run focused tests and typecheck**

Run `npx jest src/components/script-system/ScriptSplitView.test.tsx --runInBand` and `npm run typecheck`.
Expected: PASS.

### Task 5: Verify Persistence And Regression Safety

**Files:**
- Create when fixture support permits: `tests/e2e/specs/script-dialogue-editor.spec.ts`
- Modify only if failures reveal scoped defects: files listed above.

- [ ] **Step 1: Add the authenticated browser scenario**

Create a script library fixture with two dialogue blocks separated by a non-dialogue row. Verify hover/add, all-library character choice, automatic edit focus, blur autosave, reload persistence, delete cancel/confirm, pointer reorder, keyboard reorder, and the unchanged non-dialogue position.

- [ ] **Step 2: Run focused unit tests**

Run:

```bash
npx jest src/lib/script-system/scriptDialogueBlocks.test.ts \
  src/lib/script-system/scriptDialogueMutations.test.ts \
  src/components/script-system/ScriptEditableDialogBlock.test.tsx \
  src/components/script-system/ScriptSplitView.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 3: Run static verification**

Run `npm run typecheck` and `npx eslint src/lib/script-system/scriptDialogueBlocks.ts src/lib/script-system/scriptDialogueMutations.ts src/components/script-system/useScriptDialogueEditor.ts src/components/script-system/ScriptEditableDialogBlock.tsx src/components/libraries/components/VisualNovelScriptView.tsx src/components/script-system/ScriptSplitView.tsx`.
Expected: PASS.

- [ ] **Step 4: Run the browser scenario and inspect screenshots**

Run `npx playwright test tests/e2e/specs/script-dialogue-editor.spec.ts` against the configured test environment. Capture desktop and narrow viewport screenshots and confirm no overlap, clipping, blank UI, or layout shift. If the environment lacks authenticated test credentials or backend connectivity, report that limitation explicitly and retain the focused automated evidence.

- [ ] **Step 5: Review the final diff**

Run `git diff --check` and `git diff --stat`. Confirm source-document services and unrelated dirty files were not modified.
