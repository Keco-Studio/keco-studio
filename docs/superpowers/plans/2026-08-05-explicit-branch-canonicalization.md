# Explicit Branch Canonicalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make explicit nested branch outcomes hard-owned, keep sibling routes isolated, and derive imported flow charts only from validated Story relationships.

**Architecture:** Extend the existing Branch Planner normalization rather than adding another full parser. Explicit marker codes override AI route membership for visible branch-region units, while shared/unanimous merge targets remain protected. Fully recognized deterministic formats run before AI, and every import plot is rebuilt from canonical Story IR.

**Tech Stack:** TypeScript, Jest, existing Story segmentation/materialization, deterministic Story plot builder.

---

## File Structure

- Modify `src/lib/story-plan/aiBranchPlanner.ts`: include visible outcome markers in explicit ownership and canonicalize uniquely coded route content.
- Modify `src/lib/story-plan/aiBranchPlanner.test.ts`: reproduce omitted B1/A1/A2 outcomes and prove route isolation/reachability.
- Modify `src/lib/story-plan/conversion.ts`: ignore Branch Planner `plotGroups` and always build canonical deterministic plots.
- Modify `src/lib/story-plan/conversion.test.ts`: verify incorrect AI plot groups cannot move A content into B.
- Modify `src/app/api/import-script/route.ts` and `src/lib/agent/tools/import-script.ts`: enable existing deterministic explicit-format parsers.
- Modify `tests/unit/script-system/import-documentation-wiring.test.ts`: verify deterministic branch and plot options.
- Modify `src/lib/import-script-conversion-cache.ts`: invalidate previously incorrect conversions.

The main Story Planner files are pre-existing untracked worktree files. Do not stage or commit their unrelated contents.

### Task 1: Canonicalize Explicit Outcome Ownership

**Files:**
- Modify: `src/lib/story-plan/aiBranchPlanner.test.ts`
- Modify: `src/lib/story-plan/aiBranchPlanner.ts:205-239`
- Modify: `src/lib/story-plan/aiBranchPlanner.ts:355-407`
- Modify: `src/lib/story-plan/aiBranchPlanner.ts:1090-1125`

- [ ] **Step 1: Add the failing B1 outcome regression**

Add a test using this source and a Branch Planner candidate that omits both outcome markers from `routeUnitIds`:

```ts
it('hard-assigns visible nested outcome markers to their coded routes', () => {
  const source = segmentStorySource([
    '掌柜：接不接这笔钱？',
    '嵌套选择 B1（接下银元，离开）：',
    '伙计接过银元。',
    '嵌套选择 B2（拒绝银元，留下）：',
    '伙计把银元推了回去。',
    '子分支 B1 结局（接下银元，离开）：',
    '伙计消失在雨幕里。',
    '子分支 B2 结局（拒绝银元，留下）：',
    '伙计留在店里守夜。',
  ].join('\n'), 'explicit-outcome-owner');
  const structure = parseAiBranchStructure({
    version: 2,
    structuralUnitIds: ['explicit-outcome-owner:5', 'explicit-outcome-owner:7'],
    sharedReplayUnitIds: [],
    decisions: [{
      ownerUnitId: 'explicit-outcome-owner:0',
      mergeUnitId: null,
      options: [
        {
          sourceUnitId: 'explicit-outcome-owner:1', text: '接下银元，离开',
          routeUnitIds: ['explicit-outcome-owner:2'], nextUnitId: null,
        },
        {
          sourceUnitId: 'explicit-outcome-owner:3', text: '拒绝银元，留下',
          routeUnitIds: ['explicit-outcome-owner:4'], nextUnitId: null,
        },
      ],
    }],
    breakAfterUnitIds: ['explicit-outcome-owner:6', 'explicit-outcome-owner:8'],
  });

  const result = materializeAiBranchStructure(source, structure);
  const document = materializeStoryExtraction(
    buildStoryExtractionFromPlan(result.plan, result.source),
    result.source
  );
  const decision = document.nodes.find((node) => node.options.length === 2)!;
  const nodes = new Map(document.nodes.map((node) => [node.label, node]));
  const walk = (target: string): string[] => {
    const content: string[] = [];
    const seen = new Set<string>();
    let current = target;
    while (current && !seen.has(current)) {
      seen.add(current);
      const node = nodes.get(current);
      if (!node) break;
      content.push(node.content);
      current = node.next ?? '';
    }
    return content;
  };
  const routeB1 = walk(decision.options.find((option) => option.text.includes('接下银元'))!.target);
  const routeB2 = walk(decision.options.find((option) => option.text.includes('拒绝银元'))!.target);

  expect(routeB1).toEqual(expect.arrayContaining([
    '子分支 B1 结局（接下银元，离开）：',
    '伙计消失在雨幕里。',
  ]));
  expect(routeB1).not.toEqual(expect.arrayContaining([
    '子分支 B2 结局（拒绝银元，留下）：',
  ]));
  expect(routeB2).toEqual(expect.arrayContaining([
    '子分支 B2 结局（拒绝银元，留下）：',
    '伙计留在店里守夜。',
  ]));
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts -t "hard-assigns visible nested outcome"
```

Expected: FAIL because B1/B2 outcome markers are structural or enter the shared source-order chain.

- [ ] **Step 3: Include visible outcomes in explicit ownership**

Extend the marker records in `collectExplicitBranchPartHints` and start owned slicing at the marker for visible endings:

```ts
  const markers = source.units.flatMap((unit, unitIndex) => {
    const match = markerPattern.exec(unit.text);
    const partCode = match?.[1] ?? match?.[2];
    return partCode ? [{
      unitIndex,
      partCode: partCode.toUpperCase(),
      ownsMarker: isExplicitEndingSourceUnit(unit.text),
    }] : [];
  });
  // inside markers.forEach
  const owned = source.units
    .slice(marker.ownsMarker ? marker.unitIndex : marker.unitIndex + 1, end)
    .map((unit) => unit.id);
```

- [ ] **Step 4: Expand descendant normalization into canonical exact-code ownership**

Inside `normalizeDescendantPartOwnership`, protect option sources, decision owners, structural-only units, declared shared replay units, and unanimous merge/continuation targets. For each remaining visible owned unit with exactly one matching option code, remove it from all other routes and add it to that option in source order:

```ts
  const optionUnitIds = new Set(normalized.flatMap((decision) => (
    decision.options.map((option) => option.sourceUnitId)
  )));
  const decisionOwnerUnitIds = new Set(normalized.map((decision) => decision.ownerUnitId));
  const protectedContinuationUnitIds = new Set(normalized.flatMap((decision) => {
    if (!decision.mergeUnitId) return [];
    return decision.options.every((option) => option.nextUnitId === decision.mergeUnitId)
      ? [decision.mergeUnitId]
      : [];
  }));
  const visibleUnitIds = new Set(source.segments
    .filter((segment) => segment.display)
    .map((segment) => segment.unitId));

  ownerByUnitId.forEach((owner, unitId) => {
    if (
      !visibleUnitIds.has(unitId)
      || optionUnitIds.has(unitId)
      || decisionOwnerUnitIds.has(unitId)
      || protectedContinuationUnitIds.has(unitId)
    ) return;
    const destinations = optionsByCode.get(owner) ?? [];
    if (destinations.length !== 1) return;
    normalized.forEach((decision) => decision.options.forEach((option) => {
      option.routeUnitIds = option.routeUnitIds.filter((candidate) => candidate !== unitId);
    }));
    moved.set(destinations[0], [...(moved.get(destinations[0]) ?? []), unitId]);
  });
```

Pass effective structural/shared exclusions into the helper or derive them from source/structure. Ensure `effectiveStructuralUnitIds` always removes `isExplicitEndingSourceUnit` units, including direct `version: 2` candidates.

- [ ] **Step 5: Verify GREEN and route isolation**

Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts -t "hard-assigns visible nested outcome|explicit B part|A2 part content|replays shared setup"
```

Expected: all selected tests PASS; outcomes are reachable only on their coded routes, sibling mismatches still fail, and shared merges remain intact.

### Task 2: Make Import Plot Projection Deterministic

**Files:**
- Modify: `src/lib/story-plan/conversion.test.ts`
- Modify: `src/lib/story-plan/conversion.ts:342-347`

- [ ] **Step 1: Add a failing conversion regression**

Add a Branch Planner conversion test whose canonical Story routes are A/B but whose `plotGroups` deliberately assign A content under the B title. Assert the result uses canonical titles/branch boundaries from `buildDeterministicStoryPlotPlan`, not the supplied AI titles:

```ts
expect(result.plotPlan.nodes.map((node) => node.title)).not.toContain('错误的分支B分组');
expect(result.plotPlan.edges.filter((edge) => edge.optionText).map((edge) => edge.optionText))
  .toEqual(['买。', '不买。']);
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/conversion.test.ts -t "ignores Branch Planner plot groups"
```

Expected: FAIL because `structure.plotGroups` currently calls `buildStoryPlotPlanFromAiGroups`.

- [ ] **Step 3: Always build the plot from validated Story IR**

Replace the conditional plot selection after `materializeStoryExtraction`:

```ts
        const plotPlan = buildDeterministicStoryPlotPlan(document);
```

Remove the unused `buildStoryPlotPlanFromAiGroups` import from `conversion.ts`. Keep its exported helper and unit tests because it remains a valid isolated utility outside the import path.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/conversion.test.ts
npm run test:unit -- --runInBand src/lib/story-plot/deterministicBuilder.test.ts
```

Expected: both suites PASS; update old conversion assertions that expected AI plot titles to assert canonical nodes/edges instead.

### Task 3: Prefer Deterministic Parsers and Invalidate Cache

**Files:**
- Modify: `src/app/api/import-script/route.ts:140-146`
- Modify: `src/lib/agent/tools/import-script.ts`
- Modify: `tests/unit/script-system/import-documentation-wiring.test.ts`
- Modify: `src/lib/import-script-conversion-cache.ts:3`

- [ ] **Step 1: Strengthen the static wiring test and verify RED**

Extend both import assertions:

```ts
expect(route).toContain('enableHeuristicBranchParsing: true');
expect(source).toContain('enableHeuristicBranchParsing: true');
```

Run:

```bash
npm run test:unit -- --runInBand tests/unit/script-system/import-documentation-wiring.test.ts
```

Expected: FAIL because neither import path enables deterministic explicit-format parsers.

- [ ] **Step 2: Enable deterministic explicit-format parsers**

Add this option beside `enableAiPlotPlanning: false` in both import paths:

```ts
enableHeuristicBranchParsing: true,
```

- [ ] **Step 3: Bump the cache version**

Change:

```ts
const CACHE_VERSION = 'story-ir-conversion-v44-explicit-branch-canonicalization';
```

- [ ] **Step 4: Verify wiring and full affected suites**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/script-system/import-documentation-wiring.test.ts
npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts
npm run test:unit -- --runInBand src/lib/story-plan/conversion.test.ts
npm run test:unit -- --runInBand src/lib/story-plan/explicitParser.test.ts
npm run test:unit -- --runInBand src/lib/story-plot/deterministicBuilder.test.ts
```

Expected: all suites PASS.

### Task 4: Final Verification

**Files:**
- Verify all files listed above.

- [ ] **Step 1: Run type checks and targeted lint**

```bash
npm run typecheck
npm run typecheck:api
npx eslint src/lib/story-plan/aiBranchPlanner.ts src/lib/story-plan/aiBranchPlanner.test.ts src/lib/story-plan/conversion.ts src/lib/story-plan/conversion.test.ts src/app/api/import-script/route.ts src/lib/agent/tools/import-script.ts src/lib/import-script-conversion-cache.ts tests/unit/script-system/import-documentation-wiring.test.ts
```

Expected: every command exits 0.

- [ ] **Step 2: Check worktree integrity**

```bash
git diff --check
git status --short
```

Expected: whitespace check exits 0; preserve all unrelated pre-existing changes and do not stage untracked Story Planner files.
