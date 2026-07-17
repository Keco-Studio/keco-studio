# Library Table Rich Clipboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copying or cutting project table cells supplies an HTML table to the in-app document editor while preserving the existing TSV clipboard behavior everywhere else.

**Architecture:** Add a framework-light library clipboard module that turns the existing ordered cell matrix into TSV and escaped HTML, then writes both MIME types through the rich Clipboard API with a plain-text fallback. Keep selection extraction, internal session storage, copy/cut feedback, and document editing unchanged; `useClipboardOperations` only delegates final serialization and system clipboard writing.

**Tech Stack:** TypeScript, browser Clipboard API (`ClipboardItem`, `Blob`), React hooks, Jest 30.

## Global Constraints

- The copied selection remains the sole source of rows and columns; do not automatically prepend project property names.
- If the matrix already contains a column-name row, preserve it as the first table row.
- MDXEditor/GFM treats the first selected row as the document table header without
  synthesizing project property names or changing its values.
- Pasting creates a native editable document table for editors and remains read-only for viewers through existing document permissions.
- The pasted table is an independent snapshot with no source identifiers, refresh behavior, live reference, or bidirectional synchronization.
- Preserve the exact current null-to-empty TSV representation and session-storage signature.
- Copy and cut must share the same rich clipboard path.
- A rich clipboard failure must fall back to `writeText`; total system clipboard failure must not block internal copy/cut state.
- Do not add dependencies or change the current list of copyable project field types.

---

### Task 1: Rich Clipboard Serialization and Writer

**Files:**
- Create: `src/components/libraries/hooks/libraryRichClipboard.ts`
- Create: `tests/unit/library-rich-clipboard.test.ts`

**Interfaces:**
- Consumes: `matrixToTsvString(matrix)` from `libraryClipboardStorage.ts`.
- Produces: `serializeLibraryClipboardMatrix(matrix): SerializedLibraryClipboard` and `writeLibraryClipboard(payload, dependencies?): Promise<void>`.

- [ ] **Step 1: Write the failing serializer tests**

Create `tests/unit/library-rich-clipboard.test.ts` with the serialization cases first:

```ts
import { describe, expect, it, jest } from '@jest/globals';
import {
  serializeLibraryClipboardMatrix,
  writeLibraryClipboard,
  type ClipboardItemConstructor,
} from '@/components/libraries/hooks/libraryRichClipboard';

describe('library rich clipboard', () => {
  it('serializes only selected rows without inventing column names', () => {
    expect(
      serializeLibraryClipboardMatrix([
        ['Alice', 10],
        ['Bob', null],
      ]),
    ).toEqual({
      plainText: 'Alice\t10\nBob\t',
      html: '<table><tbody><tr><td>Alice</td><td>10</td></tr><tr><td>Bob</td><td></td></tr></tbody></table>',
    });
  });

  it('preserves an existing column-name row as ordinary table content', () => {
    const result = serializeLibraryClipboardMatrix([
      ['Name', 'Score'],
      ['Alice', 10],
    ]);

    expect(result.html).toBe(
      '<table><tbody><tr><td>Name</td><td>Score</td></tr><tr><td>Alice</td><td>10</td></tr></tbody></table>',
    );
    expect(result.html).not.toContain('<th>');
  });

  it('escapes HTML-sensitive content without changing TSV text', () => {
    const value = `<script title="quoted">& 'text'</script>`;
    const result = serializeLibraryClipboardMatrix([[value]]);

    expect(result.plainText).toBe(value);
    expect(result.html).toBe(
      '<table><tbody><tr><td>&lt;script title=&quot;quoted&quot;&gt;&amp; &#39;text&#39;&lt;/script&gt;</td></tr></tbody></table>',
    );
  });
});
```

- [ ] **Step 2: Run the serializer test to verify RED**

Run:

```bash
npx jest tests/unit/library-rich-clipboard.test.ts --runInBand
```

Expected: FAIL because `libraryRichClipboard` does not exist.

- [ ] **Step 3: Implement the minimal serializer**

Create `src/components/libraries/hooks/libraryRichClipboard.ts`:

```ts
import { matrixToTsvString } from './libraryClipboardStorage';

export type LibraryClipboardMatrix = Array<Array<string | number | null>>;

export type SerializedLibraryClipboard = {
  plainText: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function serializeLibraryClipboardMatrix(
  matrix: LibraryClipboardMatrix,
): SerializedLibraryClipboard {
  const rows = matrix
    .map((row) => {
      const cells = row
        .map((cell) => `<td>${escapeHtml(cell === null ? '' : String(cell))}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return {
    plainText: matrixToTsvString(matrix),
    html: `<table><tbody>${rows}</tbody></table>`,
  };
}
```

- [ ] **Step 4: Run the serializer tests to verify GREEN**

Run:

```bash
npx jest tests/unit/library-rich-clipboard.test.ts --runInBand
```

Expected: 3 tests PASS.

- [ ] **Step 5: Add failing rich-write and fallback tests**

Append inside the existing `describe` block:

```ts
  it('writes plain text and HTML in one ClipboardItem', async () => {
    class FakeClipboardItem {
      constructor(public readonly data: Record<string, Blob>) {}
    }
    const write = jest.fn<(items: ClipboardItem[]) => Promise<void>>().mockResolvedValue(undefined);
    const writeText = jest.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

    await writeLibraryClipboard(
      { plainText: 'Alice\t10', html: '<table></table>' },
      {
        clipboard: { write, writeText },
        ClipboardItem: FakeClipboardItem as unknown as ClipboardItemConstructor,
      },
    );

    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    const item = write.mock.calls[0][0][0] as unknown as FakeClipboardItem;
    expect(await item.data['text/plain'].text()).toBe('Alice\t10');
    expect(await item.data['text/html'].text()).toBe('<table></table>');
  });

  it('falls back to writeText when the rich write rejects', async () => {
    class FakeClipboardItem {
      constructor(public readonly data: Record<string, Blob>) {}
    }
    const write = jest.fn<(items: ClipboardItem[]) => Promise<void>>().mockRejectedValue(new Error('denied'));
    const writeText = jest.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

    await writeLibraryClipboard(
      { plainText: 'Alice\t10', html: '<table></table>' },
      {
        clipboard: { write, writeText },
        ClipboardItem: FakeClipboardItem as unknown as ClipboardItemConstructor,
      },
    );

    expect(writeText).toHaveBeenCalledWith('Alice\t10');
  });

  it('uses writeText when ClipboardItem is unavailable', async () => {
    const write = jest.fn<(items: ClipboardItem[]) => Promise<void>>().mockResolvedValue(undefined);
    const writeText = jest.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

    await writeLibraryClipboard(
      { plainText: 'Alice\t10', html: '<table></table>' },
      { clipboard: { write, writeText }, ClipboardItem: undefined },
    );

    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('Alice\t10');
  });
```

- [ ] **Step 6: Run the writer tests to verify RED**

Run:

```bash
npx jest tests/unit/library-rich-clipboard.test.ts --runInBand
```

Expected: FAIL because `ClipboardItemConstructor` and `writeLibraryClipboard` are not exported.

- [ ] **Step 7: Implement rich writing with a plain-text fallback**

Append to `libraryRichClipboard.ts`:

```ts
type ClipboardWriter = Partial<Pick<Clipboard, 'write' | 'writeText'>>;

export type ClipboardItemConstructor = new (
  items: Record<string, Blob>,
) => ClipboardItem;

type ClipboardDependencies = {
  clipboard?: ClipboardWriter;
  ClipboardItem?: ClipboardItemConstructor;
};

export async function writeLibraryClipboard(
  payload: SerializedLibraryClipboard,
  dependencies: ClipboardDependencies = {},
): Promise<void> {
  const clipboard = dependencies.clipboard ??
    (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);
  const ClipboardItemClass = Object.prototype.hasOwnProperty.call(dependencies, 'ClipboardItem')
    ? dependencies.ClipboardItem
    : typeof globalThis.ClipboardItem !== 'undefined'
      ? globalThis.ClipboardItem
      : undefined;

  if (!clipboard) return;

  if (ClipboardItemClass && typeof clipboard.write === 'function') {
    try {
      await clipboard.write([
        new ClipboardItemClass({
          'text/plain': new Blob([payload.plainText], { type: 'text/plain' }),
          'text/html': new Blob([payload.html], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch {
      // Fall through to the broadly supported plain-text API.
    }
  }

  if (typeof clipboard.writeText === 'function') {
    await clipboard.writeText(payload.plainText);
  }
}
```

Review amendment: the writer suite also covers these compatibility branches in the same
test file:

```ts
it('uses writeText when the clipboard has no rich write method', async () => {
  const writeText = jest.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  await writeLibraryClipboard(payload, { clipboard: { writeText } });
  expect(writeText).toHaveBeenCalledWith(payload.plainText);
});

it('rejects only after both rich and plain-text writes fail', async () => {
  const write = jest.fn<(items: ClipboardItem[]) => Promise<void>>()
    .mockRejectedValue(new Error('rich denied'));
  const writeText = jest.fn<(text: string) => Promise<void>>()
    .mockRejectedValue(new Error('plain denied'));
  await expect(writeLibraryClipboard(payload, {
    clipboard: { write, writeText },
    ClipboardItem: FakeClipboardItem as unknown as ClipboardItemConstructor,
  })).rejects.toThrow('plain denied');
});

it('resolves when no clipboard write API is available', async () => {
  await expect(writeLibraryClipboard(payload, {
    clipboard: {},
    ClipboardItem: undefined,
  })).resolves.toBeUndefined();
});
```

In these examples, `payload` is `{ plainText: 'Alice\t10', html: '<table></table>' }`
and `FakeClipboardItem` is the test double defined by the rich-write cases above.

- [ ] **Step 8: Run focused tests and type checking**

Run:

```bash
npx jest tests/unit/library-rich-clipboard.test.ts --runInBand
npm run typecheck
```

Expected: 9 tests PASS and TypeScript exits 0.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/components/libraries/hooks/libraryRichClipboard.ts tests/unit/library-rich-clipboard.test.ts
git commit -m "feat: add rich library clipboard payloads"
```

---

### Task 2: Copy and Cut Integration

**Files:**
- Modify: `src/components/libraries/hooks/useClipboardOperations.ts`
- Create: `tests/unit/library-rich-clipboard-wiring.test.ts`

**Interfaces:**
- Consumes: `serializeLibraryClipboardMatrix` and `writeLibraryClipboard` from Task 1.
- Produces: both `handleCopy` and `handleCut` write dual-MIME clipboard payloads without changing their existing internal state or TSV signatures.

- [ ] **Step 1: Write the failing wiring test**

Create `tests/unit/library-rich-clipboard-wiring.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/components/libraries/hooks/useClipboardOperations.ts'),
  'utf8',
);

describe('library rich clipboard wiring', () => {
  it('routes copy and cut through the shared rich clipboard writer', () => {
    expect(source).toContain("from './libraryRichClipboard'");
    expect(source.match(/serializeLibraryClipboardMatrix\(clipboardArray\)/g)).toHaveLength(2);
    expect(source.match(/writeLibraryClipboard\(clipboardPayload\)/g)).toHaveLength(2);
    expect(source).not.toContain('navigator.clipboard.writeText');
  });
});
```

- [ ] **Step 2: Run the wiring test to verify RED**

Run:

```bash
npx jest tests/unit/library-rich-clipboard-wiring.test.ts --runInBand
```

Expected: FAIL because `useClipboardOperations` still calls `navigator.clipboard.writeText` directly.

- [ ] **Step 3: Import the shared clipboard helpers**

Add beside the existing `libraryClipboardStorage` import:

```ts
import {
  serializeLibraryClipboardMatrix,
  writeLibraryClipboard,
} from './libraryRichClipboard';
```

- [ ] **Step 4: Replace the cut clipboard block**

Replace the cut handler's manual TSV construction and `navigator.clipboard.writeText` block with:

```ts
    const clipboardPayload = serializeLibraryClipboardMatrix(clipboardArray);
    const clipboardText = clipboardPayload.plainText;

    void writeLibraryClipboard(clipboardPayload).catch((error) => {
      console.error('Failed to copy to clipboard:', error);
    });
```

Keep `clipboardText` as the `tsvSignature` passed to `persistLibraryClipboard`.

- [ ] **Step 5: Replace the copy clipboard block**

Replace the copy handler's manual TSV construction and `navigator.clipboard.writeText` block with the same shared call:

```ts
    const clipboardPayload = serializeLibraryClipboardMatrix(clipboardArray);
    const clipboardText = clipboardPayload.plainText;

    void writeLibraryClipboard(clipboardPayload).catch((error) => {
      console.error('Failed to copy to clipboard:', error);
    });
```

Keep `clipboardText` as the `tsvSignature` passed to `persistLibraryClipboard`.

- [ ] **Step 6: Run focused tests to verify GREEN**

Run:

```bash
npx jest tests/unit/library-rich-clipboard.test.ts tests/unit/library-rich-clipboard-wiring.test.ts --runInBand
```

Expected: 2 suites and 10 tests PASS.

- [ ] **Step 7: Run regression verification**

Run:

```bash
npm run typecheck
npm run lint -- src/components/libraries/hooks/libraryRichClipboard.ts src/components/libraries/hooks/useClipboardOperations.ts tests/unit/library-rich-clipboard.test.ts tests/unit/library-rich-clipboard-wiring.test.ts
npm run test:unit -- --runInBand
git diff --check
```

Expected: all commands exit 0; the full unit suite reports no failures; `git diff --check` prints no output.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/components/libraries/hooks/useClipboardOperations.ts tests/unit/library-rich-clipboard-wiring.test.ts
git commit -m "fix: preserve tables copied into documents"
```

---

### Task 3: Browser-to-Document Integration Regression

**Files:**
- Create: `tests/e2e/specs/library-table-document-copy.spec.ts`

**Interfaces:**
- Consumes: the real library table selection/copy UI, browser Clipboard API, document
  route, MDXEditor table importer, and durable Yjs document persistence.
- Produces: end-to-end proof that copied cells become an editable independent document
  table whose first selected row is the GFM header.

- [ ] **Step 1: Create an isolated browser fixture**

Use `getE2EAdminClient`, `createTemporaryUser`, and `createProjectFixture` to create one
owner, project, two-field library, two assets with a 2x2 value matrix, and an empty
document. Use `Source title` and `Source points` as property labels while the first asset
contains `Name` and `Score`, proving property labels are not automatically copied.

- [ ] **Step 2: Exercise the real copy and paste path**

Grant Chromium `clipboard-read` and `clipboard-write` permissions for
`http://localhost:3000`. Log in, select both source rows through their rendered checkboxes,
press `Control+c`, and assert the clipboard exposes both `text/plain` and `text/html`.
Navigate to the document, press `Control+v` in the real contenteditable, and assert a
native table renders `Name`/`Score` as `<th>` and `Alice`/`10` as `<td>`.

- [ ] **Step 3: Prove editing, persistence, and snapshot independence**

Select the `Alice` cell contents with a DOM Range, type `Alicia in document`, await the
durable `append_document_yjs_updates` response, reload, and assert the edited document
table persists. Query `library_asset_values` with the admin client and assert the source
value remains `Alice`.

- [ ] **Step 4: Run the focused browser test**

```bash
npx playwright test tests/e2e/specs/library-table-document-copy.spec.ts --project=chromium --workers=1
```

Expected: 1 test PASS with an isolated fixture cleaned in `afterAll`.

- [ ] **Step 5: Run final regression verification and commit**

```bash
npm run typecheck
npx eslint tests/e2e/specs/library-table-document-copy.spec.ts
npm run test:unit -- --runInBand
git diff --check
git add docs/superpowers/specs/2026-07-17-library-table-rich-clipboard-design.md docs/superpowers/plans/2026-07-17-library-table-rich-clipboard.md tests/e2e/specs/library-table-document-copy.spec.ts
git commit -m "test: cover table copy into documents"
```
