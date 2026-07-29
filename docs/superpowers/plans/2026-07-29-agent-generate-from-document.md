# Agent Generate From Document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Agent chat generate a Document’s table/conversation via the same Story IR derived-import pipeline as sidebar right-click Generate table / Generate conversation.

**Architecture:** Add `generate_from_document` agent write tool that resolves an existing project Document, loads export source (admin gate), converts markdown with `toScriptImportPlainText`, runs `resolveStoryForImport` + `importStoryDocument` with `documentSource`, and returns library invalidations including `sourceDocumentId`. Update system prompt so chat requests for this intent use the new tool instead of `setup_library` / folder `import_script`.

**Tech Stack:** TypeScript, Zod, existing agent tool registry, `scriptImportService` / `scriptConversionService`, Jest unit tests, optional Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-07-29-agent-generate-from-document-design.md`

## Global Constraints

- Match RMB Generate table → `exportType: 'table'` and Generate conversation → `exportType: 'script'`.
- Admin only (`requiredPermission: 'admin'` + same empty-document / snapshot behavior as export source).
- Do not change TopBar Export as tables Agent handoff in this plan.
- Do not approximate with `setup_library` / `create_library` / folder `import_script`.
- Derived library names use `defaultDerivedLibraryName(documentName, exportType)`.
- Confirmation follows conversation mode (`confirmationPolicy: 'mode'`, `pre_execute`).

## File map

| File | Responsibility |
| --- | --- |
| `src/lib/agent/tools/generate-from-document.ts` | New tool (+ prepareConfirmation + executeStream) |
| `src/lib/agent/tools/index.ts` | Register tool |
| `src/lib/agent/prompts.ts` | DOCUMENT DERIVED GENERATE routing rules |
| `src/components/agent/ConfirmationCard.tsx` | Human label for the tool |
| `tests/unit/agent/generate-from-document.test.ts` | Tool behavior tests |
| `tests/unit/agent/system-prompt.test.ts` | Prompt routing assertions |
| `tests/e2e/specs/agent-chat.spec.ts` (or derived-libraries) | Optional smoke for nested outcome |

---

### Task 1: Failing unit tests for `generate_from_document`

**Files:**
- Create: `tests/unit/agent/generate-from-document.test.ts`
- Create (later Task 2): `src/lib/agent/tools/generate-from-document.ts`

**Interfaces:**
- Produces expectations for tool name `generate_from_document`, params `{ documentId?, documentName?, folderName?, exportType: 'table' \| 'script' }`, success `invalidations` including `sourceDocumentId`, admin gate error string containing `Only admin`.

- [ ] **Step 1: Write the failing test file**

```ts
/**
 * @jest-environment node
 */
import { generateFromDocument } from '@/lib/agent/tools/generate-from-document';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('@/lib/agent/document-resolver', () => ({
  resolveDocumentForTool: jest.fn(),
}));
jest.mock('@/lib/server/documentExportSourceService', () => ({
  getDocumentExportSource: jest.fn(),
}));
jest.mock('@/lib/services/scriptConversionService', () => ({
  resolveStoryForImport: jest.fn(),
}));
jest.mock('@/lib/services/scriptImportService', () => ({
  importStoryDocument: jest.fn(),
}));

import { resolveDocumentForTool } from '@/lib/agent/document-resolver';
import { getDocumentExportSource } from '@/lib/server/documentExportSourceService';
import { resolveStoryForImport } from '@/lib/services/scriptConversionService';
import { importStoryDocument } from '@/lib/services/scriptImportService';

const resolveDocumentForToolMock = resolveDocumentForTool as jest.MockedFunction<typeof resolveDocumentForTool>;
const getDocumentExportSourceMock = getDocumentExportSource as jest.MockedFunction<typeof getDocumentExportSource>;
const resolveStoryForImportMock = resolveStoryForImport as jest.MockedFunction<typeof resolveStoryForImport>;
const importStoryDocumentMock = importStoryDocument as jest.MockedFunction<typeof importStoryDocument>;

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    supabase: {} as ToolContext['supabase'],
    userId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    userRole: 'admin',
    ...overrides,
  } as ToolContext;
}

describe('generate_from_document', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unsupported exportType', async () => {
    const result = await generateFromDocument.execute(
      { documentId: '33333333-3333-4333-8333-333333333333', exportType: 'pdf' },
      makeCtx()
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exportType/i);
  });

  it('returns candidates when document name is ambiguous', async () => {
    resolveDocumentForToolMock.mockResolvedValue({
      ok: false,
      code: 'AMBIGUOUS',
      error: 'Multiple documents named "Story".',
      candidates: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Story',
          folderId: null,
          folderName: null,
          updatedAt: '2026-07-29T00:00:00.000Z',
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Story',
          folderId: null,
          folderName: null,
          updatedAt: '2026-07-29T00:00:00.000Z',
        },
      ],
    });

    const result = await generateFromDocument.execute(
      { documentName: 'Story', exportType: 'table' },
      makeCtx()
    );

    expect(result.success).toBe(false);
    expect(result.data).toEqual(
      expect.objectContaining({
        candidates: expect.any(Array),
      })
    );
  });

  it('fails for non-admin before import', async () => {
    resolveDocumentForToolMock.mockResolvedValue({
      ok: true,
      source: 'id',
      document: {
        id: '33333333-3333-4333-8333-333333333333',
        project_id: '22222222-2222-4222-8222-222222222222',
        folder_id: null,
        name: 'Story',
        description: null,
        created_at: '',
        updated_at: '2026-07-29T00:00:00.000Z',
        updated_by: null,
        folderName: null,
      },
    });
    getDocumentExportSourceMock.mockRejectedValue(
      new Error('Only admin users can export project content')
    );

    const result = await generateFromDocument.execute(
      { documentId: '33333333-3333-4333-8333-333333333333', exportType: 'script' },
      makeCtx({ userRole: 'editor' })
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Only admin');
    expect(importStoryDocumentMock).not.toHaveBeenCalled();
  });

  it('imports a derived table library nested under the document', async () => {
    resolveDocumentForToolMock.mockResolvedValue({
      ok: true,
      source: 'id',
      document: {
        id: '33333333-3333-4333-8333-333333333333',
        project_id: '22222222-2222-4222-8222-222222222222',
        folder_id: '55555555-5555-4555-8555-555555555555',
        name: 'Story',
        description: null,
        created_at: '',
        updated_at: '2026-07-29T00:00:00.000Z',
        updated_by: null,
        folderName: 'Acts',
      },
    });
    getDocumentExportSourceMock.mockResolvedValue({
      documentId: '33333333-3333-4333-8333-333333333333',
      documentName: 'Story',
      projectId: '22222222-2222-4222-8222-222222222222',
      folderId: '55555555-5555-4555-8555-555555555555',
      markdown: '# Chapter\n\nHello.',
      token: { epoch: 1, revision: 1 },
      snapshotToken: 'snap',
    });
    resolveStoryForImportMock.mockResolvedValue({
      document: { type: 'story', version: 1, scenes: [] } as never,
    });
    importStoryDocumentMock.mockResolvedValue({
      libraryId: '66666666-6666-4666-8666-666666666666',
      rowCount: 3,
      fieldCount: 5,
    });

    const result = await generateFromDocument.execute(
      { documentId: '33333333-3333-4333-8333-333333333333', exportType: 'table' },
      makeCtx()
    );

    expect(result.success).toBe(true);
    expect(importStoryDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        libraryName: 'Story Table',
        folderId: '55555555-5555-4555-8555-555555555555',
        documentSource: {
          sourceDocumentId: '33333333-3333-4333-8333-333333333333',
          exportType: 'table',
        },
      })
    );
    expect(result.invalidations).toEqual([
      {
        type: 'library',
        id: '66666666-6666-4666-8666-666666666666',
        projectId: '22222222-2222-4222-8222-222222222222',
        sourceDocumentId: '33333333-3333-4333-8333-333333333333',
      },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/agent/generate-from-document.test.ts --runInBand`

Expected: FAIL (module `@/lib/agent/tools/generate-from-document` not found / export missing)

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/unit/agent/generate-from-document.test.ts
git commit -m "test: add failing coverage for generate_from_document"
```

---

### Task 2: Implement `generate_from_document` tool and register it

**Files:**
- Create: `src/lib/agent/tools/generate-from-document.ts`
- Modify: `src/lib/agent/tools/index.ts`
- Modify: `src/components/agent/ConfirmationCard.tsx` (add TOOL_LABELS entry)

**Interfaces:**
- Consumes: `resolveDocumentForTool`, `getDocumentExportSource`, `toScriptImportPlainText`, `defaultDerivedLibraryName`, `resolveStoryForImport`, `importStoryDocument`
- Produces: `export const generateFromDocument: AgentTool`

- [ ] **Step 1: Implement the tool**

Create `src/lib/agent/tools/generate-from-document.ts` following the same structure as `import-script.ts` for progress (`ProgressQueue`), and wire:

1. Zod params: `documentId?`, `documentName?`, `folderName?`, required `exportType: 'table' | 'script'`
2. `prepareConfirmation` seals `{ documentId, exportType }` and preview `{ type: 'generate_from_document', name, summary }`
3. `execute` / `executeStream`:
   - `resolveDocumentForTool`
   - `getDocumentExportSource` (admin + empty errors)
   - `toScriptImportPlainText`
   - `defaultDerivedLibraryName`
   - `resolveStoryForImport`
   - `importStoryDocument` with `documentSource: { sourceDocumentId, exportType }`
   - return `invalidations: [{ type: 'library', id, projectId, sourceDocumentId }]`
4. Tool metadata: `requiredPermission: 'admin'`, `confirmationMode: 'pre_execute'`, `confirmationPolicy: 'mode'`, `confirmationRequired: true`

Copy ProgressQueue from `src/lib/agent/tools/import-script.ts` rather than inventing a racing array of progress events.

- [ ] **Step 2: Register the tool**

In `src/lib/agent/tools/index.ts`, import `generateFromDocument` and add it to the `tools` array next to the other document write tools (after `deleteDocumentTool` is fine).

- [ ] **Step 3: Add confirmation label**

In `ConfirmationCard.tsx` `TOOL_LABELS`:

```ts
generate_from_document: 'Generate from document',
```

- [ ] **Step 4: Run unit tests**

Run: `npx jest tests/unit/agent/generate-from-document.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/lib/agent/tools/generate-from-document.ts \
  src/lib/agent/tools/index.ts \
  src/components/agent/ConfirmationCard.tsx \
  tests/unit/agent/generate-from-document.test.ts
git commit -m "feat(agent): add generate_from_document tool using derived import pipeline"
```

---

### Task 3: System prompt routing rules

**Files:**
- Modify: `src/lib/agent/prompts.ts`
- Modify: `tests/unit/agent/system-prompt.test.ts`

**Interfaces:**
- Consumes: Task 2 tool name `generate_from_document`
- Produces: prompt rules that forbid substituting `setup_library` / `create_library` / folder `import_script` for existing-Document generate table/conversation

- [ ] **Step 1: Write failing prompt assertions**

Append to `tests/unit/agent/system-prompt.test.ts`:

```ts
  it('routes existing-document generate table/conversation through generate_from_document', () => {
    const prompt = buildSystemPrompt({ projectId: 'project-1', userRole: 'admin' });

    expect(prompt).toContain('generate_from_document');
    expect(prompt).toContain('Generate table');
    expect(prompt).toContain('Generate conversation');
    expect(prompt).toMatch(
      /must not call setup_library[\s\S]*generate_from_document|generate_from_document[\s\S]*must not call setup_library/i
    );
  });
```

Run: `npx jest tests/unit/agent/system-prompt.test.ts --runInBand`

Expected: FAIL on the new assertion.

- [ ] **Step 2: Update `buildSystemPrompt`**

Add a new numbered rule near the DOCUMENT TARGETS / DOCUMENT EDITS section in `src/lib/agent/prompts.ts` (adjust numbering if needed to avoid duplicate `28.`):

```
29. DOCUMENT DERIVED GENERATE: When the user asks to generate a table or conversation/script from an existing project Document, call generate_from_document with exportType "table" (Generate table) or "script" (Generate conversation). This is the same path as Document right-click Generate table / Generate conversation. You MUST NOT call setup_library, create_library, or folder import_script for that intent. If the Document does not exist yet, create/edit it first, then call generate_from_document. Do not confuse this with [Document intent] tables / Export as tables design-document handoff, which still uses setup_library.
```

- [ ] **Step 3: Re-run prompt tests**

Run: `npx jest tests/unit/agent/system-prompt.test.ts --runInBand`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent/prompts.ts tests/unit/agent/system-prompt.test.ts
git commit -m "feat(agent): route document generate table/conversation to generate_from_document"
```

---

### Task 4: Smoke verification (manual or e2e)

**Files:**
- Optionally modify: `tests/e2e/specs/document-derived-libraries.spec.ts` or `tests/e2e/specs/agent-chat.spec.ts`

**Interfaces:**
- Consumes: working Agent chat + Task 2 tool

- [ ] **Step 1: Registry regression**

Add to `tests/unit/agent/generate-from-document.test.ts`:

```ts
import { allTools } from '@/lib/agent/tools';

it('is registered in allTools', () => {
  expect(allTools.some((tool) => tool.name === 'generate_from_document')).toBe(true);
});
```

Run: `npx jest tests/unit/agent/generate-from-document.test.ts --runInBand`

Expected: PASS

- [ ] **Step 2: Manual smoke (required if no e2e added)**

1. Sign in as project admin.
2. Open a non-empty Document.
3. In Agent chat (Confirm mode), ask: “Generate a table from this document”.
4. Approve the confirmation.
5. Expand the Document in the sidebar: a derived child named `{Document} Table` appears and opens as a library.
6. Repeat for “Generate conversation from this document” → `{Document} Conversation`.
7. Confirm no new independent top-level library was created for either request.

- [ ] **Step 3: Commit any e2e additions, or skip commit if only manual**

```bash
# only if e2e was added
git add tests/e2e/specs/...
git commit -m "test(e2e): cover agent generate_from_document derived nesting"
```

---

### Task 5: Spec status + final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-agent-generate-from-document-design.md` (Status → Implemented)

- [ ] **Step 1: Run the full local verification set**

```bash
npx jest \
  tests/unit/agent/generate-from-document.test.ts \
  tests/unit/agent/system-prompt.test.ts \
  --runInBand
```

Expected: all PASS

- [ ] **Step 2: Update spec status line to Implemented**

- [ ] **Step 3: Final commit for docs**

```bash
git add docs/superpowers/specs/2026-07-29-agent-generate-from-document-design.md
git commit -m "docs: mark agent generate_from_document spec implemented"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| New tool generate_from_document | Task 2 |
| table/script ≡ RMB Generate table/conversation | Tasks 1–2 |
| Admin gate + empty document | Tasks 1–2 |
| Story IR + nested derived library | Tasks 1–2 |
| Prompt forbids setup_library substitution | Task 3 |
| Confirmation / Auto mode policy | Task 2 (`confirmationPolicy: 'mode'`) |
| Client invalidation with sourceDocumentId | Task 2 return + existing `invalidateAgentCaches` |
| Out of scope: TopBar Export as tables | Not modified |
| Tests | Tasks 1, 3, 4 |

## Self-review notes

- No TBD placeholders.
- Tool name consistent: `generate_from_document` / `generateFromDocument`.
- Progress streaming must copy `import-script.ts` ProgressQueue to avoid racing events.
- `getDocumentExportSource` is `server-only`; tool runs only in agent API server context.
