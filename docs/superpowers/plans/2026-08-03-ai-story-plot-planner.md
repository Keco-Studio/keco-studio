# AI Story Plot Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate an accurate, durable plot-node tree from natural-language scripts with one lightweight AI grouping call while keeping choices on edges and preserving a deterministic fallback.

**Architecture:** The model receives the already validated canonical `StoryDocument` and returns only ordered, contiguous plot groups with titles. Server code validates exact row coverage and derives every ordinary/choice edge from canonical `next` and `options`, so the model cannot invent story flow. The validated plan is stored on the imported library and loaded directly by the Script workspace; older libraries continue to derive a graph from rows.

**Tech Stack:** TypeScript, Zod, existing `completeLlm` tool calls, Supabase/PostgreSQL JSONB, React, Jest.

---

### Task 1: One-shot AI plot grouping

**Files:**
- Create: `src/lib/story-plot/aiPlanner.ts`
- Create: `src/lib/story-plot/prompts.ts`
- Test: `src/lib/story-plot/aiPlanner.test.ts`
- Modify: `src/lib/story-plot/validator.ts`

- [ ] **Step 1: Write failing tests for contiguous coverage and canonical edges**

Create a canonical story containing `Story Background`, `Suspense Intro`, a two-option decision, the east/west route nodes, both endings, a memory node, and `To Be Continued`. Assert that model groups become plot nodes, choice text exists only on edges, and reordered/duplicated/missing story IDs are rejected.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx jest src/lib/story-plot/aiPlanner.test.ts --runInBand`

Expected: FAIL because the AI grouping planner does not exist.

- [ ] **Step 3: Implement the strict grouping contract**

Define a structured tool that returns:

```ts
type StoryPlotGrouping = {
  nodes: Array<{ title: string; storyNodeIds: string[] }>;
};
```

Require the flattened `storyNodeIds` to exactly equal `document.nodes.map(node => node.label)`. Generate each plot ID from its first story-node ID, then derive ordinary and choice edges exclusively from the canonical `StoryDocument`. Validate the resulting `StoryPlotPlan` with `validateStoryPlotPlan`.

- [ ] **Step 4: Verify GREEN**

Run: `npx jest src/lib/story-plot/aiPlanner.test.ts src/lib/story-plot/deterministicBuilder.test.ts --runInBand`

Expected: both suites pass.

### Task 2: Conversion integration and fallback

**Files:**
- Modify: `src/lib/story-plan/conversion.ts`
- Modify: `src/lib/story-plan/conversion.test.ts`

- [ ] **Step 1: Write failing tests for one call and fallback**

Assert a deterministic screenplay performs exactly one `Plot Planner` call, accepts a valid grouping, and returns the AI plan. Assert malformed JSON, invalid coverage, provider errors, and deadline errors return `buildDeterministicStoryPlotPlan(document)` without retrying. External `AbortSignal` cancellation must still abort the import.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx jest src/lib/story-plan/conversion.test.ts --runInBand`

Expected: FAIL because conversion still always returns the deterministic plot plan.

- [ ] **Step 3: Integrate one plot call**

Add `plot_planning` progress and `Plot Planner` telemetry. Resolve the plot after canonical document validation and before every successful return. Limit the planner to one call with thinking disabled and a compact token budget. Catch planner-only failures and return the deterministic plan immediately; do not invoke Auditor or Adjudicator.

- [ ] **Step 4: Verify GREEN**

Run: `npx jest src/lib/story-plan/conversion.test.ts tests/unit/import-script-minimal-plan.integration.test.ts --runInBand`

Expected: both suites pass and planner fallback makes import non-fatal.

### Task 3: Durable library plot plans

**Files:**
- Create: `supabase/migrations/20260803193000_add_script_plot_plan.sql`
- Modify: `src/lib/services/scriptImportService.ts`
- Modify: `src/lib/services/scriptImportService.test.ts`
- Modify: `src/app/api/import-script/route.ts`
- Modify: `src/lib/agent/tools/import-script.ts`
- Modify: `src/lib/services/libraryService.ts`

- [ ] **Step 1: Write failing persistence tests**

Assert `importStoryDocument` inserts `plot_plan` with the library row and removes the library on later table-write failure. Assert both modal and agent import entry points pass `resolved.plotPlan` into persistence.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx jest src/lib/services/scriptImportService.test.ts tests/unit/api-import-script-route.test.ts tests/unit/agent/import-script-story-ir.test.ts --runInBand`

Expected: FAIL because `plotPlan` is not accepted or stored.

- [ ] **Step 3: Add schema and persistence**

Add nullable `libraries.plot_plan jsonb`, constrained to JSON objects when present. Extend `ImportStoryParams` and `Library`, pass the plan from both import entry points, and store it in the initial library insert so cleanup behavior remains unchanged.

- [ ] **Step 4: Verify GREEN**

Run the Task 3 test command again.

Expected: all suites pass.

### Task 4: Script workspace consumption

**Files:**
- Create: `src/lib/script-system/buildPersistedPlotGraph.ts`
- Test: `tests/unit/script-system/build-persisted-plot-graph.test.ts`
- Modify: `src/app/(dashboard)/script-system/[projectId]/script/[libraryId]/page.tsx`
- Modify: `src/components/script-system/ScriptSplitView.tsx`
- Modify: `src/components/script-system/ScriptSplitView.test.tsx`

- [ ] **Step 1: Write failing UI mapping tests**

Assert a persisted plan maps ordered `storyNodeIds` to exact row indexes, renders only plot nodes, keeps east/west choices on edges, and clicking a route node shows only its rows. Assert absent or invalid metadata uses `buildScriptFlowGraph(flowRows)`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx jest tests/unit/script-system/build-persisted-plot-graph.test.ts src/components/script-system/ScriptSplitView.test.tsx --runInBand`

Expected: FAIL because the split view does not accept a persisted graph.

- [ ] **Step 3: Load validated metadata**

Parse `library.plot_plan`, convert it to `FlowGraph`, and pass it into `ScriptSplitView`. Prefer the persisted graph when its flattened row count equals the current library row count; otherwise use the row-derived graph. Node selection continues to filter by `rowIndexes` locally with no model call.

- [ ] **Step 4: Verify GREEN**

Run the Task 4 command again.

Expected: all suites pass.

### Task 5: Final verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run focused behavior suites**

Run: `npx jest src/lib/story-plot src/lib/story-plan/conversion.test.ts src/lib/services/scriptImportService.test.ts tests/unit/import-script-minimal-plan.integration.test.ts tests/unit/api-import-script-route.test.ts tests/unit/agent/import-script-story-ir.test.ts tests/unit/script-system/build-script-flow-graph.test.ts tests/unit/script-system/build-persisted-plot-graph.test.ts src/components/script-system/FlowChartPanel.test.tsx src/components/script-system/ScriptSplitView.test.tsx --runInBand`

Expected: all focused suites pass.

- [ ] **Step 2: Run static verification**

Run: `npm run typecheck`, `npm run typecheck:api`, targeted `eslint`, and `git diff --check`.

Expected: all commands exit zero.

- [ ] **Step 3: Confirm performance contract**

Verify telemetry shows at most one `Plot Planner` call for deterministic imports, zero plot calls on page load/node click, and no semantic audit when `skipSemanticAuditAfterValidation` is active.
