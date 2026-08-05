# Unified AI Story And Plot Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make one Branch Planner response produce both canonical branch structure and Plot-node titles, then use one persisted `plot_plan` to drive the left Script rows and right Flow Chart.

**Architecture:** Extend the source-unit Branch Planner contract with validated `plotGroups`. The server materializes Story IR from source ownership, maps the AI groups to stable Story node IDs, derives Plot edges only from canonical Story IR, and persists the result. Remove independent Plot Planner calls from import paths while preserving display-only fallback for legacy or malformed persisted plans.

**Tech Stack:** TypeScript, Zod, Jest, Next.js route handlers, Supabase JSON persistence.

---

### Task 1: Add Plot-group contract to Branch Planner

**Files:**
- Modify: `src/lib/story-plan/aiBranchPlanner.ts`
- Test: `src/lib/story-plan/aiBranchPlanner.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests that parse a response containing `plotGroups`, preserve each title and source-unit list, reject an unknown/duplicate group unit during materialization, and include `plotGroups` in the repair prompt's previous candidate.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts`

Expected before implementation: failures because the schema and prompt do not expose `plotGroups`.

- [ ] **Step 3: Implement the minimal schema and prompt changes**

Add a strict schema field:

```ts
plotGroups: z.array(z.object({
  title: z.string().trim().min(1),
  sourceUnitIds: z.array(UnitIdSchema).min(1),
}).strict()),
```

Include the field in the OpenAI tool, require every visible source unit exactly once, and state that titles summarize the group's visible story content. Keep choices and route ownership source-unit based.

- [ ] **Step 4: Run the focused tests and confirm pass**

Run: `npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts`

Expected: all tests in the file pass.

- [ ] **Step 5: Commit the contract change**

Run: `git add src/lib/story-plan/aiBranchPlanner.ts src/lib/story-plan/aiBranchPlanner.test.ts && git commit -m "feat: include plot groups in branch planning"`

---

### Task 2: Map AI plot groups to canonical Story nodes

**Files:**
- Modify: `src/lib/story-plan/aiBranchPlanner.ts`
- Modify: `src/lib/story-plot/schema.ts` only if the persisted version needs an explicit bump
- Test: `src/lib/story-plan/aiBranchPlanner.test.ts`

- [ ] **Step 1: Write failing materialization tests**

Cover a decision with two exclusive routes and a shared merge. Assert that every visible Story node maps to exactly one Plot node, AI titles are preserved, Plot IDs are stable from the first Story node in each group, and structural/choice-only units cannot be included.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts`

Expected before implementation: no Plot plan is produced from the Branch Planner candidate.

- [ ] **Step 3: Implement deterministic group mapping**

After `materializeAiBranchStructure` creates the canonical source and relationship plan, map each `plotGroup.sourceUnitIds` to the generated inventory node IDs. Reject unknown, omitted, duplicate, structural, and choice-only units. Assign a deterministic fallback title only when the AI title is blank after normalization.

- [ ] **Step 4: Run the focused tests and confirm pass**

Run: `npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts`

Expected: all group coverage and title tests pass.

- [ ] **Step 5: Commit the mapping change**

Run: `git add src/lib/story-plan/aiBranchPlanner.ts src/lib/story-plan/aiBranchPlanner.test.ts src/lib/story-plot/schema.ts && git commit -m "feat: materialize AI plot groups"`

---

### Task 3: Make conversion use one AI structure stage

**Files:**
- Modify: `src/lib/story-plan/conversion.ts`
- Modify: `src/lib/story-plan/prompts.ts`
- Test: `src/lib/story-plan/conversion.test.ts`

- [ ] **Step 1: Write failing conversion tests**

Assert that a successful arbitrary import calls `submit_branch_structure` once and never calls `submit_story_plot_grouping`; a repair call includes the previous structure and validation issues; and a failed second candidate returns an `ImportStoryPlanError` instead of entering Extractor/Graph fallback.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm run test:unit -- --runInBand src/lib/story-plan/conversion.test.ts`

Expected before implementation: the current tests show Plot Planner or legacy fallback calls.

- [ ] **Step 3: Implement the unified conversion result**

Return the Branch Planner's mapped Plot plan alongside the canonical StoryDocument. Keep explicit deterministic parsers at zero LLM structure calls. Remove size-based bypasses that send non-deterministic branch prose to the old full graph pipeline; retain chunking only for source inventory construction where required.

- [ ] **Step 4: Remove pre-validation graph mutation**

Stop calling `stabilizeExtractionGraph` and `repairSequentialEpilogue` as a way to make invalid candidates pass. Let `materializeStoryExtraction` report `unreachable_node`, `automatic_cycle`, and `branch_leak` issues so the targeted Branch Planner retry can repair them.

- [ ] **Step 5: Run focused conversion tests**

Run: `npm run test:unit -- --runInBand src/lib/story-plan/conversion.test.ts`

Expected: unified call sequence tests pass and invalid candidates fail closed.

- [ ] **Step 6: Commit conversion changes**

Run: `git add src/lib/story-plan/conversion.ts src/lib/story-plan/prompts.ts src/lib/story-plan/conversion.test.ts && git commit -m "feat: unify story and plot planning"`

---

### Task 4: Make all import entry points use the same projection

**Files:**
- Modify: `src/app/api/import-script/route.ts`
- Modify: `src/lib/agent/tools/import-script.ts`
- Modify: `src/lib/import-script-conversion-cache.ts`
- Test: `tests/unit/api-import-script-route.test.ts`
- Test: `tests/unit/script-system/import-documentation-wiring.test.ts`

- [ ] **Step 1: Write failing entry-point tests**

Assert API and Agent import paths disable independent Plot Planner calls and use the same cache version/projection behavior.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm run test:unit -- --runInBand tests/unit/api-import-script-route.test.ts tests/unit/script-system/import-documentation-wiring.test.ts`

Expected before implementation: Agent import still passes `enableAiPlotPlanning: true`.

- [ ] **Step 3: Implement the shared behavior and bump cache version**

Set import conversion `enableAiPlotPlanning: false` everywhere, remove obsolete Plot Planner telemetry from those paths, and bump the cache version after the response contract changes.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm run test:unit -- --runInBand tests/unit/api-import-script-route.test.ts tests/unit/script-system/import-documentation-wiring.test.ts`

Expected: all focused route and wiring tests pass.

Run: `git add src/app/api/import-script/route.ts src/lib/agent/tools/import-script.ts src/lib/import-script-conversion-cache.ts tests/unit/api-import-script-route.test.ts tests/unit/script-system/import-documentation-wiring.test.ts && git commit -m "fix: align all script import plot planning"`

---

### Task 5: Persist and render one canonical Plot plan

**Files:**
- Modify: `src/lib/story-plot/deterministicBuilder.ts` only for legacy fallback behavior
- Modify: `src/lib/script-system/buildPersistedPlotGraph.ts` only for the new Plot plan version
- Modify: `src/components/script-system/FlowChartPanel.tsx` only for routing presentation
- Test: `src/lib/story-plot/deterministicBuilder.test.ts`
- Test: `src/components/script-system/FlowChartPanel.test.tsx`

- [ ] **Step 1: Write failing canonical projection tests**

Assert canonical option text/order and merge edges, AI titles preserved in persisted plans, and left-side row indexes equal the selected Plot node's Story node membership.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm run test:unit -- --runInBand src/lib/story-plot/deterministicBuilder.test.ts src/components/script-system/FlowChartPanel.test.tsx`

- [ ] **Step 3: Implement projection and rendering constraints**

Ensure persisted Plot plans are preferred. Keep the row-based graph only as display fallback for missing/invalid old plans. Keep edge routing visual-only and do not alter node membership or edge semantics in the UI component.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm run test:unit -- --runInBand src/lib/story-plot/deterministicBuilder.test.ts src/components/script-system/FlowChartPanel.test.tsx`

Expected: all focused projection and rendering tests pass.

Run: `git add src/lib/story-plot/deterministicBuilder.ts src/lib/script-system/buildPersistedPlotGraph.ts src/components/script-system/FlowChartPanel.tsx src/lib/story-plot/deterministicBuilder.test.ts src/components/script-system/FlowChartPanel.test.tsx && git commit -m "fix: render canonical story plot plans"`

---

### Task 6: Verification and handoff

**Files:**
- Verify only; no production changes.

- [ ] **Step 1: Run all affected unit tests**

Run: `npm run test:unit -- --runInBand src/lib/story-extraction src/lib/story-plan src/lib/story-plot src/components/script-system tests/unit/api-import-script-route.test.ts tests/unit/script-system/import-documentation-wiring.test.ts`

Expected: zero failed suites and zero failed tests.

- [ ] **Step 2: Run type checks**

Run: `npm run typecheck && npm run typecheck:api`

Expected: both commands exit with code 0.

- [ ] **Step 3: Run lint and diff checks**

Run: `npx eslint src/app/api/import-script/route.ts src/lib/agent/tools/import-script.ts src/lib/import-script-conversion-cache.ts src/lib/story-plan/aiBranchPlanner.ts src/lib/story-plan/conversion.ts src/lib/story-plot/deterministicBuilder.ts src/lib/script-system/buildPersistedPlotGraph.ts src/components/script-system/FlowChartPanel.tsx && git diff --check`

Expected: ESLint prints no errors and `git diff --check` prints no output.

- [ ] **Step 4: Commit the verified implementation**

Run: `git status --short && git log -1 --oneline`

Expected: only the intended implementation files are changed and the final commit is visible.

