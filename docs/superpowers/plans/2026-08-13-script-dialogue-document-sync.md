# Script Dialogue Document Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a document-derived Script table and its source document synchronized for dialogue edits, insertion, deletion, speaker changes, drag reorder, undo, and redo.

**Architecture:** Preserve source block lineage during import and persist one mapping per action/speech asset. A server-only mutation service edits anchored MDX and encodes replacement Yjs state; one PostgreSQL RPC locks the document/library, rechecks optimistic tokens, and atomically commits the document, table rows, mappings, and version backup. Legacy libraries use a conservative ordered matcher before their first synchronized mutation.

**Tech Stack:** Next.js App Router, TypeScript, React Query, Supabase/PostgreSQL PL/pgSQL, MDX AST (`mdast-util-*`), Lexical/Yjs, Jest, Playwright.

---

## File Structure

- Create `src/lib/script-system/scriptDocumentBlocks.ts`: pure anchored-MDX block parsing, replacement, insertion, deletion, and movement.
- Create `src/lib/script-system/scriptDialogueLineage.ts`: convert source Markdown to model-safe text plus block spans; resolve Story IR refs to block IDs.
- Create `src/lib/script-system/scriptDialogueLegacyMapping.ts`: deterministic old-row-to-block matcher.
- Create `src/lib/server/scriptDialogueSyncService.ts`: authorization-aware orchestration and Yjs preparation.
- Create `src/app/api/script-dialogue-sync/route.ts`: authenticated HTTP boundary and error mapping.
- Create `src/lib/script-system/scriptDialogueSyncClient.ts`: typed client commands and response mapping.
- Create `supabase/migrations/20260813xxxxxx_script_dialogue_document_sync.sql`: mapping table, RLS, import mapping helper, and atomic mutation RPC.
- Modify `src/lib/services/scriptImportService.ts`: persist lineage mappings for document-derived scripts.
- Modify `src/app/api/import-script/route.ts`: build lineage-aware source input.
- Modify `src/components/script-system/useScriptDialogueEditor.ts`: route derived-script operations, history, and reorder through sync.
- Modify `src/components/script-system/ScriptSplitView.tsx` and the Script library page: pass source metadata and document token.
- Add focused unit/database tests and extend `tests/e2e/specs/conversation-player.spec.ts`.

### Task 1: Anchored Document Block Transformations

**Files:**
- Create: `src/lib/script-system/scriptDocumentBlocks.ts`
- Test: `src/lib/script-system/scriptDocumentBlocks.test.ts`

- [ ] **Step 1: Write failing tests for block parsing and all mutations**

Cover replacing one paragraph without changing headings, inserting between two mapped blocks, deleting action+speech, and moving only mapped blocks across intervening narration:

```ts
expect(moveDialogueBlocks(markdown, {
  movingBlockIds: [B],
  target: { blockId: A, edge: 'before' },
})).toContainInOrder([anchor(B), 'B：二', anchor(A), 'A：一', '旁白']);
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

Run: `npx jest src/lib/script-system/scriptDocumentBlocks.test.ts --runInBand`

Expected: FAIL because `scriptDocumentBlocks` does not exist.

- [ ] **Step 3: Implement AST-based block operations**

Use `parseValidatedSanctionedMdx` and `serializeSanctionedMdxAst`; never use regex to mutate Markdown. Export:

```ts
export type ScriptSourceBlock = { blockId: string; text: string; nodeIndex: number };
export function listScriptSourceBlocks(markdown: string): ScriptSourceBlock[];
export function replaceScriptSourceBlock(markdown: string, blockId: string, text: string): string;
export function insertScriptSourceBlock(markdown: string, input: {
  blockId: string; text: string; anchorBlockId: string; edge: 'before' | 'after';
}): string;
export function deleteScriptSourceBlocks(markdown: string, blockIds: readonly string[]): string;
export function moveScriptSourceBlocks(markdown: string, input: {
  movingBlockIds: readonly string[];
  target: { blockId: string; edge: 'before' | 'after' };
}): string;
```

Each inserted paragraph starts with `<BlockAnchor id="..." />`. Moving removes only named nodes, preserves their action-before-speech order, then inserts them at the target boundary.

- [ ] **Step 4: Run focused tests**

Run: `npx jest src/lib/script-system/scriptDocumentBlocks.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit the pure document transformer**

```bash
git add src/lib/script-system/scriptDocumentBlocks.ts src/lib/script-system/scriptDocumentBlocks.test.ts
git commit -m "feat: add dialogue document block transforms"
```

### Task 2: Source Lineage And Legacy Matching

**Files:**
- Create: `src/lib/script-system/scriptDialogueLineage.ts`
- Create: `src/lib/script-system/scriptDialogueLineage.test.ts`
- Create: `src/lib/script-system/scriptDialogueLegacyMapping.ts`
- Create: `src/lib/script-system/scriptDialogueLegacyMapping.test.ts`
- Modify: `src/lib/documents/scriptImportPlainText.ts`

- [ ] **Step 1: Write failing lineage tests**

Assert that model input contains clean visible text, every output span references a stable block ID, ASCII/full-width colons normalize equally, and a Story node maps only when its source refs resolve uniquely to one block.

- [ ] **Step 2: Write failing legacy matching tests**

Use action and speech rows with ordered document blocks. Test unique matches, repeated lines constrained by mapped neighbors, partial results, and ambiguous rows remaining unmapped.

- [ ] **Step 3: Run both suites and confirm failure**

Run: `npx jest src/lib/script-system/scriptDialogueLineage.test.ts src/lib/script-system/scriptDialogueLegacyMapping.test.ts --runInBand`

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement lineage and matching pure functions**

```ts
export type DialogueSourceSpan = {
  blockId: string; sourceStart: number; sourceEnd: number; visibleText: string;
};
export function buildDialogueImportSource(markdown: string): {
  text: string; spans: DialogueSourceSpan[];
};
export function resolveNodeBlockId(
  refs: readonly SourceRef[], spans: readonly DialogueSourceSpan[]
): string | null;

export function matchLegacyDialogueRows(input: {
  blocks: readonly ScriptSourceBlock[];
  rows: readonly LegacyDialogueCandidate[];
  existing: readonly DialogueBlockMapping[];
}): { matched: DialogueBlockMapping[]; unmatchedRowIds: string[] };
```

Normalization trims whitespace, treats `:` and `：` as equivalent separators, and compares speech as `speaker + separator + dialogue`. Never select among multiple candidates without order/neighbor uniqueness.

- [ ] **Step 5: Run both suites**

Expected: PASS.

- [ ] **Step 6: Commit lineage and legacy matching**

```bash
git add src/lib/script-system/scriptDialogueLineage* src/lib/script-system/scriptDialogueLegacyMapping* src/lib/documents/scriptImportPlainText.ts
git commit -m "feat: preserve dialogue source lineage"
```

### Task 3: Mapping Schema And Atomic Database Contract

**Files:**
- Create: `supabase/migrations/20260813xxxxxx_script_dialogue_document_sync.sql`
- Create: `tests/unit/database/script-dialogue-document-sync-migration.test.ts`

- [ ] **Step 1: Write the failing migration contract test**

Assert the SQL contains the mapping table, unique asset/block constraints, cascade foreign keys, RLS, authenticated grants, advisory locks, `PT409` token/tail checks, document version insert, asset/value mutations, mapping mutations, and one transaction function.

- [ ] **Step 2: Run the contract test**

Run: `npx jest tests/unit/database/script-dialogue-document-sync-migration.test.ts --runInBand`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Add the mapping table**

```sql
create table public.script_dialogue_document_blocks (
  library_id uuid not null references public.libraries(id) on delete cascade,
  asset_id uuid primary key references public.library_assets(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  block_id uuid not null,
  role text not null check (role in ('action', 'speech')),
  synced_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (library_id, block_id)
);
```

Add policies that follow project owner/admin/editor read/write rules through the library's project. Viewers get select only where existing Script reads permit it.

- [ ] **Step 4: Add one service-role transaction RPC**

Define `sync_script_dialogue_document(...) returns jsonb`. Inputs include actor, library/document IDs, expected epoch/revision/update IDs, current and replacement Markdown/Yjs, expected row order, a JSONB table mutation, and JSONB mapping mutations. It must:

1. lock the document and library advisory key;
2. derive and validate project/source relationships and actor permission;
3. compare epoch, revision, tail IDs, and expected row order;
4. validate current/replacement snapshot payloads;
5. insert a `pre_agent`-style document version named `Before Script dialogue sync`;
6. apply asset/value/order changes and mapping upserts/deletes;
7. replace document state, increment epoch/revision, clear the old update tail;
8. touch library/folder/project timestamps and return updated rows/token.

Revoke from `public`, `anon`, and `authenticated`; grant only `service_role` because the route supplies the verified actor ID.

- [ ] **Step 5: Run migration tests and repository migration checks**

Run: `npx jest tests/unit/database/script-dialogue-document-sync-migration.test.ts tests/unit/database/script-dialogue-mutation-rpc-static.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit the database contract**

```bash
git add supabase/migrations/20260813xxxxxx_script_dialogue_document_sync.sql tests/unit/database/script-dialogue-document-sync-migration.test.ts
git commit -m "feat(db): add atomic dialogue document sync"
```

### Task 4: Server Synchronization Service And Route

**Files:**
- Create: `src/lib/server/scriptDialogueSyncService.ts`
- Create: `src/lib/server/scriptDialogueSyncService.test.ts`
- Create: `src/app/api/script-dialogue-sync/route.ts`
- Create: `tests/unit/script-system/script-dialogue-sync-route.test.ts`

- [ ] **Step 1: Write failing service tests**

Cover edit action, edit speech/speaker, insert empty row without a paragraph, first non-empty insert, delete, reorder around narration, legacy backfill, ambiguous mapping rejection, and conversion of the next Markdown to Yjs before RPC.

- [ ] **Step 2: Write failing route tests**

Assert unauthenticated `401`, validation `400`, permission `403`, mapping ambiguity `409`, document conflict `409`, and success `200` with rows/mappings/document token.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npx jest src/lib/server/scriptDialogueSyncService.test.ts tests/unit/script-system/script-dialogue-sync-route.test.ts --runInBand`

- [ ] **Step 4: Implement the server command union**

```ts
export type ScriptDialogueSyncCommand =
  | { type: 'edit'; rowId: string; role: 'action' | 'speech'; speaker: string; content: string }
  | { type: 'insert'; afterBlockId: string | null; speaker: string; speechType: '1' | '2' }
  | { type: 'delete'; actionRowId?: string; speechRowId?: string }
  | { type: 'reorder'; movingRowIds: string[]; targetBlockId: string; edge: 'before' | 'after'; expectedOrderIds: string[] }
  | { type: 'restore'; snapshot: ScriptDialogueSyncSnapshot };
```

Read authoritative state with the service-role client, normalize block IDs if required, run legacy matching for missing mappings, verify each mapped block's `synced_text`, apply the Task 1 pure transform, encode with `documentContentCodec.markdownToYjsState`, then call the Task 3 RPC exactly once.

- [ ] **Step 5: Implement the authenticated route**

Use `withAuth`, strict Zod request schemas, and stable error codes: `DOCUMENT_CONFLICT`, `MAPPING_AMBIGUOUS`, `MAPPING_MISSING`, `FORBIDDEN`, and `INVALID_COMMAND`.

- [ ] **Step 6: Run service and route tests**

Expected: PASS.

- [ ] **Step 7: Commit the server boundary**

```bash
git add src/lib/server/scriptDialogueSyncService* src/app/api/script-dialogue-sync/route.ts tests/unit/script-system/script-dialogue-sync-route.test.ts
git commit -m "feat: add dialogue document sync service"
```

### Task 5: Persist Mappings During New Conversation Import

**Files:**
- Modify: `src/app/api/import-script/route.ts`
- Modify: `src/lib/services/scriptImportService.ts`
- Modify: `src/lib/story-ir/tableCompiler.ts`
- Modify: `src/lib/services/scriptImportService.test.ts`
- Create: `tests/unit/script-system/script-import-lineage.test.ts`

- [ ] **Step 1: Write failing import lineage tests**

Assert that source-document import uses `buildDialogueImportSource`, compiled rows retain their Story node index/block ID, created action/speech assets receive mappings, and ambiguous nodes remain safely unmapped.

- [ ] **Step 2: Run focused import tests**

Run: `npx jest tests/unit/script-system/script-import-lineage.test.ts src/lib/services/scriptImportService.test.ts --runInBand`

Expected: FAIL on missing lineage/mapping fields.

- [ ] **Step 3: Extend compiled output and import input**

```ts
export interface CompiledStoryTable {
  columns: string[];
  rows: string[][];
  sourceBlockIds: Array<string | null>;
}
```

Pass resolved lineage only for document-derived imports. Insert mappings for returned asset IDs and matching row indexes. Use a transaction helper in the migration so library/table/mapping creation rolls back together; file uploads without `sourceDocumentId` keep the existing path.

- [ ] **Step 4: Run import tests**

Expected: PASS.

- [ ] **Step 5: Commit generated-conversation mapping**

```bash
git add src/app/api/import-script/route.ts src/lib/services/scriptImportService* src/lib/story-ir/tableCompiler.ts tests/unit/script-system/script-import-lineage.test.ts
git commit -m "feat: map generated dialogue rows to document blocks"
```

### Task 6: Client API And Editor Integration

**Files:**
- Create: `src/lib/script-system/scriptDialogueSyncClient.ts`
- Create: `src/lib/script-system/scriptDialogueSyncClient.test.ts`
- Modify: `src/components/script-system/useScriptDialogueEditor.ts`
- Modify: `src/components/script-system/ScriptSplitView.tsx`
- Modify: `src/app/(dashboard)/script-system/[projectId]/script/[libraryId]/page.tsx`
- Modify: `src/components/script-system/ScriptEditableDialogBlock.tsx`
- Modify: `src/components/script-system/ScriptEditableDialogBlock.test.tsx`

- [ ] **Step 1: Write failing client and hook tests**

Assert derived scripts call `/api/script-dialogue-sync` for edit/insert/delete/reorder/undo/redo, ordinary libraries keep generic mutations, successful responses update the asset cache, and conflicts retain drafts without hiding deleted cards.

- [ ] **Step 2: Run focused tests**

Run: `npx jest src/lib/script-system/scriptDialogueSyncClient.test.ts src/components/script-system/ScriptEditableDialogBlock.test.tsx src/lib/script-system/scriptDialogueMutations.rollback.test.ts --runInBand`

- [ ] **Step 3: Implement the typed client**

```ts
export async function syncScriptDialogue(
  command: ScriptDialogueSyncCommand,
  context: { libraryId: string; documentId: string; token: DocumentStateToken }
): Promise<ScriptDialogueSyncResult>;
```

Map stable error codes to the agreed conflict/mapping messages. Return authoritative rows, mappings, document token, and an inverse snapshot for history.

- [ ] **Step 4: Wire derived-library context into the editor**

Pass `sourceDocumentId`, `documentExportType`, and the fetched document token from the page through `ScriptSplitView`. In `useScriptDialogueEditor`, select synchronized commands only when the source ID exists and export type is `script`. Replace derived-script undo/redo generic calls with `restore` commands.

- [ ] **Step 5: Preserve drafts and reconcile caches**

On success, set `queryKeys.libraryAssets(libraryId)` from the response and invalidate both assets and document state without awaiting. On conflict, do not change cache or `hidden`; keep local drafts and show the error toast.

- [ ] **Step 6: Run focused tests**

Expected: PASS.

- [ ] **Step 7: Commit client integration**

```bash
git add src/lib/script-system/scriptDialogueSyncClient* src/components/script-system src/app/'(dashboard)'/script-system/'[projectId]'/script/'[libraryId]'/page.tsx
git commit -m "feat: synchronize script dialogue editor with documents"
```

### Task 7: Full Regression And End-To-End Coverage

**Files:**
- Modify: `tests/e2e/specs/conversation-player.spec.ts`
- Modify: `tests/e2e/pages/agent.page.ts` only if reusable helpers are required

- [ ] **Step 1: Add the happy-path browser scenario**

Generate from a document containing two dialogue sentences, edit action/speaker/speech, insert between them, drag it across one narration paragraph, delete it, open the source document, and assert exact paragraph order/content after every committed operation.

- [ ] **Step 2: Add the two-browser conflict scenario**

Browser A opens Script; browser B edits the mapped source paragraph; browser A saves. Assert the conflict toast appears and neither the table row nor browser B's document text is overwritten.

- [ ] **Step 3: Run focused unit and static tests**

```bash
npx jest src/lib/script-system src/lib/server/scriptDialogueSyncService.test.ts tests/unit/script-system tests/unit/database/script-dialogue-document-sync-migration.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 4: Run type and lint checks**

```bash
npm run typecheck
npx eslint src/lib/script-system src/lib/server/scriptDialogueSyncService.ts src/app/api/script-dialogue-sync src/components/script-system
```

Expected: both exit 0.

- [ ] **Step 5: Run the browser test when local Supabase auth fixtures are available**

Run: `npx playwright test tests/e2e/specs/conversation-player.spec.ts --workers=1`

Expected: PASS. If the authenticated environment is unavailable, record that limitation and do not claim E2E verification.

- [ ] **Step 6: Commit E2E coverage**

```bash
git add tests/e2e/specs/conversation-player.spec.ts tests/e2e/pages/agent.page.ts
git commit -m "test: cover dialogue document synchronization"
```

### Task 8: Final Verification And Documentation

**Files:**
- Modify: `docs/architecture/COLLABORATION_OVERVIEW.md`
- Modify: `docs/architecture/collaboration-table-unified-design.md`

- [ ] **Step 1: Document the ownership and transaction boundary**

State that the source document remains authoritative for prose, the derived Script table is an editable synchronized projection, per-row block mappings provide identity, and all Script-origin mutations use the atomic sync RPC.

- [ ] **Step 2: Run the complete relevant verification set**

```bash
npm run typecheck
npm run typecheck:api
npx jest src/lib/script-system tests/unit/script-system tests/unit/documents tests/unit/database/script-dialogue-document-sync-migration.test.ts --runInBand
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Review the final diff for unrelated workspace changes**

Run: `git status --short` and `git diff --stat`. Stage only files listed in this plan; preserve all pre-existing user changes.

- [ ] **Step 4: Commit documentation and final adjustments**

```bash
git add docs/architecture/COLLABORATION_OVERVIEW.md docs/architecture/collaboration-table-unified-design.md
git commit -m "docs: describe dialogue document synchronization"
```

## Completion Checklist

- [ ] New imports persist unambiguous action/speech block mappings.
- [ ] Existing libraries backfill only unique ordered matches.
- [ ] Edit, insert, delete, reorder, undo, and redo update both resources.
- [ ] Reorder moves only mapped action/speech blocks; narration and headings remain independent.
- [ ] Conflicts reject the whole transaction and retain the UI draft.
- [ ] Viewers cannot mutate; admins/editors can.
- [ ] Ordinary non-derived libraries keep current behavior.
- [ ] Focused tests, type checks, lint, migration checks, and available E2E tests pass.
