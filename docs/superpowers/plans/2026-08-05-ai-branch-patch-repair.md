# AI Branch Patch Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the second full Branch Planner rewrite with a constrained patch over the first candidate, using structured context for unreachable source units.

**Architecture:** The first call keeps the existing semantic branch structure contract. When deterministic validation returns affected source units, the second call uses `submit_branch_patch`; the server applies validated operations to a clone of the first candidate and validates again. Deterministic plot projection remains unchanged.

**Tech Stack:** TypeScript, Zod, Jest, existing LLM tool calling and Story graph materialization.

---

### Task 1: Roll Back Format-Specific Expansion

**Files:**
- Modify: `src/lib/story-plan/aiBranchPlanner.ts`
- Modify: `src/lib/story-plan/aiBranchPlanner.test.ts`
- Modify: `src/app/api/import-script/route.ts`
- Modify: `src/lib/agent/tools/import-script.ts`
- Modify: `tests/unit/script-system/import-documentation-wiring.test.ts`

- [ ] Remove outcome-marker self-ownership, broad exact-code assignment, and the branch-outcome regex added after the last green Branch Planner baseline. Keep preview ordering, descendant-overlap repair, shared merge protection, and deterministic plot projection.
- [ ] Remove `enableHeuristicBranchParsing: true` from both import paths and its two static assertions.
- [ ] Remove the format-specific `hard-assigns visible nested outcome markers` test.
- [ ] Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts
npm run test:unit -- --runInBand tests/unit/script-system/import-documentation-wiring.test.ts
```

Expected: the prior stable suites pass without format-specific canonicalization.

### Task 2: Add the Branch Patch Contract

**Files:**
- Modify: `src/lib/story-plan/aiBranchPlanner.ts`
- Modify: `src/lib/story-plan/aiBranchPlanner.test.ts`

- [ ] Add failing tests for parsing/applying these operations:

```ts
type AiBranchPatchOperation =
  | { action: 'add_route_unit'; optionSourceUnitId: string; unitId: string }
  | { action: 'remove_route_unit'; optionSourceUnitId: string; unitId: string }
  | { action: 'set_next'; optionSourceUnitId: string; targetUnitId: string | null }
  | { action: 'set_merge'; decisionOwnerUnitId: string; targetUnitId: string | null }
  | { action: 'add_break' | 'remove_break'; unitId: string }
  | { action: 'set_structural'; unitId: string; structural: boolean };
```

Tests must prove `add_route_unit` inserts by source order, untouched decisions remain equal, unknown option/unit IDs throw, and operations unrelated to `validationIssues[].unitIds` throw.

- [ ] Add `AI_BRANCH_PATCH_TOOL` named `submit_branch_patch`, a strict Zod parser, and `applyAiBranchPatch(candidate, patch, source, issues)`.
- [ ] Identify options by unique `sourceUnitId` and decisions by unique `ownerUnitId`; reject ambiguity, unknown IDs, duplicate/conflicting operations, and operations whose affected unit/target is outside reported issue units.
- [ ] Apply operations to cloned arrays only. Sort route units by source order and preserve all untouched fields including `plotGroups`.
- [ ] Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts -t "branch patch"
```

Expected: all patch contract tests pass.

### Task 3: Build Structured Repair Context

**Files:**
- Modify: `src/lib/story-plan/aiBranchPlanner.ts`
- Modify: `src/lib/story-plan/aiBranchPlanner.test.ts`

- [ ] Add failing message tests for an unreachable apology dialogue and a code-less ending marker.
- [ ] Add `buildAiBranchPatchMessages(source, issues, candidate)` returning:

```ts
{
  task: 'REPAIR_BRANCH_STRUCTURE_WITH_PATCH',
  validationIssues,
  affectedUnits: [{
    id, text, visible, ending, structural, currentOptionSourceUnitIds,
    previousVisible: { id, text } | null,
    nextVisible: { id, text } | null,
  }],
  nearbyDecisions,
  previousStructureCandidate,
}
```

Unit IDs sent to the model use compact aliases. `nearbyDecisions` includes options claiming the previous/next visible units plus their route tails, `nextUnitId`, and decision merge.
- [ ] Use a short repair system prompt that permits only patch operations and forbids returning a replacement graph.
- [ ] Run the focused prompt tests and verify both `u76` and `u101` contexts expose exact text, neighbors, and current claims.

### Task 4: Use Patch Repair on Attempt Two

**Files:**
- Modify: `src/lib/story-plan/conversion.ts`
- Modify: `src/lib/story-plan/conversion.test.ts`

- [ ] Add a failing conversion test: attempt one returns a parseable candidate that leaves one visible unit unreachable; attempt two returns `add_route_unit`; conversion succeeds and tool calls equal `['submit_branch_structure', 'submit_branch_patch']`.
- [ ] In the existing two-attempt loop, choose patch mode only when a previous candidate exists and the validation issues contain source unit IDs:

```ts
const usePatchRepair = Boolean(
  previousStructureCandidate
  && branchIssues.some((issue) => issue.unitIds.length > 0)
);
```

- [ ] In patch mode call `buildAiBranchPatchMessages` with `AI_BRANCH_PATCH_TOOL`, parse the patch, and apply it to `previousStructureCandidate`. Otherwise retain the full Branch Planner call for malformed/schema/ownership errors without structured unit IDs.
- [ ] Keep `previousStructureCandidate` updated, keep the two-call cap, and retain final concrete issue formatting.
- [ ] Run complete Branch Planner and conversion suites.

### Task 5: Verification

- [ ] Run deterministic plot, import wiring, type checks, targeted ESLint, and `git diff --check`.
- [ ] Confirm the cache remains on v44 and Branch Planner import plots remain deterministic.
- [ ] Preserve all unrelated worktree changes and do not stage the pre-existing untracked Story Planner files.
