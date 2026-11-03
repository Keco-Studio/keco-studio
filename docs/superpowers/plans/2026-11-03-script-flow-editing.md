# Script Flow Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit Script flow outlets in the diagram and persist faithful standard Script data.
**Architecture:** Full rows are authoritative; a pure flow model diagnoses control flow and applies small commands. A service verifies source identity and sends an atomic, versioned database transaction. UI consumes the same model.
**Tech Stack:** Existing Next.js, React, TypeScript, Supabase/PostgreSQL, Jest, Playwright.
**Spec:** `docs/superpowers/specs/2026-11-03-script-flow-editing-design.md`, approved 2026-11-03.

## Global Constraints
- Preserve all values, dynamic options, unknown non-control commands and resource references.
- End > options > Jump > physical next row; ambiguous control input is diagnosed, not silently repaired.
- Source-linked regeneration retains edits or stops before replacement; no fuzzy source matching.
- Existing template work remains untouched and unfinished. No animation implementation, production migration or deployment.
- Use existing isolated checkout and native sequential execution, already authorized by user.

## Review Focus
- Empty option targets and duplicate labels must not create apparent valid connections (Task 1).
- Changing one of multiple outlets within one scene must not modify another (Tasks 1, 4).
- Unknown command tokens must survive edits, including words containing Jump/End (Task 1).
- Lost response and collaborative changes must not duplicate terminal rows or overwrite content (Task 2).
- Re-export to a new library differs from updating the original; ordinary dialogue edits must not invalidate stable identity (Task 3).

## Task 1: Lossless flow model and edit commands
Files: create `src/lib/script-system/flow-editing/model.ts`, `edit.ts`, `model.test.ts`.
Interfaces: FlowRow `{id,values:Record<string,unknown>}`; analyzeFlow(rows) => outlets and diagnostics; applyFlowEdit(rows, command, allocateId) => complete copied rows. Commands specify row ID, optional option index, target row/end/sequence, option text/commands or delete.
- [ ] Write tests for >10 options, self loops, missing labels, duplicate labels, inactive control diagnostics, multiple outlets and nonmutation.
- [ ] Run focused Jest; expect missing module failure.
- [ ] Implement token-level parsing and editing; unique generated labels, explicit terminal row for option End, preserve all unrelated values.
- [ ] Re-run tests, expect pass; typecheck and commit.

## Task 2: Atomic structure persistence
Files: create `supabase/migrations/20261103100000_script_flow_editing.sql`, `src/lib/server/scriptFlowEditingService.ts`, `src/app/api/script-flow/[projectId]/[libraryId]/route.ts`, `tests/unit/database/script-flow-editing.behavior.test.ts`, `tests/unit/api/script-flow-editing.test.ts`.
Interfaces: GET authenticated read returns rows, fingerprint, canEdit, mapping diagnostics. POST accepts expected fingerprint, commands, UUID requestId; service returns authoritative data. Service-only RPC reads consistent full source data, validates actor and writes changed values/necessary fields/rows/metadata in one transaction with request hash replay.
- [ ] Write and run failing database/API tests: roles, invalid scope, stale fingerprint, replay, rollback and foreign row IDs.
- [ ] Implement strict bounded request validation, explicit role checks, advisory/row locks, CAS and idempotency.
- [ ] Apply migration only to isolated local stack, run live tests with required DB gate, expect no skips; commit.

## Task 3: Source identity and regeneration
Files: create `src/lib/script-system/flow-editing/lineage.ts`, `lineage.test.ts`; modify script import/finalization and existing dialogue sync as required by inspected code; add new migration rather than modifying historical ones.
Interfaces: resolveFlowLineage(rows, sourceBlocks) => unique bindings or diagnostics; reconcileFlowOverrides(existing, generated, bindings) => preserved full rows or conflict before replacement.
- [ ] Write failing tests for unique legacy mapping, ambiguous duplicate dialogue, block deletion, ordinary dialogue edits and existing-library regeneration versus new export.
- [ ] Integrate stable source block bindings and control overrides with Task 2 transaction; source token and update-tail checked at commit.
- [ ] Reconcile overrides before generation replaces original library; preserve arbitrary values, fail closed on ambiguous mapping. Keep new exports independent. Test true finalize path with database rollback.
- [ ] Run focused/live tests and commit.

## Task 4: Diagram editor and synchronized display
Files: create `src/components/script-system/ScriptFlowEditor.tsx`, `.module.css`, `.test.tsx`; modify `ScriptSplitView.tsx`, `FlowChartPanel.tsx`, `buildScriptFlowGraph.ts` only at integration points.
Interfaces: editor receives project/library and selected row IDs, flush callback and onSaved callback; GET on opening, local command draft, POST on Save, retain requestId after network failure. Build accurate graph from model while retaining scene groups as display metadata.
- [ ] Write failing component tests for writer/viewer, branch selection, field preview, save/cancel, failure retention, pending drafts and conflict.
- [ ] Implement accessible outlet/target/option controls, explicit End, dynamic slots and error locations; no text clipboard interception.
- [ ] Await dialogue draft flush; invalidate library assets/schema/plot metadata on success and clear stale per-block history. Reference/preview graphs remain read-only.
- [ ] Run component/player regressions and typecheck, expect pass; commit.

## Task 5: Full verification and independent review
Files: create `tests/e2e/specs/script-flow-editing.spec.ts`; record evidence in this plan.
- [ ] Verify real authenticated fixture: edit branch→save→refresh→play branch→regenerate; viewer denial, conflict and >10 options.
- [ ] Run focused Jest, live DB tests, typecheck, API typecheck, lint and applicable repository validate gates; inspect browser keyboard and narrow layout.
- [ ] Use verification-before-completion and requesting-code-review skills; one independent whole-change reviewer, fix material findings with regression tests.
- [ ] Commit task changes only; report exact evidence and any unresolved limitations, no push/deploy/Jira messages.

## Execution record
Baseline: 4 suites / 48 tests passed before changes. Plan self-review maps each design section to Tasks 1–5. User design approval and native execution authorization carry forward; no additional execution confirmation needed.

### Implementation and review record (2026-11-03)
Tasks 1–4 are implemented. The independent whole-change review found sparse physical row ordering, ambiguous repeated dialogue mapping and invisible self-loop routing; each was reproduced and fixed with a regression test. Narration mapping and generated terminal IDs also have regression coverage. No reviewer findings remain deferred.

Implementation rulings:
- Scene groups remain presentation metadata; current Script rows determine edges, replacing stale persisted edges.
- Stable source block/role identity and current document fingerprint are authoritative. Stored sourceText is descriptive; normal text edits do not require rewriting it in the dialogue transaction. Regeneration resolves current content and rejects structural ambiguity before replacement.
- Finalization reparents staging rows, preserves the stable library name, releases the staging job uniqueness key and retains custom values. Migrations target only the isolated local database.
- Phase 1 template/reuse changes remain separate and unfinished.

Verification coverage: 13 focused suites, 95 tests passed, including 8 live database tests without skips. These cover role checks, conflict/replay, rollback, regeneration and player behavior. TypeScript and API TypeScript checks passed. Final edited-component ESLint passed without warnings. Earlier full lint completed with 0 errors and existing repository warnings.

Limits: the full repository unit run reported 133 failed, 328 skipped and 5507 passed. Failures include Windows path/CRLF/Unix-tool assumptions and generated Next files during concurrent development; the API sanitization failure introduced by this feature was fixed and its focused regression passed. Not every full-suite failure has been individually classified. npm run validate was interrupted in the MCP check, so the repository-wide gate is not green. Browser coverage is recorded below; it does not substitute for a single browser journey covering regeneration and every branch type.
The authenticated browser save/reload, replay, stale request and viewer-denial scenario passed before the final layout adjustment. Final narrow-layout verification remains open due to local development-server startup failures.
