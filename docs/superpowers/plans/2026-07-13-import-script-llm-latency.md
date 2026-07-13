# Import Script LLM Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce successful natural-language Import Script conversion from six or seven sequential MiniMax calls to three without weakening semantic or deterministic validation.

**Architecture:** Keep the Extractor and Graph Planner boundaries, then run one independent Combined Auditor over source evidence, hydrated StoryDocument, compiled table, and enumerated paths. Remove duplicate majority voting and the dedicated Graph Auditor while preserving full candidate retries, request deadlines, cancellation, and write-after-validation behavior.

**Tech Stack:** TypeScript, Jest, MiniMax-M3 structured tool calls, existing Story Extraction and Story Plan modules.

## Global Constraints

- MiniMax remains the only Import Script LLM provider.
- Every candidate requires one independent LLM semantic audit.
- Deterministic validation must pass before auditing and before database writes.
- A first-attempt natural-language success uses exactly three LLM requests.
- Explicit structured input uses deterministic parsing plus exactly one LLM audit.
- Candidate retries remain capped at three and receive structured prior issues.
- Existing timeout, cancellation, table schema, and playback behavior remain unchanged.

---

### Task 1: Lock The Three-Call Contract

**Files:**
- Modify: `src/lib/story-plan/conversion.test.ts`
- Modify: `src/lib/story-plan/prompts.test.ts`

**Interfaces:**
- Consumes: `resolveStoryPlanForImport`, `AUDITOR_STORY_EXTRACTION_PROMPT`.
- Produces: regression coverage for one audit call and complete combined-audit instructions.

- [ ] **Step 1: Replace consensus expectations with a first-attempt three-call test**

Queue one content inventory, one graph plan, and one passing audit. Assert tool names equal `submit_story_content_inventory`, `submit_story_graph`, and `submit_story_plan_audit` in that order.

- [ ] **Step 2: Add a retry test**

Queue a failing audit followed by a complete passing candidate. Assert six total calls, attempt count two, and `wrong_branch` in the second Extractor input.

- [ ] **Step 3: Strengthen the prompt test**

Assert the full Auditor prompt contains the graph rules `exclusive outcome scope`, `repeats an earlier decision unexpectedly`, and `Do not invent narrative prerequisites`.

- [ ] **Step 4: Run RED**

Run: `npm run test:unit -- --runInBand src/lib/story-plan/conversion.test.ts src/lib/story-plan/prompts.test.ts`

Expected: FAIL because conversion still calls both consensus auditors and the full Auditor prompt does not own every graph rule.

### Task 2: Collapse Auditing To One Request

**Files:**
- Modify: `src/lib/story-plan/conversion.ts`
- Modify: `src/lib/story-extraction/prompts.ts`

**Interfaces:**
- Consumes: `buildAuditorExtractionMessages`, `requestAuditor`, `StoryPlanAudit`.
- Produces: `Extractor -> Graph Planner -> Combined Auditor` conversion flow.

- [ ] **Step 1: Make the full Auditor prompt own graph validation**

Move the exclusive branch scope, unexpected repeated decision, explicit fallthrough, shared-content merge, and no-invented-prerequisite requirements into `AUDITOR_STORY_EXTRACTION_PROMPT`.

- [ ] **Step 2: Remove the duplicate audit surface**

Delete `GRAPH_AUDITOR_STORY_EXTRACTION_PROMPT`, `GRAPH_AUDITOR_STORY_EXTRACTION_TOOL`, `buildGraphAuditorExtractionMessages`, `requestGraphAuditor`, `requestAuditConsensus`, and audit issue deduplication used only by consensus voting.

- [ ] **Step 3: Call the Combined Auditor once per candidate**

After deterministic validation and projection, emit `Waiting for Combined Auditor LLM response`, call `requestAuditor` once, return on pass, and feed its issues into the next candidate attempt on failure.

- [ ] **Step 4: Run GREEN**

Run: `npm run test:unit -- --runInBand src/lib/story-plan/conversion.test.ts src/lib/story-plan/prompts.test.ts`

Expected: both suites pass with no consensus-audit calls.

### Task 3: Regression And Real-Provider Verification

**Files:**
- Verify only: story extraction, story plan, Import Script integration, TypeScript, and lint files.

**Interfaces:**
- Consumes: the complete Import Script conversion pipeline.
- Produces: test and measured latency evidence.

- [ ] **Step 1: Run focused Import Script tests**

Run: `npm run test:unit -- --runInBand src/lib/story-plan src/lib/story-extraction tests/integration/import-script-story-ir.test.ts`

Expected: all focused suites pass.

- [ ] **Step 2: Run static verification**

Run the repository's Web TypeScript, API TypeScript, ESLint, and `git diff --check` commands. Expect zero errors.

- [ ] **Step 3: Profile the real rainy-manor import**

Run the existing temporary stage profiler against `tests/fixtures/import-script/rainy-manor-story.txt` with `.env.local`. Expect one Extractor, one Graph Planner, one Combined Auditor, a passing audit, and a valid projected story.

- [ ] **Step 4: Review and commit**

Inspect `git diff`, ensure generated files and unrelated user changes are excluded, then commit the scoped implementation and tests on `scriptenhance7-10` without pushing.
