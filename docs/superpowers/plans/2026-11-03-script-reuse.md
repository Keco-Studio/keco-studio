# Script Saving, Reuse, and Partial Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver in-project cloud Script templates, plus full/partial copy, independent creation, and insert reuse within the same project.

**Architecture:** Save complete data using a verifiable versioned content snapshot, express content and connections with stable internal IDs, and keep FlowGraph derived from content. The server generates snapshots and verifies permissions; extend the existing document atomic replacement path to save the Script, source document, lineage, and plot plan in the same transaction.

**Tech Stack:** Next.js, React, TypeScript, Zod, Supabase/PostgreSQL, existing Yjs document codec, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-script-reuse-design.md` (confirmed by the user on 2026-11-03).

## Global Constraints

- In-project cloud templates, and in-project partial copy-paste.
- Ordinary selected text still performs text copy; structured Script selection is in units of complete dialogue blocks.
- Full bidirectional text and flowchart editing, shot templates, and scene animation belong to later phases.
- Snapshots must not degrade to the old three-option format; FlowGraph cannot replace complete content.
- Unknown/incompatible columns report errors in preview, and are not silently discarded.
- Resources retain same-project references; binary files are not copied.
- Keep the old local structure templates as read-only reference, clearly marked "structure reference only".
- All writes roll back on failure; retries do not insert duplicates; collaboration conflicts require refreshing the preview.
- This version does not provide template content overwrite, version history, cross-tab structured clipboard, or batch paste undo.
- Do not migrate or deploy to the production database; local verification only. Follow the product's existing English UI copy style.

## Review Focus

- Non-contiguous selections must not accidentally produce sequential connections due to row concatenation: Tasks 1/2 verify with a case containing an unselected scene in the middle.
- Same project does not mean all nested resources are readable: Tasks 3/4 verify deleted resources and tampered resource ownership.
- A request that was submitted but whose response was lost must not insert duplicates: Task 4 verifies with retries using the same requestId and with changed payloads.
- Old templates and new cloud templates coexisting must not mislead users: Task 6 verifies that structure reference has no apply entry point.
- Current input drafts, collaboration updates, and regeneration may overwrite copies: Tasks 4/6/7 verify save-failure abort, version conflicts, reopen, and regeneration.

## Files and Boundaries

New pure data modules go in `src/lib/script-system/reuse/`; do not keep expanding ScriptSplitView. New persistence coordination services go in `src/lib/server/scriptReuseService.ts`, with HTTP boundaries in `src/app/api/script-templates/` and `src/app/api/script-reuse/`. Selection and template UI are split into small components and hooks; existing dialogue components only gain the necessary selection attributes.

The database uses new migrations and does not modify historical migrations. Extensions to the document state gateway and conversion entry points remain backward compatible. The existing `replace_document_with_markdown_and_sync_origin_script` version, lock, and permission patterns are the implementation reference; do not simulate transactions directly with per-row inserts.

## Task 1: Snapshot, Field, and Selection Contracts

**Files**
- Create: `src/lib/script-system/reuse/schema.ts`
- Create: `src/lib/script-system/reuse/snapshot.ts`
- Test: `src/lib/script-system/reuse/snapshot.test.ts`
- Reference: `scriptDialogueBlocks.ts`, `buildScriptFlowGraph.ts`, `src/lib/story-ir/tableFormat.ts`

**Interfaces**
- `ScriptReuseSelection = {kind:'all'} | {kind:'rows';rowIds:string[]} | {kind:'nodes';nodeIds:string[]}`.
- `ScriptReuseSource`: projectId, libraryId, fingerprint, field definitions, complete ordered rows, dialogue blocks, and validated node groupings. Fields carry semanticKey, valueType, and schema configuration; row values are stored by semanticKey.
- `ScriptReuseSnapshot`: version=1, projectId, fields, rows (localId/values), blocks (localId/rowIds), nodes (localId/title/rowIds), edges (fromRowId/toRowId or externalTarget, kind=sequence/jump/option, optionIndex), entryRowIds, resourceRefs, variableNames, provenance. All references use localId, not rowIndex.
- `parseScriptReuseSnapshot(input:unknown): ScriptReuseSnapshot`.
- `captureScriptReuseSnapshot(source:ScriptReuseSource,selection:ScriptReuseSelection): ScriptReuseSnapshot`.
- Default limits determined by this plan: 1 MiB UTF-8 JSON, 5,000 rows, name 1–80 characters, description up to 2,000 characters; SQL, API, and client use the same limits. Over-limit reports an explicit error and must not truncate content.

- [ ] Write failing tests: all captures more than 3 options plus If/Commands/resource columns; graph selection and the corresponding row selection are semantically equivalent; actions/dialogue automatically expand to complete blocks; non-contiguous selection preserves external sequence exits; invalid IDs, duplicate Labels, missing references, over-limit, and future version are rejected.
- [ ] Run `npx jest --runInBand src/lib/script-system/reuse/snapshot.test.ts` and confirm failure due to missing implementation.
- [ ] Implement strict schema and snapshot. Read the server-authoritative row order, normalize complete blocks and deduplicate, without modifying the source object. Explicitly recognize all dynamic OptionN triples; do not apply the old ScriptLine.
- [ ] Rerun tests, require all to pass; commit this task's code and tests.

## Task 2: Remapping and Paste Preview

**Files**
- Create: `src/lib/script-system/reuse/placement.ts`
- Create: `src/lib/script-system/reuse/materialize.ts`
- Test: `src/lib/script-system/reuse/materialize.test.ts`

**Interfaces**
- `ScriptReusePlacement`: entryRowId; mode='new'|'insert'|'disconnected'; for insert, specify anchorRowId and the concrete outlet (sequence/jump/option+index); exits map by snapshot exit ID to `{kind:'target';rowId:string}` or `{kind:'end'}`.
- `ScriptReuseTarget`: projectId, libraryId, fingerprint, existing fields/rows/connections and occupied labels.
- `ScriptReusePreview`: rowCount, nodeCount, requiredExits, variableNames, issues (code/message/blocking), target fingerprint.
- `previewScriptReuse(snapshot:ScriptReuseSnapshot,target:ScriptReuseTarget|null,placement:Partial<ScriptReusePlacement>):ScriptReusePreview`.
- `materializeScriptReuse(snapshot:ScriptReuseSnapshot,target:ScriptReuseTarget|null,placement:ScriptReusePlacement,allocateId:()=>string):ScriptReuseMaterialization`.
- `ScriptReuseMaterialization`: new fields/rows/blocks, old-to-new ID and Label mappings, explicit control flow, updated plot plan, target anchor changes, sourceBlocks and createdRowIds. This is in-memory data and does not perform database writes.

- [ ] Write failing tests: two consecutive copies have independent identifiers; body text containing `O1` is not replaced; the 4th option is preserved; unknown commands are preserved but blocked when they cannot be safely rewritten; every external exit must be handled; option End preserves the button and connects to the new terminal target; non-contiguous fragments do not cross-wire; branch anchors only rewire the specified option; incompatible fields report errors.
- [ ] Run `npx jest --runInBand src/lib/script-system/reuse/materialize.test.ts` and confirm failure.
- [ ] Implement field matching, token-level control-flow rewriting, and stable ordering. If implicit paths are disconnected, explicitly write Jump/End in the compiled lines; independent fragments must not be executed sequentially by adjacent physical rows. Unselected inbound edges are only preview hints.
- [ ] Rerun Task 1/2 tests, commit after passing.

## Task 3: Cloud Templates and Permission APIs

**Files**
- Create: `supabase/migrations/20261103090000_script_reuse_templates.sql`
- Create: `src/lib/server/scriptReuseSourceService.ts`
- Create: `src/lib/server/scriptTemplateService.ts`
- Create: `src/app/api/script-templates/[projectId]/route.ts`
- Create: `src/app/api/script-templates/[projectId]/[templateId]/route.ts`
- Create: `src/app/api/script-reuse/capture/route.ts`
- Test: `tests/unit/api/script-templates-route.test.ts`
- Test: `tests/unit/database/script-reuse-templates.test.ts`

**Interfaces**
- `readScriptReuseSource({supabase,actorUserId,projectId,libraryId,expectedFingerprint?}):Promise<ScriptReuseSource>`: consistently reads fields, rows, and node mappings and issues a fingerprint; reference the existing origin fingerprint, extend coverage to fields and plot plan, and share the lock strategy with the application.
- GET `/api/script-templates/:projectId` returns paginated metadata; GET `/:templateId` returns the snapshot.
- POST collection receives `{name,description,libraryId,selection,expectedFingerprint,requestId}` and generates the snapshot from the server source.
- PATCH single item receives `{name,description,expectedUpdatedAt}`; DELETE receives expectedUpdatedAt.
- POST `/api/script-reuse/capture` receives `{projectId,libraryId,selection,expectedFingerprint}` and returns the complete temporary snapshot and source fingerprint.
- Template table fields per spec; source IDs are informational only, with no source-library cascade delete. list does not return large snapshots; updates only allow name/description.

- [ ] Write failing API/DB tests: owner, accepted admin/editor can write; viewer is read-only; unaccepted invitees and non-members cannot read; forged projectId/createdBy/source ID are rejected; templates remain readable after the original Script is deleted; PATCH modifying template content is rejected; over payload limit reports an error.
- [ ] Run the corresponding Jest tests and record failures; real DB tests must explicitly require local Supabase and cannot substitute skip markers for success.
- [ ] Implement tables, RLS, limits, indexes, and services. Errors are unified as 400/403/404/409/413; authorization must not trust the client actor. Service-role RPCs are only callable by the service and re-verify the real actor's project role.
- [ ] Run API tests and the local database gate, commit after passing.

## Task 4: Atomic Apply, Source Document, and Regeneration Fidelity

**Files**
- Create: `supabase/migrations/20261103091000_atomic_script_reuse.sql`
- Create: `src/lib/server/scriptReuseService.ts`
- Create: `src/lib/script-system/reuse/sourceProjection.ts`
- Modify: `src/lib/server/documentAgentEditService.ts`
- Modify: `src/lib/services/scriptConversionService.ts`
- Modify: `src/lib/services/scriptImportService.ts`
- Create: `src/app/api/script-reuse/preview/route.ts`
- Create: `src/app/api/script-reuse/apply/route.ts`
- Test: `tests/unit/script-reuse-service.test.ts`
- Test: `tests/unit/database/script-reuse-apply.test.ts`
- Test: `src/lib/script-system/reuse/sourceProjection.test.ts`

**Interfaces**
- `ScriptReuseOrigin = {kind:'template';templateId:string;expectedUpdatedAt:string} | {kind:'clipboard';snapshot:ScriptReuseSnapshot}`.
- `prepareScriptReuse({supabase,actorUserId,projectId,origin,targetLibraryId?,placement}):Promise<{preview:ScriptReusePreview;previewToken:string}>`.
- `applyScriptReuse({supabase,actorUserId,projectId,previewToken,requestId}):Promise<{libraryId:string;documentId:string;createdRowIds:string[]}>`.
- POST preview receives origin, projectId, target library or new name, placement. Returns a short-lived signed token bound to the server-verified source/target versions and actor.
- POST apply receives only projectId, previewToken, requestId; re-reads the source from the server and recomputes materialization, without trusting write data in the preview.
- New RPC `apply_script_reuse`: called by service role, explicit actor, inputs expected fingerprint/document token/update tail, new Yjs/Markdown, materialization, and requestId; after verification, completes document, fields, rows, plot plan, lineage, workspace ownership, and request result in a single transaction.

- [ ] Write failing tests: source template deleted/updated and permission changes, resource cross-project/deleted, request replay with same payload returns same result, same requestId with different payload rejected; injecting a failure at the last step rolls back all writes; target field or Yjs update tail changes return 409; after insert, re-read/regenerate preserves all columns, options, and boundaries.
- [ ] Run the above three test files and record failures.
- [ ] Reuse `documentContentCodec` and the existing `replace_document_with_markdown_and_sync_origin_script` permission, CAS, backup, and broadcast paths, adding a batch apply branch to avoid compensating transactions with multiple client requests. Sort uniformly when locking project/document/library, and re-verify fingerprint in the transaction.
- [ ] Implement `buildScriptReuseSourceProjection(materialization,currentDocument):{markdown,sourceBlocks,lineage}`: generate independent valid document blocks and reuse the existing block identity mechanism. Create an independent source document and workspace membership for the new Script, ensuring `/script-system/:projectId/script/:libraryId` can open.
- [ ] Save structured copy content and source text summary in the server-side metadata corresponding to the source block identity; the conversion entry point first deterministically reads these controlled blocks, directly rebuilding complete data for unmodified blocks, and updating metadata via existing dialogue sync for edited blocks. Ordinary documents continue on the original conversion path. Do not store custom columns/resources only as natural language and hand them to the LLM to guess and restore, and do not write the old source document ID into the copy. Metadata must be versioned and included in the atomic transaction and conflict checks.
- [ ] Coordinate updates to other same-source derived tables, using existing mapping determination; on mapping ambiguity return 409 and preserve original data, and do not change only the Script while leaving a stale source document. Persistent template apply does not verify the original library exists; temporary clipboard apply verifies the source is still accessible.
- [ ] Run service unit tests and the real database gate, requiring permission/rollback/replay tests to pass without skips; commit.

## Task 5: Dual-View Selection and Project Clipboard

**Files**
- Create: `src/components/script-system/useScriptReuseSelection.ts`
- Create: `src/components/script-system/ScriptReuseClipboardProvider.tsx`
- Create: `src/components/script-system/ScriptSelectionToolbar.tsx`
- Modify: `src/components/script-system/ScriptShell.tsx`
- Modify: `src/components/script-system/FlowChartPanel.tsx`
- Modify: `src/components/libraries/components/VisualNovelScriptView.tsx`
- Modify: `src/components/script-system/ScriptSplitView.tsx`
- Test: `src/components/script-system/ScriptReuseSelection.test.tsx`

**Interfaces**
- `useScriptReuseSelection({libraryId,rows,blocks,graph})` returns selection, toggleNode, toggleBlock, clear, selectedRowIds. Selection is independent of the currently browsed node; rows that disappear from selection are automatically cleaned up.
- The clipboard Provider is mounted in ScriptShell, isolates in-memory content by projectId, and provides copy(snapshot), read(projectId), clear; unmount/refresh clears, and switching projects cannot paste old project content.
- FlowChartPanel optionally adds selectedNodeIds/onToggleNode; VisualNovelScriptView optionally adds selectionMode/selectedBlockIds/onToggleBlock. Old call sites do not change behavior.

- [ ] Write failing component tests: Ctrl/Cmd click can add/remove selection; viewing a node does not clear selection; actions and dialogue are grouped; leaving and returning to another Script in the same project still allows paste; switching projects disallows paste; text input and ordinary browser copy are not intercepted; block checkboxes are keyboard operable.
- [ ] Run `npx jest --runInBand src/components/script-system/ScriptReuseSelection.test.tsx` and confirm failure.
- [ ] Implement explicit selection mode and "Copy selection / Save selection as template"; before copying, await the current edit draft commit, then call capture. Copy failure does not overwrite the existing clipboard; old structure reference mode disables content copy.
- [ ] Rerun existing selection, FlowChartPanel, and ScriptSplitView tests, commit after passing.

## Task 6: Template Management and Paste Preview UI

**Files**
- Create: `src/lib/script-system/reuse/client.ts`
- Create: `src/components/script-system/useScriptTemplates.ts`
- Create: `src/components/script-system/ScriptReusePreviewModal.tsx`
- Modify: `src/components/script-system/ScriptTemplateModal.tsx`
- Modify: `src/components/script-system/ScriptWorkspaceToolbar.tsx`
- Modify: `src/components/script-system/ScriptSplitView.tsx`
- Modify: `src/components/script-system/ScriptTemplateModal.module.css`
- Test: `src/components/script-system/ScriptReuseUI.test.tsx`

**Interfaces**
- client wraps Task 3/4 APIs, preserving error code/status. React Query key uses `['script-templates',projectId]`; switching projects does not show old project data.
- `ScriptReusePreviewModal` receives origin, projectId, targetLibraryId?, initialPlacement, onApplied(result), onClose; uses Task 4's server preview result.
- The template library provides full/fragment markers, name/description/creator/time/stats, preview, rename, delete, create new, insert actions; old localStorage templates are listed separately as Structure reference, allowing only reference and deletion of old personal entries.

- [ ] Write failing tests: draft commit failure does not save template; unhandled exits block apply; each option preserves text; shared variable hints; errors/conflicts preserve selection and clipboard; read-only roles do not see write actions; repeated clicks make only one request; invalid resources block; navigate after create and select the new fragment after insert.
- [ ] Run `npx jest --runInBand src/components/script-system/ScriptReuseUI.test.tsx` and confirm failure.
- [ ] Implement non-blocking loading, empty states, preview and retry; disable the submit button during execution. Delete goes through a confirmation dialog; cancel does not write. Network timeout retries keep the original requestId; after refreshing the preview, generate a new requestId.
- [ ] On success, invalidate caches for library/schema/assets/document state/workspace/template; the new Script enters the sidebar group of the independent source document. After insert, update the plot plan and clear old per-block undo state that cannot represent this batch operation.
- [ ] Run Task 5/6 component tests and existing ScriptWorkspaceChrome/ScriptSplitView tests, commit after passing.

## Task 7: Full-Flow Acceptance and Delivery

**Files**
- Create: `tests/e2e/specs/script-reuse.spec.ts`
- Create: `tests/fixtures/script-reuse/branching-script.json`
- Update: this implementation plan's execution status and acceptance evidence.

- [ ] Build fixed fixtures: 2 characters, paired actions and dialogue, 4 options, merge, numeric commands, resource references, non-contiguous selection, external exits. Use local test resources to avoid paid calls to real generation services.
- [ ] E2E verifies in order: save template → refresh → another member views → create copy → edit does not affect source → graph-select partial copy → insert into another Script → paste again → option playtest → reopen → regenerate. Also test viewer write prohibition and inaccessible projects.
- [ ] At execution start, read the using-git-worktrees, executing-plans (or the user-chosen subagent-driven-development), and test-driven-development skills; create the isolated branch `codex/keco-1173-script-reuse` and bring in the confirmed design and plan. Run environment checks and install lockfile dependencies, without modifying global proxies or resetting the existing database.
- [ ] Run targeted Jest, `npm run typecheck`, `npm run typecheck:api`, `npm run lint`; per repository gates run `npm run validate` (after database and bash dependencies are fully configured locally) and `npx playwright test tests/e2e/specs/script-reuse.spec.ts`. Record real results; environment blockers do not count as passing.
- [ ] Use a browser to check real edit/preview/navigation flows and narrow-screen layout; verify focus, keyboard selection, and modal interactions. Read the verification-before-completion and requesting-code-review skills, perform final code review, fix substantive issues, and rerun affected checks.
- [ ] Commit task-related code, deliver a change overview, test evidence, and migration notes; do not modify Jira status or post comments, and do not auto-push/deploy.

## Execution Order and Self-Review

Dependency order: 1 → 2 → 3 → 4 → 5 → 6 → 7. The isolated branch and environment checks are execution prerequisites; they are listed in Task 7 for unified acceptance-environment recording and should not wait until implementation is complete to be created.

Spec coverage: save/permissions→3; complete snapshot/dynamic fields→1; copy boundaries and remapping→2; atomic apply/independent source document/regeneration→4; graph and block multi-select→5; template management/drafts/preview→6; overall playtest and cross-member verification→7.

This plan determines the controlled source-block metadata required for fidelity, so Task 4 is the main source of risk and effort. Until the task is complete, frontend-only caching, simply copying the library, or LLM regeneration cannot substitute for its acceptance criteria.
