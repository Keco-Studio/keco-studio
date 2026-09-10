# WPS Mixed Paste Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve WPS mixed-paste text while recovering browser-exposed PNG/JPEG images and visibly marking images whose bytes WPS omitted.

**Architecture:** Keep clipboard byte discovery and HTML preparation in `documentClipboardImages.ts`, adding a small balanced-group RTF parser with no network access. The paste plugin remains responsible for Lexical insertion and upload lifecycle, and emits one shared warning toast when preparation reports one or more missing WPS images.

**Tech Stack:** TypeScript, DOMParser/File browser APIs, React, Lexical/MDXEditor, Jest/jsdom, Playwright Chromium

## Global Constraints

- Resolution priority is clipboard `image/*` file, RTF PNG/JPEG image by HTML order, HTML data image, then WPS fallback marker.
- The fallback marker text is exactly `[WPS image was not included in the clipboard. Paste this image separately.]`.
- One warning toast is shown per paste when one or more WPS images fall back.
- Never fetch `file:` URLs or arbitrary remote URLs.
- Unsupported RTF vector formats and proprietary clipboard formats not exposed by Chromium remain unsupported.
- Sanctioned MDX validity and collaboration persistence must hold at every intermediate state.
- Source and test files must pass the repository's no-Chinese-character gate.
- No Supabase migration may be added or modified.

---

### Task 1: Recover WPS RTF images and preserve unresolved positions

**Files:**
- Modify: `src/components/documents/documentClipboardImages.ts`
- Test: `tests/unit/documents/document-clipboard-images.test.ts`

**Interfaces:**
- Consumes: `clipboardData.getData('text/rtf')`, existing `extractClipboardImageFiles`, `dataImageUrlToFile`, and `createImagePlaceholder` helpers.
- Produces: `extractClipboardRtfImageFiles(clipboardData: Pick<DataTransfer, 'getData'> | null): File[]` and `PreparedClipboardRichImagePaste.wpsImageFallbackCount: number`.

- [ ] **Step 1: Write failing RTF extraction tests**

Add imports and focused cases that provide WPS-style balanced `pict` groups:

```ts
import {
  extractClipboardRtfImageFiles,
  // existing imports
} from '@/components/documents/documentClipboardImages';

it('extracts PNG and JPEG files from WPS RTF pict groups in order', async () => {
  const clipboard = {
    getData: (format: string) => format === 'text/rtf'
      ? String.raw`{\rtf1{\pict\pngblip 89504e470d0a1a0a}{\pict\jpegblip ffd8ffe000104a464946ffd9}}`
      : '',
  };

  const files = extractClipboardRtfImageFiles(clipboard);

  expect(files.map(({ name, type, size }) => ({ name, type, size }))).toEqual([
    { name: 'clipboard-image-1.png', type: 'image/png', size: 8 },
    { name: 'clipboard-image-2.jpg', type: 'image/jpeg', size: 12 },
  ]);
  expect(Array.from(new Uint8Array(await files[0]!.arrayBuffer())))
    .toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

it('deduplicates consecutive WPS compatibility pict copies', () => {
  const clipboard = {
    getData: (format: string) => format === 'text/rtf'
      ? String.raw`{\rtf1{\*\shppict{\pict\pngblip 89504e47}}{\nonshppict{\pict\pngblip 89504e47}}}`
      : '',
  };

  expect(extractClipboardRtfImageFiles(clipboard)).toHaveLength(1);
});

it.each([
  String.raw`{\rtf1{\pict\emfblip 0102}}`,
  String.raw`{\rtf1{\pict\pngblip 123}}`,
  String.raw`{\rtf1{\pict\jpegblip zz}}`,
  String.raw`{\rtf1{\pict\pngblip 89504e47`,
])('ignores unsupported or malformed RTF image data', (rtf) => {
  const clipboard = { getData: (format: string) => format === 'text/rtf' ? rtf : '' };
  expect(extractClipboardRtfImageFiles(clipboard)).toEqual([]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx jest --runInBand tests/unit/documents/document-clipboard-images.test.ts`

Expected: FAIL because `extractClipboardRtfImageFiles` is not exported.

- [ ] **Step 3: Implement balanced RTF PNG/JPEG extraction**

In `documentClipboardImages.ts`, add helpers that scan unescaped braces, select complete groups beginning with `\\pict`, ignore nested destination data such as `blipuid`, strip top-level RTF control words and whitespace, validate non-empty even-length hexadecimal bytes, and collapse only consecutive images with the same MIME type and normalized hexadecimal payload. Convert accepted payloads with `Uint8Array` and `File`, using the existing deterministic clipboard filename helper.

The exported entry point must remain synchronous and side-effect free:

```ts
export function extractClipboardRtfImageFiles(
  clipboardData: Pick<DataTransfer, 'getData'> | null,
): File[] {
  if (!clipboardData) return [];
  const images = extractRtfPictPayloads(clipboardData.getData('text/rtf'));
  return images.map(({ mimeType, hex }, index) => new File(
    [hexToBytes(hex)],
    fileNameForClipboardImage(mimeType, index),
    { type: mimeType },
  ));
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx jest --runInBand tests/unit/documents/document-clipboard-images.test.ts`

Expected: PASS with all clipboard image tests green.

- [ ] **Step 5: Write failing ordered-resolution and fallback tests**

Add cases proving RTF recovery, source priority, WPS-only fallback placement/count, and sanctioned output:

```ts
it('maps RTF images to WPS HTML image positions and uploads them in order', () => {
  const clipboard = {
    items: [item('string', 'text/html', null), item('string', 'text/rtf', null)],
    getData: (format: string) => ({
      'text/html': '<p>Before</p><img src="file:///C:/Users/Test/AppData/Local/Temp/ksohtml/wps_clip_image-1.png"><p>Middle</p><img src="file:///C:/Users/Test/AppData/Local/Temp/ksohtml/wps_clip_image-2.jpg"><p>After</p>',
      'text/rtf': String.raw`{\rtf1{\pict\pngblip 89504e47}{\pict\jpegblip ffd8ffd9}}`,
      'text/plain': 'Before\nMiddle\nAfter',
    }[format] ?? ''),
  } as unknown as DataTransfer;

  const prepared = prepareClipboardRichImagePaste(clipboard)!;

  expect(prepared.images.map((image) => image.file.type))
    .toEqual(['image/png', 'image/jpeg']);
  expect(prepared.wpsImageFallbackCount).toBe(0);
  expect(prepared.html).toMatch(/Before.*clipboard-image\.invalid.*Middle.*clipboard-image\.invalid.*After/);
});

it('uses files before RTF and RTF before HTML data images', () => {
  const file = new File(['file'], 'from-file.png', { type: 'image/png' });
  const clipboard = {
    items: [item('file', 'image/png', file)],
    getData: (format: string) => ({
      'text/html': '<img src="data:image/gif;base64,R0lG"><img src="data:image/gif;base64,R0lG">',
      'text/rtf': String.raw`{\rtf1{\pict\jpegblip ffd8ffd9}{\pict\pngblip 89504e47}}`,
      'text/plain': '',
    }[format] ?? ''),
  } as unknown as DataTransfer;

  const prepared = prepareClipboardRichImagePaste(clipboard)!;
  expect(prepared.images[0]!.file).toBe(file);
  expect(prepared.images[1]!.file.type).toBe('image/png');
});

it('replaces missing WPS images in place and reports one fallback count per image', () => {
  const clipboard = {
    items: [item('string', 'text/html', null)],
    getData: (format: string) => format === 'text/html'
      ? '<p>Before</p><img src="file:///C:/Users/Test/AppData/Local/Temp/ksohtml/wps_clip_image-1.png"><p>After</p>'
      : 'Before\nAfter',
  } as unknown as DataTransfer;

  const prepared = prepareClipboardRichImagePaste(clipboard)!;

  expect(prepared.images).toEqual([]);
  expect(prepared.wpsImageFallbackCount).toBe(1);
  expect(prepared.html).toBe('<p>Before</p><p>[WPS image was not included in the clipboard. Paste this image separately.]</p><p>After</p>');
  expect(() => validateSanctionedMdx('Before\n\n[WPS image was not included in the clipboard. Paste this image separately.]\n\nAfter')).not.toThrow();
});
```

- [ ] **Step 6: Run the focused test and verify RED**

Run: `npx jest --runInBand tests/unit/documents/document-clipboard-images.test.ts`

Expected: FAIL because RTF files are not used and `wpsImageFallbackCount` is absent.

- [ ] **Step 7: Implement image resolution and WPS fallback markers**

Extend the prepared type and resolve inputs without network access:

```ts
export type PreparedClipboardRichImagePaste = {
  html: string;
  plainText: string;
  images: PreparedClipboardImage[];
  wpsImageFallbackCount: number;
};

const WPS_IMAGE_FALLBACK_TEXT =
  '[WPS image was not included in the clipboard. Paste this image separately.]';
```

Inside `prepareClipboardRichImagePaste`, extract RTF files once. For each HTML image at `index`, choose `clipboardFiles[index] ?? rtfFiles[index] ?? dataImageUrlToFile(source, index)`. If no file exists and the decoded, slash-normalized `file:` source contains both `/ksohtml/` and `/wps_clip_image-`, replace the image with a newly created `<p>` whose `textContent` is `WPS_IMAGE_FALLBACK_TEXT` and increment the fallback count. Keep existing sanctioned remote sources unchanged, remove other unsupported sources, append extra real clipboard files as before, and return the count.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run: `npx jest --runInBand tests/unit/documents/document-clipboard-images.test.ts`

Expected: PASS with RTF, fallback, existing data-image, file-image, remote safety, and upload-isolation cases green.

- [ ] **Step 9: Commit the clipboard preparation behavior**

```bash
git add src/components/documents/documentClipboardImages.ts tests/unit/documents/document-clipboard-images.test.ts
git commit -m "fix: recover WPS images from mixed clipboard data"
```

### Task 2: Warn once when WPS omits image bytes

**Files:**
- Modify: `src/components/documents/documentClipboardImagePastePlugin.tsx`
- Test: `tests/unit/documents/document-editor-media-link-controls.test.ts`

**Interfaces:**
- Consumes: `PreparedClipboardRichImagePaste.wpsImageFallbackCount` and `showWarningToast(message: string, duration?: number): void` from `@/lib/utils/toast`.
- Produces: one warning invocation during a handled rich paste, independent of fallback count.

- [ ] **Step 1: Write the failing plugin wiring test**

Extend the source-level wiring test:

```ts
it('warns once when WPS mixed paste contains image fallbacks', () => {
  expect(clipboardPluginSource).toContain("import { showWarningToast } from '@/lib/utils/toast'");
  expect(clipboardPluginSource).toContain('payload.wpsImageFallbackCount > 0');
  expect(clipboardPluginSource).toContain(
    "showWarningToast('WPS did not include one or more images. Paste missing images separately.')",
  );
});
```

- [ ] **Step 2: Run the plugin wiring test and verify RED**

Run: `npx jest --runInBand tests/unit/documents/document-editor-media-link-controls.test.ts`

Expected: FAIL because the plugin does not import or call the warning utility.

- [ ] **Step 3: Add one warning call to the handled rich-paste path**

Import `showWarningToast`. Immediately after `event.preventDefault()` and before calling `insertRichPasteWithPlaceholders`, add:

```ts
if (payload.wpsImageFallbackCount > 0) {
  showWarningToast(
    'WPS did not include one or more images. Paste missing images separately.',
  );
}
```

This branch executes exactly once per paste and does not depend on asynchronous upload outcomes.

- [ ] **Step 4: Run the plugin and clipboard unit tests and verify GREEN**

Run: `npx jest --runInBand tests/unit/documents/document-editor-media-link-controls.test.ts tests/unit/documents/document-clipboard-images.test.ts`

Expected: PASS with both suites green.

- [ ] **Step 5: Commit the warning behavior**

```bash
git add src/components/documents/documentClipboardImagePastePlugin.tsx tests/unit/documents/document-editor-media-link-controls.test.ts
git commit -m "fix: warn when WPS omits pasted image data"
```

### Task 3: Prove the fallback survives browser persistence

**Files:**
- Modify: `tests/e2e/specs/documents.spec.ts`

**Interfaces:**
- Consumes: the existing document authoring test's editor, clipboard permissions, autosave response helper, and reload verification.
- Produces: a Chromium regression covering formatted WPS mixed HTML, inline marker ordering, warning toast, and persisted content.

- [ ] **Step 1: Add a WPS fallback paste step to the document E2E test**

Define unique English text and the exact fallback marker near the existing mixed-paste constants. Add a test step after the existing HTML data-image paste that writes `text/plain` plus WPS-style `text/html` containing `<strong>` text around a local `file:///C:/Users/Test/AppData/Local/Temp/ksohtml/wps_clip_image-3.png` image, then presses `Control+V`.

Assert the editor contains both surrounding strings, retains `<strong>`, contains the marker between them, displays exactly one status toast with `WPS did not include one or more images. Paste missing images separately.`, completes a durable Yjs append, and remains live. Extend the existing reload step to assert the marker and surrounding order are still present.

Core browser-side ordering assertion:

```ts
const fallbackOrder = await editor.evaluate((element, values) => {
  const text = element.textContent ?? '';
  return [
    text.indexOf(values.before),
    text.indexOf(values.marker),
    text.indexOf(values.after),
  ];
}, { before: wpsBefore, marker: wpsFallbackMarker, after: wpsAfter });
expect(fallbackOrder[0]).toBeGreaterThanOrEqual(0);
expect(fallbackOrder[1]).toBeGreaterThan(fallbackOrder[0]!);
expect(fallbackOrder[2]).toBeGreaterThan(fallbackOrder[1]!);
```

- [ ] **Step 2: Run the Chromium regression**

Run: `npx playwright test tests/e2e/specs/documents.spec.ts --project=chromium --grep "create -> edit -> link -> image -> autosave -> reload -> viewer"`

Expected: PASS, including WPS fallback toast, order, collaboration persistence, and reload assertions.

- [ ] **Step 3: Commit the browser regression**

```bash
git add tests/e2e/specs/documents.spec.ts
git commit -m "test: cover WPS mixed paste fallback"
```

### Task 4: Run repository gates and prepare delivery

**Files:**
- Verify only: `src/components/documents/documentClipboardImages.ts`
- Verify only: `src/components/documents/documentClipboardImagePastePlugin.tsx`
- Verify only: `tests/unit/documents/document-clipboard-images.test.ts`
- Verify only: `tests/unit/documents/document-editor-media-link-controls.test.ts`
- Verify only: `tests/e2e/specs/documents.spec.ts`
- Verify only: `docs/superpowers/specs/2026-09-10-wps-mixed-paste-placeholder-design.md`
- Verify only: `docs/superpowers/plans/2026-09-10-wps-mixed-paste-placeholder.md`

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: fresh evidence for unit, E2E, lint, build, source-language, formatting, and migration gates.

- [ ] **Step 1: Run focused regressions**

Run:

```bash
npx jest --runInBand tests/unit/documents/document-clipboard-images.test.ts tests/unit/documents/document-editor-media-link-controls.test.ts
npx playwright test tests/e2e/specs/documents.spec.ts --project=chromium --grep "create -> edit -> link -> image -> autosave -> reload -> viewer"
```

Expected: both commands exit 0 with no failed tests.

- [ ] **Step 2: Run full unit, lint, and production build gates**

Run:

```bash
npm run test:unit -- --runInBand
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run formatting, language, and migration gates**

Run:

```bash
git diff --check origin/main...HEAD
git grep -nI -P '[\x{4E00}-\x{9FFF}\x{3400}-\x{4DBF}\x{F900}-\x{FAFF}]' -- .
git diff --name-only origin/main -- supabase/migrations/
```

Expected: the first command exits 0; the latter two print no paths or matches.

- [ ] **Step 4: Review the final diff against the approved design**

Run: `git diff --stat origin/main...HEAD && git diff origin/main...HEAD -- src/components/documents/documentClipboardImages.ts src/components/documents/documentClipboardImagePastePlugin.tsx tests/unit/documents/document-clipboard-images.test.ts tests/unit/documents/document-editor-media-link-controls.test.ts tests/e2e/specs/documents.spec.ts`

Expected: only the approved WPS recovery, fallback, toast, and regression changes appear; no fetch path or migration is present.

- [ ] **Step 5: Push, open or update the pull request, and merge only after required checks are green**

```bash
git push -u origin bugfix-wps-mixed-paste-placeholder
```

Use the repository's normal GitHub PR flow. Verify every required PR check is successful before merging. After merge, identify the exact merge commit and wait for every workflow attached to that SHA to complete successfully.
