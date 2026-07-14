# In-App Documents Phase 1 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Phase 1 in-project document authoring gate with reliable Markdown autosave, explicit stale-copy handling, shared project broadcast, folder-scoped creation, viewer read-only UI, image and bundle coverage, and a green full validation run.

**Architecture:** Keep `documentService` as the sole database boundary and keep Phase 2A dormant. Extract autosave, stale-copy, permissions, and project-channel lifecycle behind typed interfaces so `DocumentEditor` composes behavior instead of owning it. Reuse the existing project sidebar channel for document broadcasts and use one local typed event to feed both query invalidation and the open editor.

**Tech Stack:** Next.js 16, React 19, TypeScript, MDXEditor 4, Supabase JS/Realtime, React Query 5, Jest/ts-jest, Playwright.

## Global Constraints

- `documents.content` is the sole Phase 1 body authority.
- Default autosave delay is exactly 1500 ms.
- Keep all existing Phase 2A Yjs files and migration unchanged and disconnected.
- Document data functions remain isomorphic and accept `SupabaseClient` as their first argument.
- RLS remains the write-security boundary; viewer UI gating is defense in depth.
- Do not create or subscribe to a Realtime channel from a document mutation.
- All new code comments are English.
- No production change is written before its focused failing test.

---

### Task 1: Restore the Phase 1 verification baseline

**Files:**
- Modify: `tests/unit/agent/document-image-upload.test.ts`
- Create: `tests/unit/documents/mdx-editor-lazy-load.test.ts`

**Interfaces:**
- Consumes: `uploadDocumentImages`, `uploadImageFiles` and the current Supabase auth client surface.
- Produces: a correct image upload fake and a static lazy-load regression gate.

- [ ] **Step 1: Update the image fake contract and first verify the current suite fails**

Add `getSession` to the fake before changing production code:

```ts
auth: {
  getSession: async () => ({
    data: { session: { user: { id: USER_ID } } },
    error: null,
  }),
  getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
},
```

Run before the edit to capture RED:

```bash
npx jest tests/unit/agent/document-image-upload.test.ts --runInBand
```

Expected: 6 failures returning empty URL arrays.

- [ ] **Step 2: Run the corrected image test**

```bash
npx jest tests/unit/agent/document-image-upload.test.ts --runInBand
```

Expected: 7 tests pass.

- [ ] **Step 3: Write the lazy-load static test**

Assert:

```ts
expect(documentEditor).toMatch(/dynamic<MdxDocumentEditorProps>/);
expect(documentEditor).toMatch(/ssr:\s*false/);
expect(mdxEditor).toContain("from '@mdxeditor/editor'");
expect(otherSourceImports).toEqual([]);
```

- [ ] **Step 4: Verify the bundle guard passes**

```bash
npx jest tests/unit/documents/mdx-editor-lazy-load.test.ts --runInBand
```

Expected: PASS with the editor package imported only by `MdxDocumentEditor.tsx`.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/agent/document-image-upload.test.ts tests/unit/documents/mdx-editor-lazy-load.test.ts
git commit -m "test: restore document phase 1 verification"
```

### Task 2: Reuse the project sidebar channel for document broadcasts

**Files:**
- Create: `src/lib/documents/projectDocumentChannel.ts`
- Modify: `src/lib/documents/documentBroadcast.ts`
- Modify: `src/components/layout/hooks/useSidebarRealtime.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/hooks/useSidebarContextMenuActions.ts`
- Create: `tests/unit/documents/project-document-channel.test.ts`

**Interfaces:**
- Consumes: `RealtimeChannel`, `DocumentUpdatedPayload`, `projectSidebarTopic`.
- Produces:

```ts
registerProjectDocumentChannel(projectId: string, channel: RealtimeChannel): () => void
broadcastProjectDocumentUpdate(payload: DocumentUpdatedPayload): Promise<boolean>
sendDocumentUpdated(channel: RealtimeChannel, payload: DocumentUpdatedPayload): Promise<void>
subscribeToDocumentUpdates(listener: (payload: DocumentUpdatedPayload) => void): () => void
```

- [ ] **Step 1: Write failing registry tests**

Cover no registered channel, sending through the registered channel, identity-safe cleanup,
and local listener dispatch:

```ts
expect(await broadcastProjectDocumentUpdate(payload)).toBe(false);
const unregister = registerProjectDocumentChannel(PROJECT_ID, channel);
expect(await broadcastProjectDocumentUpdate(payload)).toBe(true);
expect(channel.send).toHaveBeenCalledWith({
  type: 'broadcast',
  event: DOCUMENT_UPDATED_EVENT,
  payload,
});
unregister();
```

- [ ] **Step 2: Verify RED**

```bash
npx jest tests/unit/documents/project-document-channel.test.ts --runInBand
```

Expected: FAIL because the registry interfaces do not exist.

- [ ] **Step 3: Implement the registry and pure send helper**

Use a module-level `Map<string, RealtimeChannel>` and unregister only when the stored channel is
the same object. `sendDocumentUpdated` calls `channel.send` only. Local update listeners use
`window.dispatchEvent(new CustomEvent(...))` behind a `typeof window` guard.

- [ ] **Step 4: Register the existing folder channel after `SUBSCRIBED`**

In `useSidebarRealtime`, register the channel in the subscription callback and unregister it
on effect cleanup. The received broadcast first invalidates queries and then dispatches the
typed local document event.

- [ ] **Step 5: Replace mutation broadcast calls**

Replace every:

```ts
broadcastDocumentUpdated(supabase, payload)
```

with:

```ts
broadcastProjectDocumentUpdate(payload)
```

No mutation imports `SupabaseClient` into the broadcast module.

- [ ] **Step 6: Verify GREEN and type safety**

```bash
npx jest tests/unit/documents/project-document-channel.test.ts --runInBand
npm run typecheck
```

Expected: all focused tests and TypeScript pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/documents src/components/layout tests/unit/documents/project-document-channel.test.ts
git commit -m "refactor: reuse sidebar channel for document updates"
```

### Task 3: Extract the autosave state machine

**Files:**
- Create: `src/components/documents/useDocumentAutosave.ts`
- Create: `tests/unit/documents/document-autosave.test.ts`

**Interfaces:**
- Produces the `UseDocumentAutosaveOptions` and `DocumentAutosave` contracts in the design.
- Depends only on React and injected `getSnapshot`, `save`, and `onSaved` callbacks.

- [ ] **Step 1: Write failing controller tests**

Use fake timers and deferred promises to cover:

```ts
controller.handleChange('draft');
jest.advanceTimersByTime(1499);
expect(save).not.toHaveBeenCalled();
jest.advanceTimersByTime(1);
expect(save).toHaveBeenCalledWith('draft');
```

Also cover edit-during-save coalescing, explicit empty content, teardown empty protection,
rejected flush preserving dirty state, and `acceptRemote` resetting the baseline.

- [ ] **Step 2: Verify RED**

```bash
npx jest tests/unit/documents/document-autosave.test.ts --runInBand
```

Expected: FAIL because the autosave module does not exist.

- [ ] **Step 3: Implement a framework-light controller plus hook adapter**

The controller owns refs/state and emits snapshots to a subscriber. The React hook owns one
controller instance, subscribes with `useSyncExternalStore` or `useState`, updates injected
callbacks through refs, and destroys timers on unmount.

Core serialization:

```ts
do {
  pending = false;
  const content = resolveSnapshot(reason);
  if (content !== lastSavedContent) {
    const result = await save(content);
    lastSavedContent = content;
    onSaved?.(content, result.updatedAt);
  }
} while (pending);
```

- [ ] **Step 4: Verify GREEN**

```bash
npx jest tests/unit/documents/document-autosave.test.ts --runInBand
```

Expected: all autosave tests pass with fake timers restored after the suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/documents/useDocumentAutosave.ts tests/unit/documents/document-autosave.test.ts
git commit -m "refactor: extract document autosave controller"
```

### Task 4: Add stale-copy and permission boundaries

**Files:**
- Create: `src/components/documents/useDocumentStaleCopy.ts`
- Create: `src/components/documents/useDocumentPermissions.ts`
- Create: `tests/unit/documents/document-stale-copy.test.ts`
- Create: `tests/unit/documents/document-permissions.test.ts`

**Interfaces:**
- Consumes: local document updates, `/api/projects/{projectId}/role`, Supabase session.
- Produces: `DocumentStaleCopy` and `DocumentPermissionState` from the design.

- [ ] **Step 1: Write failing stale-copy tests**

Assert that other documents, non-save actions, missing timestamps, and older timestamps are
ignored. Assert a clean newer save calls `onCleanRemoteSave`; a dirty newer save produces
`isStale`; reload clears only after success; keep-local clears without replacing content.

- [ ] **Step 2: Write failing permission loader tests**

Test the pure loader with injected `fetch` and session client:

```ts
expect(await loadDocumentPermissions(editorResponse)).toMatchObject({
  role: 'editor',
  readOnly: false,
});
expect(await loadDocumentPermissions(viewerResponse)).toMatchObject({
  role: 'viewer',
  readOnly: true,
});
```

Also reject URL/document project mismatch, `role: null`, non-OK responses, and missing session.

- [ ] **Step 3: Verify RED**

```bash
npx jest tests/unit/documents/document-stale-copy.test.ts tests/unit/documents/document-permissions.test.ts --runInBand
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement pure controllers/loaders and React adapters**

Use timestamp millisecond comparisons. Keep the permission loader free of React and expose a
small hook that runs it with cancellation on dependency changes.

- [ ] **Step 5: Verify GREEN**

```bash
npx jest tests/unit/documents/document-stale-copy.test.ts tests/unit/documents/document-permissions.test.ts --runInBand
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/components/documents/useDocumentStaleCopy.ts src/components/documents/useDocumentPermissions.ts tests/unit/documents
git commit -m "feat: add document stale copy and permission boundaries"
```

### Task 5: Recompose DocumentEditor around the new interfaces

**Files:**
- Modify: `src/components/documents/DocumentEditor.tsx`
- Modify: `src/components/documents/DocumentEditor.module.css`
- Create: `tests/unit/documents/document-editor-wiring.test.ts`

**Interfaces:**
- Consumes: `useDocumentAutosave`, `useDocumentStaleCopy`, `useDocumentPermissions`,
  `subscribeToDocumentUpdates`, `updateDocumentContent`, `queryKeys.document`.
- Produces: the existing `DocumentEditor({ projectId, documentId })` component contract.

- [ ] **Step 1: Write the failing wiring test**

Use static contract assertions to require the new hooks, shared update subscription, stale
banner controls, `setMarkdown`, and absence of direct `getUserProjectRole` calls.

- [ ] **Step 2: Verify RED**

```bash
npx jest tests/unit/documents/document-editor-wiring.test.ts --runInBand
```

Expected: FAIL on missing hook imports and stale UI.

- [ ] **Step 3: Replace the inline save state machine**

Wire `save` to `updateDocumentContent`, `onSaved` to React Query write-through plus
`broadcastProjectDocumentUpdate`, and register `autosave.flush('navigate')` in the existing
flush registry.

- [ ] **Step 4: Wire remote acceptance**

On clean remote save or Reload remote, call `queryClient.fetchQuery`, then:

```ts
editorRef.current?.setMarkdown(remote.content ?? '');
autosave.acceptRemote(remote.content ?? '', remote.updated_at);
```

Keep local calls `stale.keepLocal()` and leaves autosave dirty.

- [ ] **Step 5: Keep unload and image behavior at the composition boundary**

The keepalive request reads the autosave snapshot and token. `imageUploadHandler` stays an
injected MDXEditor callback and throws when no URL is returned.

- [ ] **Step 6: Verify GREEN**

```bash
npx jest tests/unit/documents/document-editor-wiring.test.ts tests/unit/documents/document-autosave.test.ts tests/unit/documents/document-stale-copy.test.ts --runInBand
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/components/documents/DocumentEditor.tsx src/components/documents/DocumentEditor.module.css tests/unit/documents/document-editor-wiring.test.ts
git commit -m "refactor: compose document editor phase 1 session"
```

### Task 6: Make folder-scoped document creation reachable

**Files:**
- Modify: `src/components/layout/ContextMenu.tsx`
- Modify: `src/components/layout/hooks/useSidebarContextMenuActions.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Create: `tests/unit/documents/folder-document-create-action.test.ts`

**Interfaces:**
- Adds `ContextMenuAction` value `new-document`.
- Adds callback `openNewDocumentInFolder(folderId: string): void` to sidebar context actions.

- [ ] **Step 1: Write the failing static interaction test**

Require the folder menu item, editor/admin gate, callback, and selected-folder assignment before
opening the modal.

- [ ] **Step 2: Verify RED**

```bash
npx jest tests/unit/documents/folder-document-create-action.test.ts --runInBand
```

- [ ] **Step 3: Implement the action**

Folder context menu shows `New document` for admin/editor. The handler closes the menu,
sets `selectedFolderId`, and opens `NewDocumentModal`. Root creation still sets it to null.

- [ ] **Step 4: Verify GREEN**

```bash
npx jest tests/unit/documents/folder-document-create-action.test.ts --runInBand
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/components/layout tests/unit/documents/folder-document-create-action.test.ts
git commit -m "feat: create documents inside folders"
```

### Task 7: Complete Phase 1 browser acceptance coverage

**Files:**
- Modify: `tests/e2e/specs/documents.spec.ts`
- Reuse: `src/assets/images/projectEmptyIcon_2.png`

**Interfaces:**
- Consumes visible sidebar/context-menu and MDXEditor accessibility contracts.
- Produces an unskipped document authoring/viewer acceptance spec.

- [ ] **Step 1: Extend the owner workflow**

After persistence, create a folder, rename the document, move it into the folder, insert the
PNG through MDXEditor's image dialog/file input, reload, assert text/image, then delete it.

- [ ] **Step 2: Add viewer UI gating without weakening the RLS test**

Create the document as owner, intercept only `/api/projects/*/role` on a fresh reload with:

```ts
await page.route('**/api/projects/*/role', (route) =>
  route.fulfill({ json: { role: 'viewer', isOwner: false } })
);
```

Assert `View only`, `[contenteditable="false"]`, no toolbar, and no create/rename/delete menu.
The live database behavior suite remains the proof that real viewer writes are rejected.

- [ ] **Step 3: Run the focused browser test**

```bash
npx playwright test tests/e2e/specs/documents.spec.ts --project=chromium
```

Expected: all document tests pass; none are skipped. If the configured Supabase environment is
unavailable, record that environmental blocker and rely on CI for the browser execution.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/specs/documents.spec.ts
git commit -m "test: cover document phase 1 browser acceptance"
```

### Task 8: Full verification and engineering audit

**Files:**
- Modify only when a failing verification has a focused regression test first.

**Interfaces:**
- Verifies all Phase 1 interfaces and confirms Phase 2A remains disconnected.

- [ ] **Step 1: Run focused document tests**

```bash
npx jest tests/unit/documents tests/unit/agent/document-image-upload.test.ts tests/unit/database/documents-rls.test.ts tests/unit/database/documents-yjs-state.test.ts tests/unit/database/shared-documents-retire.test.ts --runInBand
```

- [ ] **Step 2: Run the full repository gate**

```bash
npm run validate
```

Expected: lint, both typechecks, all enabled unit tests, and production build exit 0.

- [ ] **Step 3: Inspect the production bundle boundary**

Confirm the document route `react-loadable-manifest.json` contains the MDXEditor chunk and the
project root route manifest does not.

- [ ] **Step 4: Run live RLS behavior when local Supabase is available**

```bash
RLS_DB_TESTS=1 npm run test:unit -- tests/unit/database/documents.rls.behavior.test.ts --runInBand
```

- [ ] **Step 5: Run repository hygiene checks**

```bash
git diff --check
git status --short
```

- [ ] **Step 6: Audit interfaces, logic, and reuse**

Verify:

- no document mutation creates a Realtime channel;
- `DocumentEditor` contains no save-loop implementation;
- autosave has no Supabase/React Query/router imports;
- stale-copy has no MDXEditor imports;
- role UI uses the role API and project mismatch is rejected;
- all document cache access uses `queryKeys`;
- no Phase 2A collaboration prop is passed to MDXEditor;
- no new duplicate validation, channel, or persistence helper exists.

- [ ] **Step 7: Commit any verification-only fixes and prepare final report**

Report exact test/build/E2E/RLS evidence and any environment-limited verification without
claiming it passed.
