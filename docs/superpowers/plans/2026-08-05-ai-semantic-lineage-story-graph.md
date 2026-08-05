# AI Semantic Lineage Story Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use AI semantic history claims to compile branch-safe Story graphs and preserve an exact Script-row-to-plot-node mapping.

**Architecture:** The Branch Planner returns decisions, complete leaf histories, and per-unit history claims instead of low-level route edges. A deterministic compiler builds replay copies and delayed merges, then PlotPlan v2 records canonical Story node order so the right-side graph resolves exact left-side rows.

**Tech Stack:** TypeScript, Zod, Jest, existing Story IR, Branch Planner tool calling, deterministic plot builder.

---

### Task 1: Canonical Script Row Mapping

**Files:** `src/lib/story-plot/schema.ts`, `validator.ts`, `deterministicBuilder.ts`, `src/lib/script-system/buildPersistedPlotGraph.ts`, and their tests.

- [ ] Add a failing persisted-graph test where plot-node order is `[right, left]`, `storyNodeOrder` is `[leftStory, rightStory]`, and each node must resolve the correct row index.
- [ ] Add PlotPlan v2 with `storyNodeOrder: document.nodes.map(node => node.label)` while retaining v1 parsing.
- [ ] Validate that `storyNodeOrder` contains every Story node exactly once and every plot node owns one disjoint subset.
- [ ] Map persisted graph IDs through `storyNodeOrder`, never flattened plot-node order; invalid v2 mappings fail closed.
- [ ] Run the schema, validator, deterministic builder, and persisted graph suites.

### Task 2: Semantic Lineage Contract

**Files:** Create `src/lib/story-plan/semanticLineage.ts` and `src/lib/story-plan/semanticLineage.test.ts`.

- [ ] Add failing tests for unique decisions/options/histories and multiple options sharing one source unit.
- [ ] Define the strict contract:

```ts
type SemanticBranchStructure = {
  version: 3;
  structuralUnitIds: string[];
  decisions: Array<{
    id: string;
    ownerUnitId: string;
    options: Array<{ id: string; sourceUnitId: string; text: string }>;
  }>;
  histories: Array<{ id: string; optionIds: string[] }>;
  unitClaims: Array<{ sourceUnitId: string; historyIds: string[] }>;
};
```

- [ ] Validate source IDs, semantic ID uniqueness, sibling compatibility, ancestor closure, structural separation, and visible-unit coverage.
- [ ] Add compact source alias mapping and focused contract verification.

### Task 3: Deterministic Lineage Compiler

**Files:** Modify `src/lib/story-plan/semanticLineage.ts` and its test.

- [ ] Add a failing four-history test with shared ceremony, four exclusive inner monologues, and one final shared caption.
- [ ] Build per-history visible-unit sequences by filtering through `unitClaims` and the selected decision options.
- [ ] Share identical prefixes, clone common post-divergence runs when later units differ, isolate exclusive runs, and merge the longest identical terminal suffix.
- [ ] Emit `{ source, plan: StoryRelationshipPlan }` with replay units marked `authoritative: false`.
- [ ] Enumerate compiled paths and prove each history contains only its claimed authoritative source units.

### Task 4: AI Semantic Planner And Patch

**Files:** Modify `src/lib/story-plan/aiBranchPlanner.ts`, its tests, and `semanticLineage.ts`.

- [ ] Add `submit_semantic_lineage` requiring version 3, decisions, histories, unit claims, and structural units.
- [ ] Prompt for semantic membership only, with no low-level jumps or merges.
- [ ] Add `submit_semantic_lineage_patch` operations: `set_unit_histories`, `set_structural`, `add_history`, `remove_history`, and `set_history_options`.
- [ ] Include affected text, neighbors, current claims, valid options, and allowed histories in patch context.
- [ ] Reject unknown, unrelated, duplicate, and conflicting operations.

### Task 5: Conversion Integration And Cache

**Files:** Modify `src/lib/story-plan/conversion.ts`, its tests, cache, import route, and agent import tool.

- [ ] Add a failing conversion test proving A1/A2/B1/B2 inner monologues stay isolated and merge only at the final caption.
- [ ] Use semantic lineage on attempt one and semantic patch on source-specific attempt two.
- [ ] Materialize and validate the compiled StoryDocument, then build PlotPlan v2 deterministically.
- [ ] Retain the two-attempt limit and source alias/text errors.
- [ ] Bump conversion cache and import variants.

### Task 6: Left/Right Integration Verification

**Files:** Modify `ScriptSplitView.test.tsx`, `FlowChartPanel.test.tsx`, and import wiring tests.

- [ ] Prove that Script row order differing from plot-node order still selects only the correct left-side rows.
- [ ] Prove replayed shared scenes and exclusive monologues map to the correct right-side nodes.
- [ ] Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/semanticLineage.test.ts src/lib/story-plan/aiBranchPlanner.test.ts src/lib/story-plan/conversion.test.ts src/lib/story-plot/deterministicBuilder.test.ts src/lib/script-system/buildPersistedPlotGraph.test.ts src/components/script-system/ScriptSplitView.test.tsx tests/unit/script-system/import-documentation-wiring.test.ts
npm run typecheck
npm run typecheck:api
npx eslint src/lib/story-plan/semanticLineage.ts src/lib/story-plan/semanticLineage.test.ts src/lib/story-plan/aiBranchPlanner.ts src/lib/story-plan/aiBranchPlanner.test.ts src/lib/story-plan/conversion.ts src/lib/story-plan/conversion.test.ts src/lib/story-plot/schema.ts src/lib/story-plot/validator.ts src/lib/story-plot/deterministicBuilder.ts src/lib/script-system/buildPersistedPlotGraph.ts
git diff --check
```

Expected: all targeted tests, both type checks, ESLint, and whitespace validation pass.
