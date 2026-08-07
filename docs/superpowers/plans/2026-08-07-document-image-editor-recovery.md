# Document Image Editor Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert pasted images through MDXEditor's native Realm path, keep images responsive and editable, show the toolbar during collaboration startup, and make Retry visibly actionable.

**Architecture:** Replace the React frame paste handler with a Realm plugin composer child that handles mixed image clipboard payloads. Use `insertImage$` while the paste selection remains active; if the user edits during upload, insert at the captured Lexical selection without changing the current focus. Preserve responsive image CSS, expose an inert toolbar on the pending editor for non-viewers, and add awaited Retry UI state without weakening collaboration read-only safety.

**Tech Stack:** React 19, TypeScript, MDXEditor Realm, Lexical, Yjs collaboration, Jest, Playwright.

---

### Task 1: Native Clipboard Image Plugin

**Files:**
- Create: `src/components/documents/documentClipboardImagePastePlugin.tsx`
- Modify: `src/components/documents/MdxDocumentEditor.tsx`
- Modify: `src/components/documents/documentClipboardImages.ts`
- Modify: `tests/unit/documents/document-editor-media-link-controls.test.ts`
- Modify: `tests/unit/documents/document-clipboard-images.test.ts`

- [x] **Step 1: Write failing wiring tests**

Require `addComposerChild$`, `PASTE_COMMAND`, `insertImage$`, and registration of `documentClipboardImagePastePlugin({ imageUploadHandler })`. Require removal of `onPasteCapture`, `insertMarkdown(markdown)`, and `clipboardImagesToMarkdown`.

```ts
expect(pluginSource).toContain('addComposerChild$');
expect(pluginSource).toContain('PASTE_COMMAND');
expect(pluginSource).toContain('insertImage$');
expect(editorSource).toContain('documentClipboardImagePastePlugin({ imageUploadHandler })');
expect(editorSource).not.toContain('onPasteCapture={handlePasteCapture}');
expect(editorSource).not.toContain('insertMarkdown(markdown)');
```

- [x] **Step 2: Verify RED**

```bash
npx jest --runInBand tests/unit/documents/document-editor-media-link-controls.test.ts tests/unit/documents/document-clipboard-images.test.ts
```

Expected: FAIL because the Realm paste plugin does not exist and frame insertion remains.

- [x] **Step 3: Implement the Realm plugin**

Create a `realmPlugin<{ imageUploadHandler: (file: File) => Promise<string> }>` that publishes a composer child. The child registers a critical paste command, returns `false` for read-only or non-image payloads, prevents default mixed fallback, uploads with `uploadClipboardImages`, and publishes each uninterrupted result through:

```ts
insertImage({ src: image.url, altText: image.file.name });
```

Capture the paste selection before uploading. If focus or selection changes while
the upload is pending, insert native image nodes at the captured selection with
`SKIP_DOM_SELECTION_TAG`, then restore the user's current selection.

Add the plugin immediately after `imagePlugin` in `MdxDocumentEditor`. Remove the frame capture callback, its React event type, Markdown image serialization helper, and obsolete tests.

- [x] **Step 4: Verify GREEN**

Run the Task 1 Jest command, `npm run typecheck`, and focused ESLint. Expected: exit 0.

### Task 2: Toolbar and Retry Feedback

**Files:**
- Modify: `src/components/documents/DocumentEditor.tsx`
- Modify: `src/components/documents/DocumentEditor.module.css`
- Modify: `src/components/documents/MdxDocumentEditor.module.css`
- Modify: `tests/unit/documents/document-editor-wiring.test.ts`
- Modify: `tests/unit/documents/document-editor-media-link-controls.test.ts`

- [x] **Step 1: Write failing UI wiring tests**

Require the pending editor to use `showToolbar={permissions.role !== 'viewer'}`. Require `retrying`, awaited `collaboration.retry()`, error toast handling, disabled button state, and `Retrying...` label. Assert the existing image CSS includes `max-width: 100%` and `height: auto`.

```ts
expect(source).toContain("const [retrying, setRetrying] = useState(false)");
expect(source).toContain('await collaboration.retry()');
expect(source).toContain('disabled={retrying}');
expect(source).toContain("retrying ? 'Retrying...' : 'Retry'");
```

- [x] **Step 2: Verify RED**

```bash
npx jest --runInBand tests/unit/documents/document-editor-wiring.test.ts tests/unit/documents/document-editor-media-link-controls.test.ts
```

Expected: FAIL because pending toolbar and Retry state are absent.

- [x] **Step 3: Implement minimal UI behavior**

Add local Retry state and an awaited callback with `try/catch/finally`. On rejection call:

```ts
showErrorToast(error instanceof Error ? error.message : 'Document retry failed');
```

Disable the Retry button while pending and change its label. Show the toolbar in the pending current-document mount for non-viewers, but make its contents inert while the editor is read-only. Preserve the existing image CSS and add only a disabled cursor/opacity rule to the retry button if absent.

- [x] **Step 4: Verify GREEN**

Run the Task 2 Jest command, typecheck, and focused ESLint. Expected: exit 0.

### Task 3: Browser Regression and Final Verification

**Files:**
- Modify: `tests/e2e/specs/library-table-document-copy.spec.ts`

- [x] **Step 1: Extend the image E2E assertions**

Use an oversized mixed clipboard PNG and delay its upload. Type while upload is pending, then continue typing after insertion without resetting focus. Assert Storage URL, image width no greater than the editor width, no connection-interrupted banner, and persisted image-before-text order after reload.

- [x] **Step 2: Run Chromium regression**

```bash
npx playwright test tests/e2e/specs/library-table-document-copy.spec.ts --project=chromium
```

Expected: both image and table tests PASS.

- [x] **Step 3: Run final static verification**

```bash
npx jest --runInBand tests/unit/documents/document-clipboard-images.test.ts tests/unit/documents/document-editor-media-link-controls.test.ts tests/unit/documents/document-editor-wiring.test.ts tests/unit/library-rich-clipboard.test.ts tests/unit/library-rich-clipboard-wiring.test.ts
npm run typecheck
npx eslint src/components/documents/documentClipboardImagePastePlugin.tsx src/components/documents/documentClipboardImages.ts src/components/documents/MdxDocumentEditor.tsx src/components/documents/DocumentEditor.tsx tests/unit/documents/document-clipboard-images.test.ts tests/unit/documents/document-editor-media-link-controls.test.ts tests/unit/documents/document-editor-wiring.test.ts tests/e2e/specs/library-table-document-copy.spec.ts
```

Expected: all commands exit 0.

- [x] **Step 4: Review scope**

Confirm this task changes only the planned editor files and tests, while preserving all unrelated user modifications and the existing uncommitted responsive image CSS.
