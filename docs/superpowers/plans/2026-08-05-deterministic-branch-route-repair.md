# Deterministic Branch Route Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair unambiguous nested branch-route ownership locally so valid screenplay imports do not exhaust two Branch Planner attempts with misplaced or unreachable source units.

**Architecture:** Extend the existing `version: 2` pre-materialization normalization pipeline in `aiBranchPlanner.ts`. Source order and explicit part codes provide the only repair evidence; ambiguous sibling ownership continues to fail through the existing assertion. Preserve a continuation classified as branch-owned only when every sibling explicitly declares the same decision merge target.

**Tech Stack:** TypeScript, Zod, Jest, existing Story source segmentation and relationship materializer.

---

## File Structure

- Modify `src/lib/story-plan/aiBranchPlanner.ts`: normalize preview ownership, uniquely move descendant-owned units, and preserve unanimously declared merge targets.
- Modify `src/lib/story-plan/aiBranchPlanner.test.ts`: add focused materialization regressions and use the existing shared-replay regression.
- Verify `src/lib/story-plan/conversion.test.ts`: prove the import orchestration remains compatible with the normalized structure.

The two modified files are pre-existing untracked worktree files. Do not create commits that stage their unrelated existing contents; use focused diffs and verification output as checkpoints.

### Task 1: Make Contiguous Option Previews Authoritative

**Files:**
- Modify: `src/lib/story-plan/aiBranchPlanner.test.ts`
- Modify: `src/lib/story-plan/aiBranchPlanner.ts:359-411`

- [ ] **Step 1: Write the failing regression**

Add this test beside `assigns contiguous option preview dialogue before later branch body sections`:

```ts
it('moves a final option preview out of a wrongly claiming sibling route', () => {
  const source = segmentStorySource([
    '王大可：该怎么回应？',
    '嵌套选择 B1（顺势而为）：',
    '王大可立即敲响了总监的门。',
    '嵌套选择 B2（惊慌失措）：',
    '王大可面如土色，疯狂发消息。',
    '“李总我错了！我那是情绪发泄！您别截图了！我马上重写！”',
    '子分支 B1 结局（改革先锋）：',
    '王大可推动了周报改革。',
    '子分支 B2 结局（道歉立功）：',
    '李总给王大可加了绩效分。',
  ].join('\n'), 'misclaimed-option-preview');
  const structure = parseAiBranchStructure({
    version: 2,
    structuralUnitIds: [
      'misclaimed-option-preview:6',
      'misclaimed-option-preview:8',
    ],
    sharedReplayUnitIds: [],
    decisions: [{
      ownerUnitId: 'misclaimed-option-preview:0',
      mergeUnitId: null,
      options: [
        {
          sourceUnitId: 'misclaimed-option-preview:1',
          text: '顺势而为',
          routeUnitIds: [
            'misclaimed-option-preview:2',
            'misclaimed-option-preview:5',
            'misclaimed-option-preview:7',
          ],
          nextUnitId: null,
        },
        {
          sourceUnitId: 'misclaimed-option-preview:3',
          text: '惊慌失措',
          routeUnitIds: ['misclaimed-option-preview:9'],
          nextUnitId: null,
        },
      ],
    }],
    breakAfterUnitIds: [
      'misclaimed-option-preview:7',
      'misclaimed-option-preview:9',
    ],
  });

  const result = materializeAiBranchStructure(source, structure);
  const document = materializeStoryExtraction(
    buildStoryExtractionFromPlan(result.plan, result.source),
    result.source
  );
  const nodesByLabel = new Map(document.nodes.map((node) => [node.label, node]));
  const walk = (target: string): string[] => {
    const content: string[] = [];
    const seen = new Set<string>();
    let current = target;
    while (current && !seen.has(current)) {
      seen.add(current);
      const node = nodesByLabel.get(current);
      if (!node) break;
      content.push(node.content);
      current = node.next ?? '';
    }
    return content;
  };
  const [routeB1, routeB2] = document.nodes[0].options.map((option) => walk(option.target));

  expect(routeB1).not.toContain(
    '“李总我错了！我那是情绪发泄！您别截图了！我马上重写！”'
  );
  expect(routeB2).toEqual(expect.arrayContaining([
    '王大可面如土色，疯狂发消息。',
    '“李总我错了！我那是情绪发泄！您别截图了！我马上重写！”',
    '李总给王大可加了绩效分。',
  ]));
});
```

- [ ] **Step 2: Run the regression and verify RED**

Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts -t "moves a final option preview"
```

Expected: FAIL because the apology line remains on B1 and is absent from B2.

- [ ] **Step 3: Make preview source ranges override candidate route claims**

In `normalizeExplicitOptionPreviews`, remove `claimedRouteUnitIds` from the eligibility filter. Before prepending each computed preview range, remove those units from every normalized option route:

```ts
      const previewUnitIds = source.units.slice(start + 1, end)
        .filter((unit) => (
          visibleUnitIds.has(unit.id)
          && !optionUnitIds.has(unit.id)
          && !decisionOwnerUnitIds.has(unit.id)
          && !structural.has(unit.id)
        ))
        .map((unit) => unit.id);
      if (previewUnitIds.length === 0) return;
      const preview = new Set(previewUnitIds);
      normalized.forEach((candidateDecision) => {
        candidateDecision.options.forEach((candidateOption) => {
          candidateOption.routeUnitIds = candidateOption.routeUnitIds.filter((unitId) => (
            !preview.has(unitId)
          ));
        });
      });
      option.routeUnitIds = [...previewUnitIds, ...option.routeUnitIds];
```

Delete the now-unused `claimedRouteUnitIds` declaration and its `.add()` update.

- [ ] **Step 4: Verify GREEN and check nearby preview behavior**

Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts -t "option preview|contiguous option preview"
```

Expected: PASS for the new misclaimed-preview test and the existing preview test.

- [ ] **Step 5: Inspect the focused diff checkpoint**

Run:

```bash
git diff -- src/lib/story-plan/aiBranchPlanner.ts src/lib/story-plan/aiBranchPlanner.test.ts
```

Expected: only the preview normalization and its regression are new relative to the current worktree state.

### Task 2: Move Explicit Descendant Content Out of Parent Routes

**Files:**
- Modify: `src/lib/story-plan/aiBranchPlanner.test.ts`
- Modify: `src/lib/story-plan/aiBranchPlanner.ts:272-358`
- Modify: `src/lib/story-plan/aiBranchPlanner.ts:1019-1026`

- [ ] **Step 1: Write the failing descendant-ownership regression**

Add this test beside the explicit part ownership tests:

```ts
it('moves a child-part unit claimed only by its parent option to the child option', () => {
  const source = segmentStorySource([
    '王大可：周报怎么写？',
    '选择 A：胡编乱造。',
    '选择 B：硬刚坦白。',
    '分支 A（胡编乱造）',
    '王大可：AI误判了我，怎么办？',
    '选择 A1：对质AI系统。',
    '选择 A2：承认是AI写的。',
    '子分支 A1 结局（对质）：',
    '王大可被实际操作记录拆穿。',
    '子分支 A2 结局（自首）：',
    '王大可成了全公司的笑话。',
    '分支 B（硬刚坦白）',
    '王大可的诚实周报意外走红。',
  ].join('\n'), 'descendant-route-repair');
  const structure = parseAiBranchStructure({
    version: 2,
    structuralUnitIds: [
      'descendant-route-repair:3',
      'descendant-route-repair:7',
      'descendant-route-repair:9',
      'descendant-route-repair:11',
    ],
    sharedReplayUnitIds: [],
    decisions: [
      {
        ownerUnitId: 'descendant-route-repair:0',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'descendant-route-repair:1',
            text: '选择 A：胡编乱造。',
            routeUnitIds: [
              'descendant-route-repair:4',
              'descendant-route-repair:8',
            ],
            nextUnitId: null,
          },
          {
            sourceUnitId: 'descendant-route-repair:2',
            text: '选择 B：硬刚坦白。',
            routeUnitIds: ['descendant-route-repair:12'],
            nextUnitId: null,
          },
        ],
      },
      {
        ownerUnitId: 'descendant-route-repair:4',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'descendant-route-repair:5',
            text: '选择 A1：对质AI系统。',
            routeUnitIds: [],
            nextUnitId: null,
          },
          {
            sourceUnitId: 'descendant-route-repair:6',
            text: '选择 A2：承认是AI写的。',
            routeUnitIds: ['descendant-route-repair:10'],
            nextUnitId: null,
          },
        ],
      },
    ],
    breakAfterUnitIds: [
      'descendant-route-repair:8',
      'descendant-route-repair:10',
      'descendant-route-repair:12',
    ],
  });

  const result = materializeAiBranchStructure(source, structure);
  const unitNode = result.plan.nodes.find((node) => (
    node.contentSegmentIds.some((segmentId) => (
      segmentId.startsWith('descendant-route-repair:8:')
    ))
  ));
  const a1Choice = result.plan.choices.find((choice) => (
    choice.textSegmentIds.some((segmentId) => (
      segmentId.startsWith('descendant-route-repair:5:')
    ))
  ));

  expect(unitNode).toBeDefined();
  expect(a1Choice?.targetNodeId).toBe(unitNode?.id);
  expect(() => materializeStoryExtraction(
    buildStoryExtractionFromPlan(result.plan, result.source),
    result.source
  )).not.toThrow();
});
```

- [ ] **Step 2: Run the regression and verify RED**

Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts -t "moves a child-part unit"
```

Expected: FAIL with `AI option A contains source u8 owned by explicit branch part A1`.

- [ ] **Step 3: Add the uniquely matched descendant repair**

Add this helper after `normalizeAncestorRouteOverlaps`:

```ts
function normalizeDescendantPartOwnership(
  source: SegmentedStorySource,
  decisions: AiBranchStructure['decisions']
): AiBranchStructure['decisions'] {
  const ownerByUnitId = new Map(collectExplicitBranchPartHints(source).flatMap((hint) => (
    hint.unitIds.map((unitId) => [unitId, hint.partCode] as const)
  )));
  if (ownerByUnitId.size === 0) return decisions;
  const unitsById = new Map(source.units.map((unit) => [unit.id, unit]));
  const unitIndex = new Map(source.units.map((unit, index) => [unit.id, index]));
  const optionCode = (
    option: AiBranchStructure['decisions'][number]['options'][number]
  ): string | undefined => {
    const evidence = `${unitsById.get(option.sourceUnitId)?.text ?? ''} ${option.text}`;
    return /(?:选择|选项|分支)\s*([A-Za-z]\d*)\b/i.exec(evidence)?.[1].toUpperCase();
  };
  const normalized = decisions.map((decision) => ({
    ...decision,
    options: decision.options.map((option) => ({
      ...option,
      routeUnitIds: [...option.routeUnitIds],
    })),
  }));
  type BranchOption = typeof normalized[number]['options'][number];
  const optionsByCode = new Map<string, BranchOption[]>();
  normalized.forEach((decision) => decision.options.forEach((option) => {
    const code = optionCode(option);
    if (!code) return;
    optionsByCode.set(code, [...(optionsByCode.get(code) ?? []), option]);
  }));
  const moved = new Map<BranchOption, string[]>();

  normalized.forEach((decision) => decision.options.forEach((option) => {
    const code = optionCode(option);
    if (!code) return;
    option.routeUnitIds = option.routeUnitIds.filter((unitId) => {
      const owner = ownerByUnitId.get(unitId);
      if (!owner || owner.length <= code.length || !owner.startsWith(code)) return true;
      const destinations = optionsByCode.get(owner) ?? [];
      if (destinations.length !== 1) return true;
      moved.set(destinations[0], [...(moved.get(destinations[0]) ?? []), unitId]);
      return false;
    });
  }));
  moved.forEach((unitIds, option) => {
    option.routeUnitIds = [...new Set([...option.routeUnitIds, ...unitIds])]
      .sort((left, right) => (
        (unitIndex.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (unitIndex.get(right) ?? Number.MAX_SAFE_INTEGER)
      ));
  });
  return normalized;
}
```

Wire it between ancestor-overlap normalization and cross-part continuation normalization:

```ts
  const ownershipNormalizedDecisions = directOptionContinuations
    ? normalizeDescendantPartOwnership(source, hierarchyNormalizedDecisions)
    : hierarchyNormalizedDecisions;
  const partNormalizedDecisions = directOptionContinuations
    ? normalizeCrossPartContinuations(source, ownershipNormalizedDecisions)
    : ownershipNormalizedDecisions;
```

- [ ] **Step 4: Verify GREEN and preserve sibling rejection**

Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts -t "child-part unit|explicit B part|A2 part content"
```

Expected: the descendant repair passes; true `A` versus `B` and `A1` versus `A2` sibling mismatches still throw and their rejection tests pass.

- [ ] **Step 5: Inspect the focused diff checkpoint**

Run:

```bash
git diff -- src/lib/story-plan/aiBranchPlanner.ts src/lib/story-plan/aiBranchPlanner.test.ts
```

Expected: one helper, one pipeline call, and one descendant regression beyond Task 1.

### Task 3: Preserve a Unanimously Declared Shared Merge

**Files:**
- Modify: `src/lib/story-plan/aiBranchPlanner.ts:413-453`
- Test: `src/lib/story-plan/aiBranchPlanner.test.ts:135-220`

- [ ] **Step 1: Confirm the existing shared-suffix test is RED**

Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts -t "replays shared setup on each route"
```

Expected: FAIL because route A stops after its history-specific continuation while route B alone reaches `风吹过墓碑，纸张微微作响。`.

- [ ] **Step 2: Preserve explicit agreement on a decision merge**

In `normalizeCrossPartContinuations`, calculate whether every sibling explicitly points to the declared merge and exempt only that target from part incompatibility:

```ts
  return decisions.map((decision) => {
    const unanimouslyDeclaredMerge = Boolean(
      decision.mergeUnitId
      && decision.options.every((option) => (
        Object.hasOwn(option, 'nextUnitId')
        && option.nextUnitId === decision.mergeUnitId
      ))
    );
    const options = decision.options.map((option) => {
      const code = optionCode(option);
      const nextOwner = option.nextUnitId
        ? ownerByUnitId.get(option.nextUnitId)
        : undefined;
      const isDeclaredMerge = unanimouslyDeclaredMerge
        && option.nextUnitId === decision.mergeUnitId;
      return option.nextUnitId && !isDeclaredMerge && !compatible(code, nextOwner)
        ? { ...option, nextUnitId: null }
        : { ...option };
    });
    const mergeOwner = decision.mergeUnitId
      ? ownerByUnitId.get(decision.mergeUnitId)
      : undefined;
    const mergeIsCompatible = unanimouslyDeclaredMerge || options.every((option) => (
      compatible(optionCode(option), mergeOwner)
    ));
    return {
      ...decision,
      mergeUnitId: mergeIsCompatible ? decision.mergeUnitId : null,
      options,
    };
  });
```

- [ ] **Step 3: Verify the merge regression and cross-level guard**

Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts -t "replays shared setup|cuts a nested A2 continuation"
```

Expected: PASS. Both A and B reach the shared suffix, while an A2-only continuation into part B is still cut.

- [ ] **Step 4: Inspect the focused diff checkpoint**

Run:

```bash
git diff -- src/lib/story-plan/aiBranchPlanner.ts src/lib/story-plan/aiBranchPlanner.test.ts
```

Expected: only the unanimous-merge exception is added for this task.

### Task 4: Full Verification

**Files:**
- Verify: `src/lib/story-plan/aiBranchPlanner.ts`
- Verify: `src/lib/story-plan/aiBranchPlanner.test.ts`
- Verify: `src/lib/story-plan/conversion.test.ts`

- [ ] **Step 1: Run the complete Branch Planner suite**

Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/aiBranchPlanner.test.ts
```

Expected: all Branch Planner tests PASS with no unreachable-node or sibling-leak failure.

- [ ] **Step 2: Run conversion orchestration tests**

Run:

```bash
npm run test:unit -- --runInBand src/lib/story-plan/conversion.test.ts
```

Expected: all conversion tests PASS; retry messages and the two-attempt cap remain unchanged.

- [ ] **Step 3: Run TypeScript checks**

Run:

```bash
npm run typecheck
npm run typecheck:api
```

Expected: both commands exit 0 with no TypeScript diagnostics.

- [ ] **Step 4: Run targeted lint**

Run:

```bash
npx eslint src/lib/story-plan/aiBranchPlanner.ts src/lib/story-plan/aiBranchPlanner.test.ts
```

Expected: exit 0 with no lint errors.

- [ ] **Step 5: Check whitespace and report the final focused diff**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` exits 0. Preserve all unrelated pre-existing modified and untracked files; do not stage or revert them.
