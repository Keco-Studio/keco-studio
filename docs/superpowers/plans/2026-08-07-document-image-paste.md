# Document Image Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload externally copied images before inserting them into documents while explicitly verifying that copied library tables persist as GFM Markdown.

**Architecture:** Add a small pure clipboard-image module that extracts image files from mixed clipboard payloads and uploads them with partial-failure isolation. Capture paste at the document editor frame before MDXEditor's built-in mixed-payload rejection, then dispatch image nodes containing the returned permanent URLs. Keep the existing rich table clipboard flow and add a persistence assertion.

**Tech Stack:** React 19, TypeScript, MDXEditor/Lexical, Supabase Storage, Jest, Playwright.

---

## File Structure

- Create `src/components/documents/documentClipboardImages.ts`: pure clipboard image extraction and upload resolution.
- Create `tests/unit/documents/document-clipboard-images.test.ts`: behavior tests for mixed payloads, ordering, and partial failures.
- Modify `src/components/documents/MdxDocumentEditor.tsx`: capture editable image pastes and insert uploaded URLs.
- Modify `tests/unit/documents/document-editor-media-link-controls.test.ts`: static wiring regression for the editor capture handler.
- Modify `tests/e2e/specs/documents.spec.ts`: browser-level mixed clipboard image upload and persistence proof.
- Modify `tests/e2e/specs/library-table-document-copy.spec.ts`: explicit GFM Markdown persistence assertion.

### Task 1: Clipboard Image Extraction and Upload Resolution

**Files:**
- Create: `src/components/documents/documentClipboardImages.ts`
- Create: `tests/unit/documents/document-clipboard-images.test.ts`

- [ ] **Step 1: Write the failing extraction tests**

Create tests that build a clipboard payload containing `image/png`, `text/html`, and `text/plain` items. Assert that only the non-null image `File` is returned and that an all-text payload returns an empty array.

```ts
function item(
  kind: DataTransferItem['kind'],
  type: string,
  file: File | null,
): DataTransferItem {
  return { kind, type, getAsFile: () => file } as DataTransferItem;
}

const image = new File(['png'], 'pasted.png', { type: 'image/png' });
const clipboard = {
  items: [
    item('file', 'image/png', image),
    item('string', 'text/html', null),
    item('string', 'text/plain', null),
  ],
} as unknown as DataTransfer;

expect(extractClipboardImageFiles(clipboard)).toEqual([image]);
```

- [ ] **Step 2: Run the extraction test to verify RED**

Run:

```bash
npx jest --runInBand tests/unit/documents/document-clipboard-images.test.ts
```

Expected: FAIL because `documentClipboardImages.ts` does not exist.

- [ ] **Step 3: Implement minimal extraction**

Add:

```ts
export function extractClipboardImageFiles(
  clipboardData: Pick<DataTransfer, 'items'> | null,
): File[] {
  if (!clipboardData) return [];
  return Array.from(clipboardData.items).flatMap((item) => {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}
```

- [ ] **Step 4: Write the failing upload-resolution test**

Assert that three files upload concurrently, successful results retain clipboard order, a rejected upload is omitted, and `console.error` receives the failed file name.

```ts
const results = await uploadClipboardImages([first, failed, third], async (file) => {
  if (file === failed) throw new Error('upload denied');
  return `https://storage.test/${file.name}`;
});

expect(results).toEqual([
  { file: first, url: 'https://storage.test/first.png' },
  { file: third, url: 'https://storage.test/third.png' },
]);
```

- [ ] **Step 5: Run the upload test to verify RED**

Run the same focused Jest command. Expected: FAIL because `uploadClipboardImages` is missing.

- [ ] **Step 6: Implement upload resolution with partial failure isolation**

Use `Promise.allSettled`, preserve input order, log each rejected upload, and return only fulfilled `{ file, url }` entries:

```ts
export type UploadedClipboardImage = { file: File; url: string };

export async function uploadClipboardImages(
  files: readonly File[],
  upload: (file: File) => Promise<string>,
): Promise<UploadedClipboardImage[]> {
  const settled = await Promise.allSettled(
    files.map(async (file) => ({ file, url: await upload(file) })),
  );

  return settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [result.value];
    console.error(`Failed to upload pasted image: ${files[index]?.name ?? 'unknown'}`, result.reason);
    return [];
  });
}
```

- [ ] **Step 7: Run focused tests to verify GREEN**

Run the focused Jest command. Expected: all tests in the file PASS with the intentional error log mocked by the test.

- [ ] **Step 8: Commit the pure clipboard behavior**

```bash
git add src/components/documents/documentClipboardImages.ts tests/unit/documents/document-clipboard-images.test.ts
git commit -m "feat: resolve pasted document images"
```

### Task 2: Editable Document Paste Capture

**Files:**
- Modify: `src/components/documents/MdxDocumentEditor.tsx:10-20,21-61,308-460`
- Modify: `tests/unit/documents/document-editor-media-link-controls.test.ts`

- [ ] **Step 1: Add a failing editor wiring assertion**

Extend the existing source-level wiring test to require:

```ts
expect(source).toContain('onPasteCapture={handlePasteCapture}');
expect(source).toContain('extractClipboardImageFiles(event.clipboardData)');
expect(source).toContain('event.preventDefault()');
expect(source).toContain('uploadClipboardImages(imageFiles, imageUploadHandler)');
expect(source).toContain('editor.dispatchCommand(INSERT_IMAGE_COMMAND');
```

Also assert that `handlePasteCapture` returns without interception when `readOnly` is true.

- [ ] **Step 2: Run the wiring test to verify RED**

Run:

```bash
npx jest --runInBand tests/unit/documents/document-editor-media-link-controls.test.ts
```

Expected: FAIL because the paste capture handler is not wired.

- [ ] **Step 3: Implement the frame-level paste capture**

Import React's `ClipboardEvent` type, MDXEditor's `INSERT_IMAGE_COMMAND`, and the new helper functions. Add a callback that:

```ts
const handlePasteCapture = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
  if (readOnly) return;
  const imageFiles = extractClipboardImageFiles(event.clipboardData);
  if (imageFiles.length === 0) return;

  const editor = activeEditor;
  if (!editor) return;

  event.preventDefault();
  event.stopPropagation();
  void uploadClipboardImages(imageFiles, imageUploadHandler).then((images) => {
    images.forEach(({ file, url }) => {
      editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
        src: url,
        altText: file.name,
      });
    });
  });
}, [activeEditor, imageUploadHandler, readOnly]);
```

Read `activeEditor$` with `useCellValue`, and attach the callback as `onPasteCapture` on `editorFrame` so it precedes MDXEditor's built-in critical paste command. Non-image clipboard payloads must not call `preventDefault` or `stopPropagation`.

- [ ] **Step 4: Run the focused unit tests to verify GREEN**

Run:

```bash
npx jest --runInBand tests/unit/documents/document-clipboard-images.test.ts tests/unit/documents/document-editor-media-link-controls.test.ts
```

Expected: both suites PASS.

- [ ] **Step 5: Run type checking and focused lint**

Run:

```bash
npx tsc --noEmit
npx eslint src/components/documents/documentClipboardImages.ts src/components/documents/MdxDocumentEditor.tsx tests/unit/documents/document-clipboard-images.test.ts tests/unit/documents/document-editor-media-link-controls.test.ts
```

Expected: exit code 0.

- [ ] **Step 6: Commit editor wiring**

```bash
git add src/components/documents/MdxDocumentEditor.tsx tests/unit/documents/document-editor-media-link-controls.test.ts
git commit -m "fix: upload mixed clipboard images in documents"
```

### Task 3: Browser Regression for Mixed Clipboard Images

**Files:**
- Modify: `tests/e2e/specs/documents.spec.ts:20-155`

- [ ] **Step 1: Add a failing Playwright step**

Grant clipboard permissions for `http://localhost:3000`. Write one `ClipboardItem` containing the PNG fixture plus `text/html` with an external `<img>` and `text/plain`. Focus the editor and press `Control+V`.

Assert that:

```ts
await expect(editor.locator('img')).toHaveCount(2);
await expect(editor.locator('img').last()).toHaveAttribute(
  'src',
  /\/storage\/v1\/object\/public\/library-media-files\//,
);
await expect(editor.locator('img').last()).not.toHaveAttribute('src', /external\.invalid/);
```

Wait for the durable Yjs append before continuing, reload, and assert the uploaded image remains.

- [ ] **Step 2: Run the browser test to verify RED**

Run:

```bash
npx playwright test tests/e2e/specs/documents.spec.ts --project=chromium --grep "create -> edit"
```

Expected before production wiring: FAIL because a mixed clipboard image is not uploaded and inserted with the Keco Storage URL.

- [ ] **Step 3: Re-run the browser test to verify GREEN**

Run the same Playwright command after Task 2. Expected: PASS, including durable save and reload.

- [ ] **Step 4: Commit the browser regression**

```bash
git add tests/e2e/specs/documents.spec.ts
git commit -m "test: cover pasted document image uploads"
```

### Task 4: Explicit GFM Persistence Contract for Tables

**Files:**
- Modify: `tests/e2e/specs/library-table-document-copy.spec.ts:220-265`

- [ ] **Step 1: Add the persisted Markdown assertion**

After the durable table edit, poll the `documents.content` column through the existing admin client and assert it contains a GFM header, separator, and edited data row:

```ts
await expect.poll(async () => {
  const { data, error } = await admin
    .from('documents')
    .select('content')
    .eq('id', fixture.documentId)
    .single();
  if (error) throw error;
  return data.content;
}).toMatch(/\|\s*Name\s*\|\s*Score\s*\|[\s\S]*\|\s*:?-+\s*\|\s*:?-+\s*\|[\s\S]*\|\s*Alicia in document\s*\|\s*10\s*\|/);
```

- [ ] **Step 2: Run the focused table E2E test**

Run:

```bash
npx playwright test tests/e2e/specs/library-table-document-copy.spec.ts --project=chromium
```

Expected: PASS, proving the existing native table flow persists GFM Markdown.

- [ ] **Step 3: Commit the table persistence assertion**

```bash
git add tests/e2e/specs/library-table-document-copy.spec.ts
git commit -m "test: assert document tables persist as markdown"
```

### Task 5: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run all directly affected unit suites**

```bash
npx jest --runInBand tests/unit/documents/document-clipboard-images.test.ts tests/unit/documents/document-editor-media-link-controls.test.ts tests/unit/library-rich-clipboard.test.ts tests/unit/library-rich-clipboard-wiring.test.ts
```

Expected: all suites PASS.

- [ ] **Step 2: Run type checking and focused lint**

```bash
npm run typecheck
npx eslint src/components/documents/documentClipboardImages.ts src/components/documents/MdxDocumentEditor.tsx tests/unit/documents/document-clipboard-images.test.ts tests/unit/documents/document-editor-media-link-controls.test.ts tests/e2e/specs/documents.spec.ts tests/e2e/specs/library-table-document-copy.spec.ts
```

Expected: both commands exit 0.

- [ ] **Step 3: Run both affected Playwright specs**

```bash
npx playwright test tests/e2e/specs/documents.spec.ts tests/e2e/specs/library-table-document-copy.spec.ts --project=chromium
```

Expected: both specs PASS.

- [ ] **Step 4: Review the final diff**

Confirm only the planned document paste files, tests, plan, and design are changed by this task. Preserve all unrelated user changes already present in the worktree.
