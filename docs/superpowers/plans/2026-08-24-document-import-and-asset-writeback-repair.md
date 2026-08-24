# Document Import And Asset Writeback Repair Implementation Plan

> **For agentic workers:** Execute this plan inline on `8-23debug`; the user explicitly requested no TDD red-green cycle.

**Goal:** Keep Pixel Art as the default Art Style, repair document table/document reference selection, and prove the complete Keco MCP local-image writeback flow.

**Architecture:** Keep the existing resource-reference UI and MCP upload contracts. Tighten table-source classification, add a read-only document-content fallback for legacy documents, and add focused regression/acceptance coverage that verifies durable state instead of mutation responses.

**Tech Stack:** Next.js/React, TypeScript, Supabase client/RLS, MDXEditor/Yjs, Jest, Playwright, Deno MCP tests, GitHub Actions.

## Global Constraints

- Work only on branch `8-23debug`; preserve unrelated user changes.
- Pixel Art remains the initial Art Style preset; custom art generation is out of scope.
- Reference games, custom direction, and avoid guidance remain optional; partial reference rows remain invalid.
- Do not delete or overwrite pre-existing Keco content in acceptance runs.
- Never send raw image bytes, Base64, local paths, signed URLs, or upload headers through MCP arguments or logs.
- Production image acceptance uses an isolated temporary user/project and cleans it in `finally`.

---

### Task 1: Record default Art Style and source-classification regressions

**Files:**
- Modify: `src/components/game-design-system/GameDesignSystemCreatePage.test.tsx`
- Modify: `tests/unit/documents/resource-reference-service.test.ts`
- Modify: `tests/unit/documents/resource-reference-picker.test.tsx`

**Interfaces:**
- Tests consume the existing `DEFAULT_GAME_ART_STYLE_KEY`, `listTableReferenceSources`, and `listTableReferenceRows` contracts.
- Tests produce the exact behavior contract used by Tasks 2 and 3.

- [ ] Add a create-form assertion that the initial review uses Pixel Art with empty optional customization, without requiring any reference-game row.
- [ ] Add service fixtures for a normal table, a `document_export_type: 'script'` conversation, and a legacy derived conversation with `source_document_id` but no export type; assert only the normal table is returned.
- [ ] Add a stale-library test that asks for rows from a filtered conversation source and expects a clear unavailable-source error before field/asset reads.
- [ ] Add picker coverage that renders only the real table source and still exposes every ordered row/cell value.
- [ ] Run the focused Jest files and record the initial result before implementation changes.

### Task 2: Repair document/table reference resolution

**Files:**
- Modify: `src/lib/documents/resourceReferenceService.ts`
- Modify: `src/lib/documents/documentReferenceBlocks.ts` or a focused helper beside it
- Modify: `src/components/documents/ResourceReferencePickerModal.tsx` only if the stale-source error needs explicit UI text

**Interfaces:**
- `listTableReferenceSources(client, projectId)` returns only referenceable `TableReferenceSource` records.
- `listTableReferenceRows(client, projectId, libraryId)` rejects non-referenceable derived conversation libraries before loading rows.
- `listDocumentReferenceBlocks(client, projectId, documentId)` returns normalized blocks first, then deterministic preview blocks from legacy non-empty Markdown/content when normalized blocks are empty.

- [ ] Extend the library query projection with `source_document_id` and apply one shared predicate for script/legacy-derived conversation exclusion.
- [ ] Reuse the predicate in row loading so stale picker state cannot load a hidden conversation library.
- [ ] Preserve ordered fields, row IDs, and all cell values; do not change reference serialization.
- [ ] Add a legacy-content fallback that trims whitespace-only content, emits stable block IDs derived from document ID and block index, preserves heading/paragraph text, and never creates a block for empty content.
- [ ] Keep project ownership checks and reference revalidation unchanged.
- [ ] Run the focused service, block, and picker tests; fix any type/lint errors.

### Task 3: Add real-chain evidence for MCP image writeback

**Files:**
- Modify: `plugins/keco-codex/.codex-plugin/plugin.json`
- Modify: `plugins/keco-claude/.codex-plugin/plugin.json` only if a matching manifest exists
- Modify: `plugins/keco-codex/skills/keco-import-local-assets/SKILL.md` and the mirrored Claude skill if their contracts differ
- Create: `scripts/accept-local-image-writeback.ts`
- Modify: `.github/workflows/mcp-account-connections-production.yml` or add a dedicated manual production acceptance workflow

**Interfaces:**
- The acceptance script uses the live MCP endpoint and existing `prepare_image_uploads`, `complete_image_uploads`, table-row write, and read tools.
- It emits sanitized evidence containing stable project/table/row/image identities and every error, never credentials or signed data.

- [ ] Inventory two small local PNG fixtures and reject unsupported/duplicate inputs before any mutation.
- [ ] Create an isolated temporary auth user and fixture project/table with one image field; read back project/table IDs and schema.
- [ ] Prepare metadata-only uploads, PUT exact bytes with returned method/headers, complete only returned `image.path` values, and write the complete verified image objects to stable rows.
- [ ] Paginate-read the table and assert both filenames, image URLs/paths, sizes, and content types match exactly; assert no row is missing or duplicated.
- [ ] Clean temporary rows/project/user in `finally`, and surface cleanup errors separately.
- [ ] Add a static/contract assertion that the local-image Skill describes the same prepare/PUT/complete/write/read-back sequence and the refreshed plugin version is committed.

### Task 4: Verify, publish, merge, and test production

**Files:**
- No additional product files; use the committed files above.

- [ ] Run focused Jest and MCP tests, TypeScript, ESLint, full unit suite, production build, and focused document-reference Playwright coverage.
- [ ] Commit spec, plan, implementation, and acceptance evidence changes in reviewable commits.
- [ ] Push `8-23debug`, open a PR, wait for every required check, and fix failures without bypassing gates.
- [ ] Merge only after all checks are green; re-read the merge commit and post-merge workflows.
- [ ] Run the production document-reference browser probe and isolated MCP image writeback acceptance against the exact deployed commit.
- [ ] Remove temporary production probes/workflows and report actual created/read-back objects, stable IDs, errors, and any environmental blockers.
