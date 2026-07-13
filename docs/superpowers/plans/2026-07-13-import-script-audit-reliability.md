# Import Script Audit Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mandatory MiniMax story audits reliable by auditing one canonical final-row view and independently adjudicating concrete failure allegations.

**Architecture:** Deterministic validation still produces `StoryDocument` and the existing compiled projection. A new canonical `StoryAuditView` flattens each final logical row exactly once and references paths by those row IDs. The Primary Auditor sees only source evidence plus this view; a separate targeted MiniMax tool confirms or dismisses each alleged issue before rejection.

**Tech Stack:** TypeScript 5.9, Zod, Jest 30, Next.js 16 Route Handlers, existing MiniMax OpenAI-compatible client.

## Global Constraints

- Keep MiniMax semantic review mandatory for every import; do not add another provider.
- Preserve deterministic source, graph, command, path, compiler, database, Excel, and player validation.
- Keep three candidate attempts, 150-second per-call deadlines, cancellation propagation, and write-after-approval ordering.
- Do not expose source text, prompts, tokens, or credentials in telemetry.
- Do not change Agent Chat LLM behavior.
- Run real success-rate acceptance locally only, per the user's latest instruction.

---

### Task 1: Canonical Story Audit View

**Files:**
- Create: `src/lib/story-plan/auditView.ts`
- Create: `src/lib/story-plan/auditView.test.ts`
- Modify: `src/lib/story-plan/projection.ts`

**Interfaces:**
- Consumes: `StoryDocument`, `StoryExtraction`, and `StoryAuditProjection.paths`.
- Produces: `buildStoryAuditView(document, extraction, projection): StoryAuditView`.

- [ ] **Step 1: Write failing view tests**

Assert that the nested-trust fixture produces one row per document node, semantic presentation names, exact node/choice source unit IDs and commands, four path summaries, and no compiled table or duplicate row content inside paths.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm run test:unit -- src/lib/story-plan/auditView.test.ts --runInBand`
Expected: FAIL because `auditView.ts` does not exist.

- [ ] **Step 3: Implement the canonical view**

Define strict TypeScript interfaces for `StoryAuditView`, rows, choices, and paths. Map presentation types to `dialogue_primary`, `dialogue_secondary`, `narration_box`, `prose`, or `system`; derive source unit IDs from `SourceRef.unitId`; map each path transition back to its owning choice text and commands; keep paths as row IDs and choice summaries only.

- [ ] **Step 4: Run audit-view and projection tests**

Run: `npm run test:unit -- src/lib/story-plan/auditView.test.ts src/lib/story-plan/projection.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/story-plan/auditView.ts src/lib/story-plan/auditView.test.ts src/lib/story-plan/projection.ts
git commit -m "refactor: add canonical story audit view"
```

### Task 2: Primary Audit And Targeted Adjudication Contracts

**Files:**
- Modify: `src/lib/story-plan/schema.ts`
- Modify: `src/lib/story-plan/schema.test.ts`
- Modify: `src/lib/story-extraction/prompts.ts`
- Modify: `src/lib/story-plan/prompts.test.ts`

**Interfaces:**
- Consumes: `StoryAuditView`, `StoryPlanAuditIssue`.
- Produces: `StoryAuditAdjudication`, `parseStoryAuditAdjudication`, `AUDITOR_STORY_ADJUDICATION_TOOL`, `buildAuditorExtractionMessages(source, view)`, and `buildAuditAdjudicationMessages(source, view, issues)`.

- [ ] **Step 1: Write failing schema and prompt tests**

Require adjudication output `{ decisions: [{ issueId, status }] }`, strict `confirmed|unsupported` statuses, unique supplied issue IDs, and no unknown fields. Require the Primary payload to have only `task`, `sourceUnits`, `commands`, and `auditView`; explicitly assert it has no `extraction`, `document`, `projection`, `table`, or `tablePaths`. Require the targeted payload to include only alleged issues and referenced evidence.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm run test:unit -- src/lib/story-plan/schema.test.ts src/lib/story-plan/prompts.test.ts --runInBand`
Expected: FAIL on missing adjudication exports and the old duplicate Auditor payload.

- [ ] **Step 3: Implement strict contracts and prompts**

Add the strict Zod adjudication schema. Rewrite the Primary prompt around the canonical view and concrete citations. Add a separate adjudicator prompt that can only classify supplied issue IDs and treats absent or contradictory evidence as unsupported. Build targeted evidence by selecting referenced source units, rows, and paths without copying unrelated candidate data.

- [ ] **Step 4: Run focused tests**

Run: `npm run test:unit -- src/lib/story-plan/schema.test.ts src/lib/story-plan/prompts.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/story-plan/schema.ts src/lib/story-plan/schema.test.ts src/lib/story-extraction/prompts.ts src/lib/story-plan/prompts.test.ts
git commit -m "feat: add targeted story audit adjudication"
```

### Task 3: Conversion Approval Flow

**Files:**
- Modify: `src/lib/story-plan/conversion.ts`
- Modify: `src/lib/story-plan/conversion.test.ts`
- Modify: `tests/unit/import-script-minimal-plan.integration.test.ts`
- Modify: `scripts/probe-import-story-plan.ts`

**Interfaces:**
- Consumes: `buildStoryAuditView`, Primary Audit, and Targeted Adjudication.
- Produces: `ResolvedAuditedStory.approval` with `primary_pass|adjudicated_pass`, optional `primaryAudit`, and optional `adjudication` evidence.

- [ ] **Step 1: Write failing flow tests**

Cover Primary pass, Primary fail plus all-unsupported adjudication, Primary fail plus any confirmed decision, malformed/missing/duplicate adjudication decisions, deterministic candidates stopping after a confirmed defect, converted candidates retrying only confirmed issues, provider abort budgets, timeout, and progress text for both audit stages.

- [ ] **Step 2: Run focused flow tests and verify failure**

Run: `npm run test:unit -- src/lib/story-plan/conversion.test.ts tests/unit/import-script-minimal-plan.integration.test.ts --runInBand`
Expected: FAIL because conversion still repeats unchanged full audits and has no adjudication stage.

- [ ] **Step 3: Implement the approval state machine**

Build the canonical view after deterministic validation. Request one Primary Audit. On fail, assign stable `issue-1...issue-N` IDs, request targeted adjudication, validate exact one-to-one decisions, and accept only when all are unsupported. Reject an immutable deterministic candidate immediately on any confirmation. Feed only confirmed issues into the next natural candidate. Return an effective passing audit plus preserved primary/adjudication evidence for diagnostics.

- [ ] **Step 4: Run flow, integration, route, and progress tests**

Run: `npm run test:unit -- src/lib/story-plan/conversion.test.ts tests/unit/import-script-minimal-plan.integration.test.ts tests/unit/api-import-script-route.test.ts tests/unit/import-script-progress.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/story-plan/conversion.ts src/lib/story-plan/conversion.test.ts tests/unit/import-script-minimal-plan.integration.test.ts scripts/probe-import-story-plan.ts
git commit -m "fix: adjudicate story audit failures"
```

### Task 4: Sanitized LLM Response Telemetry

**Files:**
- Modify: `src/lib/agent/llm-client.ts`
- Modify: `tests/unit/agent/llm-client.test.ts`
- Modify: `src/lib/story-plan/conversion.ts`
- Modify: `src/app/api/import-script/route.ts`
- Modify: `tests/unit/api-import-script-route.test.ts`

**Interfaces:**
- Produces: optional `onResponseMetadata({ status, requestId })` in the LLM client and `onLlmTelemetry(event)` in story conversion options.

- [ ] **Step 1: Write failing metadata tests**

Assert that response status and the first available `x-request-id`, `request-id`, or `x-minimax-request-id` header reach the optional callback, while message bodies and authorization headers never do. Assert Import Script telemetry contains stage, attempt, elapsed milliseconds, outcome, and request ID only.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm run test:unit -- tests/unit/agent/llm-client.test.ts tests/unit/api-import-script-route.test.ts --runInBand`
Expected: FAIL because callbacks do not exist.

- [ ] **Step 3: Add scoped optional callbacks**

Call response metadata hooks immediately after upstream headers arrive. Measure each Import Script LLM stage and emit sanitized telemetry from conversion. Log the structured event in the Route without source or prompt data. Leave all callbacks optional so Agent Chat behavior is unchanged.

- [ ] **Step 4: Run focused tests**

Run: `npm run test:unit -- tests/unit/agent/llm-client.test.ts tests/unit/api-import-script-route.test.ts src/lib/story-plan/conversion.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/llm-client.ts tests/unit/agent/llm-client.test.ts src/lib/story-plan/conversion.ts src/app/api/import-script/route.ts tests/unit/api-import-script-route.test.ts
git commit -m "chore: trace story audit response metadata"
```

### Task 5: Full Verification And Local Success Rate

**Files:**
- Modify only if a failing regression requires a scoped correction.

- [ ] **Step 1: Run all deterministic verification**

Run: `npm run test:unit -- --runInBand`
Expected: all suites pass.

Run: `npm run typecheck && npm run typecheck:api && npm run lint && npm run build`
Expected: both TypeScript checks and build pass; ESLint reports zero errors.

Run: `git diff --check`
Expected: no output.

- [ ] **Step 2: Run rainy-manor real MiniMax acceptance locally**

Run: `npm run probe:import-story -- tests/fixtures/import-script/rainy-manor-story.txt --runs=10`
Expected: 10/10 accepted, each with `primary_pass` or `adjudicated_pass`, 23 nodes, and isolated branch targets.

- [ ] **Step 3: Run nested-trust real MiniMax acceptance locally**

Run: `npm run probe:import-story -- tests/fixtures/import-script/nested-trust-story.txt --runs=10`
Expected: 10/10 accepted; deterministic integration tests continue to prove final trust values `2`, `0`, `4`, and `0`.

- [ ] **Step 4: Review final branch and commit any verification correction**

Run: `git status --short --branch && git log --oneline --decorate -8`
Expected: clean `fix-script-defeat` branch with `main` still at `7f98e4a`.

