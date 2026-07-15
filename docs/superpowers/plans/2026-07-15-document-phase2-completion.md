# In-App Documents Phase 2 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the unfinished Phase 2C-2F document work already present in the working tree without committing changes.

**Architecture:** Keep `DocumentStateGateway` and the shared browser/Node codec as the only logical content boundary. Split pure sanctioned-MDX schema from editor-only descriptors, convert imports and exports through validated document structures, and make Agent edits use preview plus confirmed token-guarded replacement with a mandatory backup.

**Tech Stack:** Next.js 16 App Router, React 19, MDXEditor/Lexical, Yjs, Supabase RLS/RPC, Mammoth, docx, PDFKit, Zod, Jest, Playwright.

## Global Constraints

- Preserve all Phase 1 and Phase 2A/2B behavior and tests.
- `Callout` and `Details` are the only sanctioned JSX components; arbitrary evaluation is forbidden.
- Current state reads must include the durable Yjs update tail.
- Existing-document Agent edits always require confirmation and a `pre_agent` backup.
- Large editor, codec, importer, and exporter dependencies stay outside the main dashboard chunk.
- Do not commit any changes for this continuation.

---

### Task 1: Sanctioned MDX Contract and Rendering

**Files:**
- Modify: `src/lib/documents/sanctionedMdx.ts`
- Modify: `src/lib/documents/sanctionedMdxDescriptors.tsx`
- Modify: `src/components/documents/MdxDocumentEditor.tsx`
- Modify: `src/lib/documents/headlessDocumentNodes.ts`
- Test: `src/lib/documents/sanctionedMdx.test.ts`
- Test: `tests/unit/documents/document-content-codec.test.ts`

**Interfaces:**
- Produces: `validateSanctionedMdx(markdown)`, `sanctionedMdxDescriptors`, and inert Callout/Details rendering.

- [ ] Add failing cases for expressions, imports/exports, raw HTML, unknown/missing/duplicate props, invalid URLs, invalid nesting, and valid Phase 1 underline.
- [ ] Run `npm run test:unit -- --runInBand src/lib/documents/sanctionedMdx.test.ts tests/unit/documents/document-content-codec.test.ts` and verify the new cases fail for the intended reason.
- [ ] Replace regex-only acceptance with a deterministic scanner/parser contract that validates tags, attributes, links, and expressions without importing editor runtime code.
- [ ] Render the two sanctioned components inertly in editor/read-only mode and keep one shared descriptor registry.
- [ ] Rerun the focused tests, lazy-load guard, and `npm run typecheck` until green.

### Task 2: Unified Document Import and Design Upload

**Files:**
- Create: `src/lib/documents/documentImportService.ts`
- Modify: `src/lib/document-parser.ts`
- Modify: `src/app/(dashboard)/[projectId]/design-upload/page.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Test: `tests/unit/documents/document-import-service.test.ts`
- Test: `tests/unit/design-upload-document-wiring.test.ts`

**Interfaces:**
- Produces: `parseDocumentImport(file) -> { name, markdown, images }` and `createImportedDocument(client, input)`.

- [ ] Write failing tests for `.md`, `.txt`, `.docx` structure, validation, project/folder inputs, and no publication before content is valid.
- [ ] Run the focused Jest tests and verify RED.
- [ ] Implement format adapters that preserve Markdown, paragraphize text, convert DOCX HTML to supported Markdown, and carry extracted images through the existing upload service.
- [ ] Make design-upload create one durable document and pass its ID through the handoff without creating a broken row on conversion failure.
- [ ] Add the role-gated sidebar import command using existing document modal/action patterns.
- [ ] Rerun focused import, parser, sidebar, and design-upload tests.

### Task 3: Word and PDF Export

**Files:**
- Modify: `src/lib/documents/documentExportService.ts`
- Modify: `src/app/api/documents/[documentId]/export/route.ts`
- Modify: `src/components/documents/DocumentEditor.tsx`
- Test: `tests/unit/documents/document-export-service.test.ts`
- Test: `tests/unit/documents/document-export-route.test.ts`

**Interfaces:**
- Produces: `exportDocument(client, documentId, format)` returning a sanitized filename, media type, and bytes from the latest logical state.

- [ ] Write failing tests for uncompacted-tail reads, headings, inline emphasis, lists, quotes, links, tables, code, sanctioned components, filenames, unsupported formats, and access errors.
- [ ] Run the focused tests and verify RED.
- [ ] Build a format-neutral export model from validated Markdown/MDX and map it to docx and PDF renderers.
- [ ] Keep renderer packages server-only/lazy, bound trusted remote image fetches, and return explicit response headers.
- [ ] Add compact DOCX/PDF download commands to the document header.
- [ ] Rerun focused tests, API typecheck, and bundle guards.

### Task 4: Agent Document Tools and Confirmed Edit

**Files:**
- Modify: `src/lib/agent/tools/create-document.ts`
- Modify: `src/lib/agent/tools/read-document.ts`
- Modify: `src/lib/agent/tools/propose-document-edit.ts`
- Modify: `src/lib/agent/tools/index.ts`
- Modify: `src/lib/documents/documentStateGateway.ts`
- Modify: `src/lib/documents/documentStateTypes.ts`
- Modify: `src/components/agent/ConfirmationCard.tsx`
- Test: `tests/unit/agent/document-tools.test.ts`
- Test: `tests/unit/documents/document-state-gateway.test.ts`

**Interfaces:**
- Produces: additive `create_document`, latest-state `read_document`, and `propose_document_edit` with `executeImport` as the confirmed mutation path.

- [ ] Write failing tests for project isolation, viewer rejection, latest-tail reads, content hash/token preview, forced confirmation, stale preview rejection, `pre_agent` backup, and reset metadata.
- [ ] Run focused Agent and gateway tests and verify RED.
- [ ] Add a guarded Markdown replacement RPC/gateway contract that validates content, compares token/hash, creates `pre_agent`, advances epoch/revision, and clears the old tail atomically.
- [ ] Implement `propose_document_edit` as `post_preview`; confirmation re-reads token/hash and applies only the exact approved proposal.
- [ ] Add concise document-specific confirmation labels/preview while preserving generic confirmation behavior.
- [ ] Rerun focused Agent, confirmation, gateway, migration, and lazy-load tests.

### Task 5: Release Verification

**Files:**
- Modify only defects found by verification.

- [ ] Review the diff against Phase 2C-2F sections in `docs/superpowers/specs/2026-07-14-document-phase2-design.md`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck` and `npm run typecheck:api`.
- [ ] Run `npm run test:unit -- --runInBand`.
- [ ] Run `npm run build`.
- [ ] Run focused document Playwright tests when the configured environment is available.
- [ ] Run `git diff --check` and inspect `git status --short`; do not commit.
