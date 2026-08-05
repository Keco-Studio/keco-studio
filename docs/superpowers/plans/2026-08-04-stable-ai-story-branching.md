# Stable AI Story Branching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragile full-graph AI fallback with one repairable Branch Planner and derive the displayed plot graph deterministically from canonical Story IR.

**Architecture:** Server segmentation owns content and ordinary sequencing. AI returns only branch deviations. The import route projects canonical Story IR directly into plot nodes and edges without a second AI interpretation.

**Tech Stack:** TypeScript, Zod, Jest, Next.js route handlers.

---

### Task 1: Incremental Branch Planner retries

**Files:**
- Modify: `src/lib/story-plan/aiBranchPlanner.ts`
- Test: `src/lib/story-plan/aiBranchPlanner.test.ts`

- [ ] Add a failing test that attempt two includes `previousStructureCandidate` and task `REPAIR_BRANCH_STRUCTURE`.
- [ ] Extend `buildAiBranchStructureMessages` with an optional previous candidate.
- [ ] In the repair prompt, require preserving valid decisions and changing only relationships cited by validation issues.
- [ ] Run `npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts`.

### Task 2: Remove full Graph Planner fallback from imports

**Files:**
- Modify: `src/lib/story-plan/conversion.ts`
- Test: `src/lib/story-plan/conversion.test.ts`

- [ ] Add failing tests proving arbitrary prose calls only Branch Planner and exhaustion does not call Extractor or Graph Planner.
- [ ] Store each parsed Branch Planner candidate for the next repair request.
- [ ] Return the validated Branch Planner or linear candidate immediately.
- [ ] Throw a concrete branch-planning error after two failures instead of entering Extractor/Graph Planner loops.
- [ ] Run `npm run test:unit -- --runInBand src/lib/story-plan/conversion.test.ts`.

### Task 3: Canonical deterministic plot boundaries

**Files:**
- Modify: `src/lib/story-plot/deterministicBuilder.ts`
- Test: `src/lib/story-plot/deterministicBuilder.test.ts`

- [ ] Add a failing test with an opening, decision, two sibling routes, and a shared merge.
- [ ] Add boundaries at decision owners and nodes with multiple incoming canonical edges.
- [ ] Preserve canonical option text and order on outgoing plot edges.
- [ ] Run `npm run test:unit -- --runInBand src/lib/story-plot/deterministicBuilder.test.ts`.

### Task 4: Disable AI plot reinterpretation on import

**Files:**
- Modify: `src/app/api/import-script/route.ts`
- Test: `tests/unit/script-system/import-documentation-wiring.test.ts` or a focused import-route static test
- Modify: `src/lib/import-script-conversion-cache.ts`

- [ ] Add a failing static test requiring `enableAiPlotPlanning: false` on the import route.
- [ ] Disable the Plot Planner for imported scripts.
- [ ] Bump the conversion cache version.
- [ ] Run the focused route/static test.

### Task 5: Verification

**Files:**
- Verify only; no production changes.

- [ ] Run `npm run test:unit -- --runInBand src/lib/story-extraction src/lib/story-plan src/lib/story-plot`.
- [ ] Run `npm run typecheck` and `npm run typecheck:api`.
- [ ] Run targeted ESLint on modified source and test files.
- [ ] Run `git diff --check`.

