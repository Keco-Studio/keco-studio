# Agent Project Document Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project documents first-class Keco Assistant resources with live current-document defaults, cross-document targeting, exact and semantic reads, precise content edits, metadata CRUD, and permanently confirmed deletion.

**Architecture:** Keep conversations bound to their original project while passing a verified live document hint on every turn. Reuse `documentService` for metadata, `documentStateGateway` and the existing Agent replacement command for content, add a shared document resolver and deterministic edit operations, and index living documents under a distinct `project_document` embedding source.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase/Postgres RLS and RPC, Yjs, Zod, Jest, Playwright, OpenAI-compatible embeddings.

---

## File Structure

### New focused modules

- `src/lib/agent/document-resolver.ts`: resolve a document selector inside one project and return safe ambiguity candidates.
- `src/lib/agent/document-read.ts`: produce full, outline, heading-section, and line-range reads from current Markdown.
- `src/lib/agent/document-edit-operations.ts`: deterministically apply replace/insert/append/delete operations to current Markdown.
- `src/lib/agent/tools/list-documents.ts`: exact metadata discovery without loading document bodies.
- `src/lib/agent/tools/rename-document.ts`: Agent adapter over `updateDocumentName`.
- `src/lib/agent/tools/move-document.ts`: Agent adapter over `moveDocument` and the existing folder resolver.
- `src/lib/agent/tools/delete-document.ts`: stable-ID deletion preview and confirmed apply phase.
- `src/lib/server/documentEmbeddingIndexService.ts`: actor-checked service-role boundary for document embedding writes.
- `src/app/api/agent-chat/reindex/document/route.ts`: authenticated, debounced-editor reindex endpoint.
- `supabase/migrations/20260716070000_agent_project_document_embeddings.sql`: add `project_document`, matching scope, and deletion cleanup.

### Existing files with additive changes

- `src/lib/agent/types.ts`: live document context and confirmation policy.
- `src/components/agent/types.ts`: send current document ID and render document invalidations.
- `src/components/agent/ChatPanel.tsx`: read `currentDocumentId` and keep the panel open between documents in one project.
- `src/components/agent/useAgentChat.ts`: send live document context on every turn and invalidate document query keys.
- `src/app/api/agent-chat/route.ts`: verify live document context against the bound project.
- `src/lib/agent/context-message.ts`, `src/lib/agent/prompts.ts`: describe the live default and explicit override rules.
- `src/lib/agent/tools/list-project-structure.ts`: include lightweight document summaries.
- `src/lib/agent/tools/read-document.ts`, `create-document.ts`, `propose-document-edit.ts`, `index.ts`: extend existing document capabilities.
- `src/lib/agent/conversation-meta.ts`, `src/lib/agent/core.ts`: support mode-driven versus always-required confirmation.
- `src/lib/agent/chunking.ts`, `embedding-config.ts`, `embedding-index.ts`, `embedding-retrieval.ts`, `tools/semantic-search.ts`: index and retrieve living project documents.
- `src/components/documents/useDocumentCollaboration.ts`: schedule a reindex after a successful durable flush/compaction.
- `src/components/agent/ConfirmationCard.tsx`, `ChatMessage.tsx`: render document deletion previews with the generic confirmation card.
- `src/app/api/agent-chat/reindex/route.ts`: include project documents in admin backfill.

## Task 1: Document Resolution And Discovery

**Files:**
- Create: `src/lib/agent/document-resolver.ts`
- Create: `src/lib/agent/tools/list-documents.ts`
- Modify: `src/lib/agent/tools/list-project-structure.ts`
- Modify: `src/lib/agent/tools/index.ts`
- Test: `tests/unit/agent/document-resolver.test.ts`
- Test: `tests/unit/agent/list-project-structure-documents.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Create `tests/unit/agent/document-resolver.test.ts` with project-scoped fixtures and these assertions:

```ts
import { resolveDocumentForTool } from '@/lib/agent/document-resolver';

function doc(id: string, name: string, folderId: string | null) {
  return {
    id,
    project_id: PROJECT_ID,
    folder_id: folderId,
    name,
    created_at: '2026-07-16T00:00:00.000Z',
    updated_at: '2026-07-16T01:00:00.000Z',
  };
}

it('prefers an explicit id over name and current context', async () => {
  listDocuments.mockResolvedValue([
    doc('11111111-1111-4111-8111-111111111111', 'Open document', null),
    doc('22222222-2222-4222-8222-222222222222', 'Requested document', null),
  ]);
  await expect(resolveDocumentForTool(supabase, PROJECT_ID, {
    documentId: '22222222-2222-4222-8222-222222222222',
    documentName: 'Open document',
  }, { currentDocumentId: '11111111-1111-4111-8111-111111111111' }))
    .resolves.toMatchObject({ ok: true, document: { name: 'Requested document' } });
});

it('returns safe candidates instead of guessing between duplicate names', async () => {
  listDocuments.mockResolvedValue([
    doc(DOC_A, '班会总结', FOLDER_A),
    doc(DOC_B, '班会总结', FOLDER_B),
  ]);
  await expect(resolveDocumentForTool(supabase, PROJECT_ID, {
    documentName: '班会总结',
  }, {})).resolves.toEqual({
    ok: false,
    code: 'AMBIGUOUS',
    error: 'Multiple documents named "班会总结" exist in this project.',
    candidates: expect.arrayContaining([
      expect.objectContaining({ id: DOC_A, name: '班会总结', folderName: '教学资料' }),
      expect.objectContaining({ id: DOC_B, name: '班会总结', folderName: '归档' }),
    ]),
  });
});

it('uses the verified current document only when no explicit selector exists', async () => {
  listDocuments.mockResolvedValue([doc(DOC_A, 'Current', null)]);
  await expect(resolveDocumentForTool(
    supabase,
    PROJECT_ID,
    {},
    { currentDocumentId: DOC_A }
  )).resolves.toMatchObject({ ok: true, source: 'current' });
});
```

- [ ] **Step 2: Run the resolver tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/document-resolver.test.ts
```

Expected: FAIL because `@/lib/agent/document-resolver` does not exist.

- [ ] **Step 3: Implement the shared resolver**

Create `src/lib/agent/document-resolver.ts` with these public contracts and complete resolution order:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { listDocuments, type DocumentSummary } from '@/lib/services/documentService';
import { listProjectFolders } from './data-access';

export type DocumentSelector = {
  documentId?: string;
  documentName?: string;
  folderName?: string;
};

export type ResolvedDocument = DocumentSummary & { folderName: string | null };

export type DocumentResolution =
  | { ok: true; document: ResolvedDocument; source: 'id' | 'name' | 'current' }
  | { ok: false; code: 'NOT_FOUND' | 'AMBIGUOUS' | 'NO_TARGET'; error: string; candidates?: ResolvedDocument[] };

export async function listResolvedProjectDocuments(
  supabase: SupabaseClient,
  projectId: string
): Promise<ResolvedDocument[]> {
  const [documents, folders] = await Promise.all([
    listDocuments(supabase, projectId),
    listProjectFolders(supabase, projectId),
  ]);
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
  return documents.map((document) => ({
    ...document,
    folderName: document.folder_id ? folderNames.get(document.folder_id) ?? null : null,
  }));
}

export async function resolveDocumentForTool(
  supabase: SupabaseClient,
  projectId: string,
  selector: DocumentSelector,
  context: { currentDocumentId?: string }
): Promise<DocumentResolution> {
  const documents = await listResolvedProjectDocuments(supabase, projectId);
  if (selector.documentId) {
    const match = documents.find((document) => document.id === selector.documentId);
    return match
      ? { ok: true, document: match, source: 'id' }
      : { ok: false, code: 'NOT_FOUND', error: 'Document not found in this project.' };
  }
  if (selector.documentName) {
    const matches = documents.filter((document) =>
      document.name === selector.documentName &&
      (!selector.folderName || document.folderName === selector.folderName)
    );
    if (matches.length === 1) return { ok: true, document: matches[0], source: 'name' };
    if (matches.length > 1) {
      return {
        ok: false,
        code: 'AMBIGUOUS',
        error: `Multiple documents named "${selector.documentName}" exist in this project.`,
        candidates: matches,
      };
    }
    return { ok: false, code: 'NOT_FOUND', error: `Document "${selector.documentName}" not found.` };
  }
  if (context.currentDocumentId) {
    const match = documents.find((document) => document.id === context.currentDocumentId);
    if (match) return { ok: true, document: match, source: 'current' };
  }
  return { ok: false, code: 'NO_TARGET', error: 'No document was specified and no document is currently open.' };
}
```

- [ ] **Step 4: Add `list_documents` and document summaries to project structure**

Create `src/lib/agent/tools/list-documents.ts` with a closed Zod schema containing optional `nameQuery`, `folderName`, and `limit`. Return `id`, `name`, `folderId`, `folderName`, `createdAt`, and `updatedAt`; never return content. Update `list-project-structure.ts` to call `listResolvedProjectDocuments` and add:

```ts
documents: documents.map((document) => ({
  id: document.id,
  name: document.name,
  folderId: document.folder_id,
  folderName: document.folderName,
  updatedAt: document.updated_at,
})),
documentCount: documents.length,
```

Register `listDocumentsTool` beside `listProjectStructure` in `src/lib/agent/tools/index.ts`.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/document-resolver.test.ts tests/unit/agent/list-project-structure-documents.test.ts
npm run typecheck
```

Expected: PASS and zero TypeScript errors.

Commit:

```bash
git add src/lib/agent/document-resolver.ts src/lib/agent/tools/list-documents.ts src/lib/agent/tools/list-project-structure.ts src/lib/agent/tools/index.ts tests/unit/agent/document-resolver.test.ts tests/unit/agent/list-project-structure-documents.test.ts
git commit -m "feat: add agent document discovery"
```

## Task 2: Live Current-Document Context On Every Turn

**Files:**
- Modify: `src/lib/agent/types.ts`
- Modify: `src/components/agent/types.ts`
- Modify: `src/components/agent/ChatPanel.tsx`
- Modify: `src/components/agent/useAgentChat.ts`
- Modify: `src/app/api/agent-chat/route.ts`
- Modify: `src/lib/agent/context-message.ts`
- Modify: `src/lib/agent/prompts.ts`
- Test: `tests/unit/agent/document-context.test.ts`
- Test: `tests/unit/agent/selection-context-message.test.ts`
- Test: `tests/unit/agent/system-prompt.test.ts`
- Test: `tests/e2e/specs/agent-chat.spec.ts`

- [ ] **Step 1: Write failing context tests**

Add tests that require a current document hint in both a new and an existing conversation request:

```ts
expect(firstRequest).toMatchObject({
  projectId: PROJECT_ID,
  currentDocumentId: DOCUMENT_A,
});
expect(secondRequest).toMatchObject({
  conversationId,
  currentDocumentId: DOCUMENT_B,
});
expect(secondRequest).not.toHaveProperty('projectId');
```

Extend `selection-context-message.test.ts`:

```ts
const augmented = augmentUserMessageForLlm('总结这篇文档', {
  ...toolContext,
  currentDocumentId: DOCUMENT_ID,
  currentDocumentName: '主题班会总结',
});
expect(augmented).toContain('current document "主题班会总结"');
expect(augmented).toContain('default target, not a locked scope');
```

- [ ] **Step 2: Run the context tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/document-context.test.ts tests/unit/agent/selection-context-message.test.ts tests/unit/agent/system-prompt.test.ts
```

Expected: FAIL because the send context and tool context have no document fields.

- [ ] **Step 3: Add document fields and send them on every turn**

Add to `ToolContext`:

```ts
currentDocumentId?: string;
currentDocumentName?: string;
```

Add only the server-verifiable hint to `SendContext`:

```ts
currentDocumentId?: string;
```

Read `currentDocumentId` from `useNavigation()` in `ChatPanel` and add it to the memoized `ctx`. Change `useAgentChat.send` so both request branches include:

```ts
currentDocumentId: ctx.currentDocumentId,
```

Do not add document IDs to `ConversationScope`; table/folder scope freezing remains unchanged.

- [ ] **Step 4: Verify the server-side hint against the bound project**

Accept `currentDocumentId?: string` in the Agent route body. After building `contextFields`, resolve the current ID through `resolveDocumentForTool` using an explicit ID. Only copy verified data into the context:

```ts
const currentDocument = body.currentDocumentId
  ? await resolveDocumentForTool(
      supabase,
      contextFields.projectId,
      { documentId: body.currentDocumentId },
      {}
    )
  : undefined;

const toolContext: ToolContext = {
  ...contextFields,
  userId: user.id,
  conversationId: conversation.id,
  supabase,
  userRole,
  ...(currentDocument?.ok
    ? {
        currentDocumentId: currentDocument.document.id,
        currentDocumentName: currentDocument.document.name,
      }
    : {}),
};
```

An invalid or cross-project live hint is omitted; it never changes the bound project or returns another project's metadata.

- [ ] **Step 5: Update prompt/context wording, test, and commit**

Add a page-context sentence stating that the current document is the default only and explicit same-project targets override it. Add prompt rules requiring document discovery before guessing IDs and requiring ambiguity clarification.

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/document-context.test.ts tests/unit/agent/selection-context-message.test.ts tests/unit/agent/system-prompt.test.ts
npm run test:e2e -- tests/e2e/specs/agent-chat.spec.ts --grep "current document context"
npm run typecheck
```

Expected: unit tests PASS; the Playwright test PASS when the configured E2E environment is available.

Commit:

```bash
git add src/lib/agent/types.ts src/components/agent/types.ts src/components/agent/ChatPanel.tsx src/components/agent/useAgentChat.ts src/app/api/agent-chat/route.ts src/lib/agent/context-message.ts src/lib/agent/prompts.ts tests/unit/agent/document-context.test.ts tests/unit/agent/selection-context-message.test.ts tests/unit/agent/system-prompt.test.ts tests/e2e/specs/agent-chat.spec.ts
git commit -m "feat: pass live document context to agent"
```

## Task 3: Bounded Latest-State Document Reads

**Files:**
- Create: `src/lib/agent/document-read.ts`
- Modify: `src/lib/agent/tools/read-document.ts`
- Modify: `src/lib/agent/tool-result-for-llm.ts`
- Test: `tests/unit/agent/document-read.test.ts`
- Test: `tests/unit/agent/document-tools.test.ts`
- Test: `tests/unit/agent/tool-result-for-llm.test.ts`

- [ ] **Step 1: Write failing bounded-read tests**

Cover full, outline, heading, and line-range modes:

```ts
const markdown = '# Intro\nA\n\n## Goals\nB\nC\n\n## Notes\nD';
expect(readDocumentSlice(markdown, { mode: 'outline' })).toEqual({
  mode: 'outline',
  markdown: '# Intro\n## Goals\n## Notes',
  startLine: 1,
  endLine: 8,
  totalLines: 8,
  complete: false,
});
expect(readDocumentSlice(markdown, { mode: 'heading', heading: 'Goals' }))
  .toMatchObject({ markdown: '## Goals\nB\nC', complete: false });
expect(() => readDocumentSlice(markdown, { mode: 'lines', startLine: 0, endLine: 2 }))
  .toThrow('Line ranges are 1-based');
```

- [ ] **Step 2: Run the bounded-read tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/document-read.test.ts tests/unit/agent/document-tools.test.ts tests/unit/agent/tool-result-for-llm.test.ts
```

Expected: FAIL because `readDocumentSlice` and the new tool parameters do not exist.

- [ ] **Step 3: Implement `readDocumentSlice`**

Create a pure module with this interface:

```ts
export type DocumentReadRequest =
  | { mode?: 'full' }
  | { mode: 'outline' }
  | { mode: 'heading'; heading: string }
  | { mode: 'lines'; startLine: number; endLine: number };

export type DocumentReadSlice = {
  mode: 'full' | 'outline' | 'heading' | 'lines';
  markdown: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  complete: boolean;
};

export function readDocumentSlice(markdown: string, request: DocumentReadRequest): DocumentReadSlice;
```

For heading mode, parse ATX headings with `/^(#{1,6})\s+(.+?)\s*$/`, match the exact trimmed heading text, and include content until the next heading of equal or higher level. Reject zero or multiple exact heading matches.

- [ ] **Step 4: Extend `read_document` without bypassing the gateway**

Use a strict schema containing `documentId`, `documentName`, `folderName`, `mode`, `heading`, `startLine`, and `endLine`. Resolve through `resolveDocumentForTool`, read through `documentStateGateway.read`, call `readDocumentSlice`, and return:

```ts
{
  documentId: resolved.document.id,
  name: resolved.document.name,
  folderName: resolved.document.folderName,
  projectId: state.projectId,
  token: state.token,
  ...slice,
}
```

Change the LLM compactor to preserve `name`, `folderName`, `mode`, range metadata, and the explicit `complete` flag. A full result that exceeds the budget must return `complete: false` and tell the model to call heading or line mode; it must not authorize a full-document replacement from partial content.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/document-read.test.ts tests/unit/agent/document-tools.test.ts tests/unit/agent/tool-result-for-llm.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/lib/agent/document-read.ts src/lib/agent/tools/read-document.ts src/lib/agent/tool-result-for-llm.ts tests/unit/agent/document-read.test.ts tests/unit/agent/document-tools.test.ts tests/unit/agent/tool-result-for-llm.test.ts
git commit -m "feat: add bounded agent document reads"
```

## Task 4: Deterministic Precise Content Operations

**Files:**
- Create: `src/lib/agent/document-edit-operations.ts`
- Modify: `src/lib/agent/tools/propose-document-edit.ts`
- Modify: `src/components/agent/ConfirmationCard.tsx`
- Test: `tests/unit/agent/document-edit-operations.test.ts`
- Test: `tests/unit/agent/document-tools.test.ts`
- Test: `tests/unit/agent/document-confirmation-ui.test.tsx`

- [ ] **Step 1: Write failing operation tests**

Create pure tests for every operation and uniqueness guard:

```ts
expect(applyDocumentEditOperation('A\nB', { type: 'append', content: 'C' }))
  .toBe('A\nB\n\nC');
expect(applyDocumentEditOperation('A\nB\nC', {
  type: 'replace_text',
  target: 'B',
  replacement: 'B2',
})).toBe('A\nB2\nC');
expect(() => applyDocumentEditOperation('A\nA', {
  type: 'delete_text',
  target: 'A',
})).toThrow('Edit target must occur exactly once; found 2 matches.');
expect(applyDocumentEditOperation('A\nB', {
  type: 'insert_after',
  anchor: 'A',
  content: 'X',
})).toBe('A\nX\nB');
```

- [ ] **Step 2: Run operation tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/document-edit-operations.test.ts tests/unit/agent/document-tools.test.ts
```

Expected: FAIL because the operation module and schema do not exist.

- [ ] **Step 3: Implement deterministic operations**

Create `src/lib/agent/document-edit-operations.ts` with this discriminated union:

```ts
export type DocumentEditOperation =
  | { type: 'replace_all'; markdown: string }
  | { type: 'replace_text'; target: string; replacement: string }
  | { type: 'insert_before'; anchor: string; content: string }
  | { type: 'insert_after'; anchor: string; content: string }
  | { type: 'append'; content: string }
  | { type: 'delete_text'; target: string };

export function applyDocumentEditOperation(
  currentMarkdown: string,
  operation: DocumentEditOperation
): string;
```

Normalize only line endings to `\n`; do not trim or rewrite existing document text. `replace_text`, `insert_before`, `insert_after`, and `delete_text` count exact string occurrences and require exactly one. `append` inserts two newlines only when the current document is non-empty and lacks a blank-line boundary.

- [ ] **Step 4: Reuse the existing proposal safety path**

Replace the old required `markdown` parameter with a strict selector plus `operation`. In `execute`:

```ts
const resolved = await resolveDocumentForTool(
  ctx.supabase,
  ctx.projectId,
  parsed.data,
  ctx
);
if (!resolved.ok) return { success: false, error: resolved.error, data: resolved.candidates };
const state = await documentStateGateway.read(ctx.supabase, resolved.document.id);
const proposedMarkdown = applyDocumentEditOperation(state.markdown, parsed.data.operation);
validateSanctionedMdx(proposedMarkdown);
```

Keep the existing base hash, proposed hash, token, update IDs, `pre_agent` backup, transactional `replaceDocumentAsAgent`, and reset broadcast. Add `documentName`, `folderName`, and an operation summary to preview data. Continue hashing and applying the generated full Markdown, never the model's anchor as a mutation base.

- [ ] **Step 5: Update diff UI, test, and commit**

Make `ConfirmationCard` show the resolved document name and operation summary above the existing diff. Do not create a second diff component.

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/document-edit-operations.test.ts tests/unit/agent/document-tools.test.ts tests/unit/agent/document-confirmation-ui.test.tsx
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/lib/agent/document-edit-operations.ts src/lib/agent/tools/propose-document-edit.ts src/components/agent/ConfirmationCard.tsx tests/unit/agent/document-edit-operations.test.ts tests/unit/agent/document-tools.test.ts tests/unit/agent/document-confirmation-ui.test.tsx
git commit -m "feat: add precise agent document edits"
```

## Task 5: Create, Rename, And Move Metadata Operations

**Files:**
- Modify: `src/lib/agent/tools/create-document.ts`
- Create: `src/lib/agent/tools/rename-document.ts`
- Create: `src/lib/agent/tools/move-document.ts`
- Modify: `src/lib/agent/tools/index.ts`
- Test: `tests/unit/agent/document-metadata-tools.test.ts`

- [ ] **Step 1: Write failing metadata tool tests**

Cover duplicate creation preflight, current-document rename, explicit cross-document rename, and folder movement:

```ts
await expect(createDocumentTool.execute({ name: 'Guide', content: '# New' }, ctx))
  .resolves.toMatchObject({
    success: false,
    error: expect.stringContaining('A document named "Guide" already exists'),
  });
expect(createDocument).not.toHaveBeenCalled();

await expect(renameDocument.execute({ newName: 'Updated' }, {
  ...ctx,
  currentDocumentId: DOCUMENT_ID,
})).resolves.toMatchObject({ success: true, data: { name: 'Updated' } });

await expect(moveDocumentTool.execute({
  documentName: 'Guide',
  folderName: 'Archive',
}, ctx)).resolves.toMatchObject({ success: true, data: { folderName: 'Archive' } });
```

- [ ] **Step 2: Run metadata tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/document-metadata-tools.test.ts
```

Expected: FAIL because rename and move tools do not exist and create has no duplicate preflight.

- [ ] **Step 3: Add duplicate-name preflight to create**

Before `createDocument`, call `listResolvedProjectDocuments` and compare exact name plus target folder. Add `allowDuplicate?: boolean` to the closed schema. If a match exists and `allowDuplicate !== true`, return safe candidates and do not mutate. When the user explicitly confirms a duplicate, the model repeats the tool with `allowDuplicate: true`.

- [ ] **Step 4: Implement rename and move adapters**

Both tools use `resolveDocumentForTool`. `rename_document` calls:

```ts
await updateDocumentName(ctx.supabase, resolved.document.id, parsed.data.newName);
```

`move_document` resolves `folderName` with the existing `findFolderByName`; a missing `folderName` plus `moveToRoot: true` maps to `{ folderId: null }`. Reject a request that supplies neither a destination folder nor `moveToRoot: true`. Return document and folder metadata for UI invalidation.

Register both tools with `requiredPermission: 'editor'`, `confirmationMode: 'pre_execute'`, and the default mode-driven confirmation policy.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/document-metadata-tools.test.ts tests/unit/agent/document-tools.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/lib/agent/tools/create-document.ts src/lib/agent/tools/rename-document.ts src/lib/agent/tools/move-document.ts src/lib/agent/tools/index.ts tests/unit/agent/document-metadata-tools.test.ts tests/unit/agent/document-tools.test.ts
git commit -m "feat: add agent document metadata operations"
```

## Task 6: Mandatory Confirmation And Permanent Deletion

**Files:**
- Modify: `src/lib/agent/types.ts`
- Modify: `src/lib/agent/conversation-meta.ts`
- Modify: `src/lib/agent/core.ts`
- Create: `src/lib/agent/tools/delete-document.ts`
- Modify: `src/lib/agent/tools/index.ts`
- Modify: `src/components/agent/ConfirmationCard.tsx`
- Modify: `src/components/agent/ChatMessage.tsx`
- Test: `tests/unit/agent/conversation-meta.test.ts`
- Test: `tests/unit/agent/delete-document-tool.test.ts`
- Test: `tests/unit/agent/resume-confirmation-core.test.ts`
- Test: `tests/unit/agent/document-confirmation-ui.test.tsx`

- [ ] **Step 1: Write failing confirmation-policy tests**

Replace the old assumption that every post-preview tool confirms in Auto mode with explicit policy assertions:

```ts
it('lets mode-driven post-preview writes execute in Auto mode', () => {
  const tool = mockTool({ confirmationMode: 'post_preview', confirmationPolicy: 'mode' });
  expect(needsConfirmation(tool, { autoExecute: true })).toBe(false);
});

it('always confirms irreversible tools in Auto mode', () => {
  const tool = mockTool({ confirmationMode: 'post_preview', confirmationPolicy: 'always' });
  expect(needsConfirmation(tool, { autoExecute: true })).toBe(true);
});

it('keeps meta operations confirmed', () => {
  const tool = mockTool({ confirmationMode: 'meta' });
  expect(needsConfirmation(tool, { autoExecute: true })).toBe(true);
});
```

- [ ] **Step 2: Run confirmation tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/conversation-meta.test.ts tests/unit/agent/resume-confirmation-core.test.ts
```

Expected: FAIL because `confirmationPolicy` does not exist and Auto cannot distinguish post-preview policies.

- [ ] **Step 3: Add the additive policy and update gating**

Add to `AgentTool`:

```ts
confirmationPolicy?: 'mode' | 'always';
```

Implement confirmation ordering as:

```ts
export function needsConfirmation(tool: AgentTool, meta: ConversationMeta): boolean {
  const resolved = resolveConversationMeta(meta);
  if (tool.category === 'read') return false;
  if (tool.confirmationMode === 'meta') return true;
  if (tool.confirmationPolicy === 'always') return true;
  if (tool.confirmationRequired === false) return false;
  if (tool.confirmationPolicy === undefined && tool.confirmationMode === 'post_preview') {
    return true;
  }
  if (resolved.autoExecute === true) return false;
  if (tool.confirmationMode === 'pre_execute' && meta.skipConfirmation) return false;
  return true;
}
```

Set `propose_document_edit` to `confirmationPolicy: 'mode'`. Leave `update_row`,
`set_reference`, and `setup_library` without a policy so their legacy
always-confirmed post-preview behavior remains unchanged. Keep
`import_script.confirmationRequired: false`, so its existing validated
self-apply behavior also remains unchanged.

- [ ] **Step 4: Implement stable-ID permanent deletion**

Create `delete-document.ts` as `post_preview` plus `confirmationPolicy: 'always'`. The preview payload is strict:

```ts
const DeletePreview = z.object({
  type: z.literal('document_delete'),
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  folderName: z.string().nullable(),
  updatedAt: z.string(),
}).strict();
```

`execute` resolves only and returns this payload. `executeImport` parses the saved preview, resolves the exact ID again inside `ctx.projectId`, verifies the name still identifies the same row for display consistency, calls `deleteDocument(ctx.supabase, documentId)`, and returns the deleted stable metadata. It never resolves by name after approval.

- [ ] **Step 5: Render, test, and commit**

Route `preview.type === 'document_delete'` to the generic `ConfirmationCard`. Add `delete_document: 'Delete document permanently'` and show name/folder plus irreversible wording.

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/conversation-meta.test.ts tests/unit/agent/delete-document-tool.test.ts tests/unit/agent/resume-confirmation-core.test.ts tests/unit/agent/document-confirmation-ui.test.tsx
npm run typecheck
```

Expected: PASS, including an Auto-mode core test that emits `confirmation_request` for `delete_document`.

Commit:

```bash
git add src/lib/agent/types.ts src/lib/agent/conversation-meta.ts src/lib/agent/core.ts src/lib/agent/tools/delete-document.ts src/lib/agent/tools/index.ts src/components/agent/ConfirmationCard.tsx src/components/agent/ChatMessage.tsx tests/unit/agent/conversation-meta.test.ts tests/unit/agent/delete-document-tool.test.ts tests/unit/agent/resume-confirmation-core.test.ts tests/unit/agent/document-confirmation-ui.test.tsx
git commit -m "feat: require confirmation for document deletion"
```

## Task 7: Living Project Document Semantic Index

**Files:**
- Create: `supabase/migrations/20260716070000_agent_project_document_embeddings.sql`
- Modify: `src/lib/agent/chunking.ts`
- Modify: `src/lib/agent/embedding-config.ts`
- Modify: `src/lib/agent/embedding-index.ts`
- Modify: `src/lib/agent/embedding-retrieval.ts`
- Modify: `src/lib/agent/tools/semantic-search.ts`
- Create: `src/lib/server/documentEmbeddingIndexService.ts`
- Create: `src/app/api/agent-chat/reindex/document/route.ts`
- Modify: `src/app/api/agent-chat/reindex/route.ts`
- Modify: `src/components/documents/useDocumentCollaboration.ts`
- Modify: document write tools from Tasks 4-6
- Test: `tests/unit/agent/project-document-chunking.test.ts`
- Test: `tests/unit/agent/project-document-index.test.ts`
- Test: `tests/unit/agent/embedding-retrieval.test.ts`
- Test: `tests/unit/documents/document-reindex-route.test.ts`
- Test: `tests/unit/database/agent-project-document-embeddings-migration.test.ts`

- [ ] **Step 1: Write failing migration, chunking, and retrieval tests**

Assert the migration adds the source type, match scope, timestamp metadata, and deletion trigger:

```ts
expect(sql).toContain("'project_document'");
expect(sql).toContain("p_scope = 'project_document'");
expect(sql).toContain("source_type = 'project_document'");
expect(sql).toContain('trg_delete_embedding_chunks_project_document');
```

Add chunking expectations:

```ts
const chunks = chunkProjectDocument('# Intro\nAlpha\n\n## Goals\nBeta', {
  targetChars: 20,
  minChars: 1,
});
expect(chunks[0]).toMatchObject({ chunkIndex: 0, heading: 'Intro' });
expect(chunks.some((chunk) => chunk.heading === 'Goals')).toBe(true);
```

- [ ] **Step 2: Run index tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/project-document-chunking.test.ts tests/unit/agent/project-document-index.test.ts tests/unit/agent/embedding-retrieval.test.ts tests/unit/documents/document-reindex-route.test.ts tests/unit/database/agent-project-document-embeddings-migration.test.ts
```

Expected: FAIL because the source type, chunker, service, and route do not exist.

- [ ] **Step 3: Add the database source and retrieval scope**

The migration must:

1. replace the source-type check while retaining every existing value;
2. update `match_agent_embedding_chunks` so `p_scope = 'project_document'` selects only that source;
3. add `documentUpdatedAt` to the source timestamp `COALESCE`;
4. add an `AFTER DELETE ON public.documents` trigger that deletes rows where `source_type = 'project_document' AND source_id LIKE OLD.id::text || ':%'`;
5. preserve the existing access check and grants.

Extend `RetrievalScope`, quotas, half-life configuration, semantic-search schema, prompt retrieval defaults, and formatting. A formatted result must include document name, folder, heading/range, document ID, and updated date.

- [ ] **Step 4: Implement actor-checked service-role indexing**

Create a server-only service with this public API:

```ts
export async function reindexProjectDocumentAsActor(input: {
  actorUserId: string;
  projectId: string;
  documentId: string;
}): Promise<{ documentId: string; chunks: number }>;

export async function removeProjectDocumentIndex(input: {
  actorUserId: string;
  projectId: string;
  documentId: string;
}): Promise<void>;

export async function reindexProjectDocumentsAsActor(input: {
  actorUserId: string;
  projectId: string;
}): Promise<{ documents: number; chunks: number }>;
```

Use `getSupabaseServiceRoleClient`, call `user_has_project_access` or read project membership to recheck the actor, read metadata plus latest Markdown through `documentStateGateway`, generate embeddings with `embedTexts`, delete stale rows for that document prefix, and upsert with `user_id: null` and `conversation_id: null`. The source ID format is `${documentId}:chunk:${chunkIndex}`.

Export a pure `chunkProjectDocument` from `chunking.ts`; do not reuse the `[Design document]` prefix parser.

- [ ] **Step 5: Wire mutation and editor refresh triggers**

After successful create/edit/rename/move, call the server service asynchronously and catch/log failures without changing the successful tool result. After confirmed delete, call `removeProjectDocumentIndex`; the database trigger remains the durable cleanup fallback.

Add `POST /api/agent-chat/reindex/document` with a strict `{ projectId, documentId }` body, authenticated actor, project/document verification, and a call to `reindexProjectDocumentAsActor`.

In `useDocumentCollaboration`, debounce a route call after a successful `session.flush()` or `onCompacted` state notification. Send the browser's current auth token and do not call the route for viewers. The route reads the current logical state, so it does not rely on stale `documents.content`.

Extend the admin reindex route to call `reindexProjectDocumentsAsActor` for every readable document in the project.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/project-document-chunking.test.ts tests/unit/agent/project-document-index.test.ts tests/unit/agent/embedding-retrieval.test.ts tests/unit/documents/document-reindex-route.test.ts tests/unit/database/agent-project-document-embeddings-migration.test.ts
npm run typecheck
npm run typecheck:api
```

Expected: PASS.

Commit:

```bash
git add supabase/migrations/20260716070000_agent_project_document_embeddings.sql src/lib/agent/chunking.ts src/lib/agent/embedding-config.ts src/lib/agent/embedding-index.ts src/lib/agent/embedding-retrieval.ts src/lib/agent/tools/semantic-search.ts src/lib/server/documentEmbeddingIndexService.ts src/app/api/agent-chat/reindex/document/route.ts src/app/api/agent-chat/reindex/route.ts src/components/documents/useDocumentCollaboration.ts src/lib/agent/tools/create-document.ts src/lib/agent/tools/propose-document-edit.ts src/lib/agent/tools/rename-document.ts src/lib/agent/tools/move-document.ts src/lib/agent/tools/delete-document.ts tests/unit/agent/project-document-chunking.test.ts tests/unit/agent/project-document-index.test.ts tests/unit/agent/embedding-retrieval.test.ts tests/unit/documents/document-reindex-route.test.ts tests/unit/database/agent-project-document-embeddings-migration.test.ts
git commit -m "feat: index living project documents"
```

## Task 8: Document Cache Invalidation And End-To-End Workflows

**Files:**
- Modify: `src/lib/agent/types.ts`
- Modify: document tools from Tasks 1, 4, 5, and 6
- Modify: `src/components/agent/useAgentChat.ts`
- Modify: `src/components/agent/ChatPanel.tsx`
- Modify: `tests/e2e/pages/agent.page.ts`
- Modify: `tests/e2e/specs/agent-chat.spec.ts`
- Test: `tests/unit/agent/document-cache-invalidation.test.ts`

- [ ] **Step 1: Write failing invalidation and UI workflow tests**

Add a structured invalidation type instead of treating every cache path as a library ID:

```ts
type AgentInvalidation =
  | { type: 'library'; id: string }
  | { type: 'documents'; projectId: string; documentId?: string };
```

Test that a document edit invalidates `queryKeys.documentState(documentId)` and `queryKeys.documents(projectId)`, while library invalidations continue to use `invalidateLibraryAssetsData`.

Add Playwright request-body and mocked-SSE workflows for:

- current document A on the first turn and document B on a later turn in the same conversation;
- an explicit document B request while A is current;
- duplicate-name candidate response;
- Auto-mode document edit result;
- Auto-mode `delete_document` confirmation card.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/document-cache-invalidation.test.ts
npm run test:e2e -- tests/e2e/specs/agent-chat.spec.ts --grep "document"
```

Expected: FAIL because invalidation payloads are library-only and the document workflows are not wired.

- [ ] **Step 3: Implement structured invalidations**

Replace `invalidateCache?: string[]` with `invalidations?: AgentInvalidation[]` in `ToolResult` and `cache_invalidated` SSE data. Update existing library tools mechanically to return `{ type: 'library', id }`. Document writes return:

```ts
invalidations: [{
  type: 'documents',
  projectId: ctx.projectId,
  documentId: resolved.document.id,
}],
```

In `useAgentChat`, switch by invalidation type. For documents, invalidate:

```ts
await queryClient.invalidateQueries({ queryKey: queryKeys.documents(projectId) });
if (documentId) {
  await queryClient.invalidateQueries({ queryKey: queryKeys.document(documentId) });
  await queryClient.invalidateQueries({ queryKey: queryKeys.documentState(documentId) });
  await queryClient.invalidateQueries({ queryKey: queryKeys.documentVersions(documentId) });
}
```

Keep `router.refresh()` once after the batch. Preserve all existing library cache behavior.

- [ ] **Step 4: Complete prompt/tool descriptions and E2E assertions**

Document tool descriptions must state the selector order, current-document default, duplicate-name stop condition, and requirement to call `read_document` before content edits. Add stable `data-testid` values only where the E2E confirmation flow cannot use existing IDs.

Use mocked SSE for deterministic chat rendering tests, and use the existing Supabase document fixtures for one real navigation assertion that opening `/${projectId}/doc/${documentId}` sends that ID.

- [ ] **Step 5: Run focused regression tests and commit**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/document-cache-invalidation.test.ts tests/unit/agent/document-tools.test.ts tests/unit/agent/conversation-meta.test.ts
npm run test:e2e -- tests/e2e/specs/agent-chat.spec.ts
npm run typecheck
```

Expected: PASS when the configured Playwright environment is available.

Commit:

```bash
git add src/lib/agent/types.ts src/lib/agent/core.ts src/lib/agent/tools src/components/agent/useAgentChat.ts src/components/agent/ChatPanel.tsx tests/e2e/pages/agent.page.ts tests/e2e/specs/agent-chat.spec.ts tests/unit/agent/document-cache-invalidation.test.ts
git commit -m "feat: complete agent document workflows"
```

## Task 9: Full Verification And Documentation Alignment

**Files:**
- Modify only defects found during verification.
- Review: `docs/superpowers/specs/2026-07-16-agent-project-document-integration-design.md`
- Review: `docs/superpowers/plans/2026-07-16-agent-project-document-integration.md`

- [ ] **Step 1: Run document and Agent focused tests**

Run:

```bash
npm run test:unit -- --runInBand \
  tests/unit/agent/document-resolver.test.ts \
  tests/unit/agent/document-context.test.ts \
  tests/unit/agent/document-read.test.ts \
  tests/unit/agent/document-edit-operations.test.ts \
  tests/unit/agent/document-tools.test.ts \
  tests/unit/agent/document-metadata-tools.test.ts \
  tests/unit/agent/delete-document-tool.test.ts \
  tests/unit/agent/conversation-meta.test.ts \
  tests/unit/agent/project-document-chunking.test.ts \
  tests/unit/agent/project-document-index.test.ts \
  tests/unit/agent/embedding-retrieval.test.ts \
  tests/unit/documents/document-reindex-route.test.ts \
  tests/unit/database/agent-project-document-embeddings-migration.test.ts
```

Expected: all focused suites PASS.

- [ ] **Step 2: Run the full static and unit verification**

Run:

```bash
npm run lint
npm run typecheck
npm run typecheck:api
npm run test:unit -- --runInBand
```

Expected: all commands exit 0.

- [ ] **Step 3: Run build and focused Playwright suites**

Run:

```bash
npm run build
npm run test:e2e -- tests/e2e/specs/agent-chat.spec.ts tests/e2e/specs/documents.spec.ts tests/e2e/specs/document-collaboration.spec.ts
```

Expected: build succeeds; E2E suites PASS when Supabase E2E credentials and services are configured. If the environment is unavailable, record the exact missing prerequisite instead of claiming the tests passed.

- [ ] **Step 4: Check migration and repository hygiene**

Run:

```bash
git diff --check
git status --short
git log --oneline --decorate -10
```

Expected: no whitespace errors; only intentional changes remain; task commits appear in order.

- [ ] **Step 5: Review against every acceptance criterion and commit verification fixes**

Confirm explicitly that:

1. project structure lists documents without bodies;
2. existing conversations receive live current-document context;
3. explicit same-project targets override the current document;
4. duplicate names never write by inference;
5. latest Yjs state powers bounded reads and edits;
6. create/read/edit/rename/move/delete all reuse existing domain services;
7. Auto applies ordinary edits while deletion always confirms;
8. existing MDX validation, backup, concurrency, and reset behavior remains;
9. `project_document` search is distinct from uploaded `design_document` search;
10. library and folder Agent behavior still passes regression tests.

If verification required code fixes, stage each exact modified path reported by
`git status --short`, excluding unrelated pre-existing work, and then commit:

```bash
git commit -m "fix: resolve agent document integration regressions"
```

If no fixes were required, do not create an empty commit.
