# Import Script Minimal Story Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unstable MiniMax-facing full Story IR contract with server-owned source segments, a flat relationship plan, mandatory MiniMax audit, and deterministic hydration into the existing StoryDocument/table/player pipeline.

**Architecture:** Add `src/lib/story-plan` as the only provider-facing boundary. The server owns exact text, offsets, commands, hydration, validation, and table compilation. MiniMax-M3 returns only flat IDs/relationships and independently audits every candidate before database writes.

**Tech Stack:** TypeScript, Zod, Jest, MiniMax-M3 OpenAI-compatible tool calls, Next.js Route Handlers, existing Story IR compiler and player.

## Global Constraints

- MiniMax-M3 is the only Import Script LLM provider.
- Every candidate, including deterministic parses, requires a MiniMax Auditor pass.
- MiniMax never authors imported text, offsets, full source references, numeric command values, or rows.
- Plan and audit schemas are flat, non-recursive, and require every field.
- Maximum two candidate attempts, four LLM calls, and 60 seconds per call.
- Any failure, timeout, cancellation, or rejection creates no library or partial rows.
- Existing table and playback behavior remains compatible.
- Oversized stories fail explicitly; no character-count chunking in milestone one.
- Every task follows RED, GREEN, focused regression, commit.

## File Map

- Create `src/lib/story-plan/schema.ts`, `sourceSegments.ts`, `explicitParser.ts`, `hydrator.ts`, `validator.ts`, `projection.ts`, `prompts.ts`, and `conversion.ts`, each with a colocated Jest test.
- Modify the conversion facade, modal route, agent import tool, progress streams, and Import Script progress UI.
- Keep internal `story-ir/schema.ts`, `commands.ts`, `tableCompiler.ts`, and the player.
- Delete old provider-facing Story IR conversion, prompts, and chunking only after replacement verification.

---

### Task 1: Flat Plan and Audit Schemas

**Files:**
- Create: `src/lib/story-plan/schema.ts`
- Create: `src/lib/story-plan/schema.test.ts`

**Interfaces:**
- Produces: `StoryRelationshipPlan`, `PlannedNode`, `PlannedChoice`, `StoryPlanAudit`, `parseStoryRelationshipPlan`, `parseStoryPlanAudit`.

- [ ] **Step 1: Write failing tests**

```typescript
const validPlan = {
  version: 2,
  entryNodeId: 'n1',
  nodes: [{
    id: 'n1', type: 'dialogue', speakerSegmentId: 's1',
    contentSegmentIds: ['s2'], commandIds: [], nextNodeId: '',
  }],
  choices: [],
};

expect(parseStoryRelationshipPlan(validPlan)).toEqual(validPlan);
expect(() => parseStoryRelationshipPlan({ ...validPlan, nodes: { item: validPlan.nodes } })).toThrow();
expect(() => parseStoryRelationshipPlan({
  ...validPlan,
  nodes: [{ ...validPlan.nodes[0], sourceRefs: [] }],
})).toThrow();
expect(parseStoryPlanAudit({ verdict: 'pass', issues: [] })).toEqual({ verdict: 'pass', issues: [] });
```

- [ ] **Step 2: Run RED**

```bash
npm run test:unit -- --runInBand src/lib/story-plan/schema.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement exact schemas**

```typescript
const IdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);

export const PlannedNodeSchema = z.object({
  id: IdSchema,
  type: z.enum(['dialogue', 'narration', 'scene', 'system']),
  speakerSegmentId: z.string(),
  contentSegmentIds: z.array(z.string().min(1)),
  commandIds: z.array(z.string().min(1)),
  nextNodeId: z.string(),
}).strict();

export const PlannedChoiceSchema = z.object({
  id: IdSchema,
  fromNodeId: IdSchema,
  textSegmentIds: z.array(z.string().min(1)).min(1),
  targetNodeId: IdSchema,
  commandIds: z.array(z.string().min(1)),
}).strict();
```

Add strict root plan schema with `version: 2`, plus the exact flat audit issue enum from the design: omission, duplicate content, added content, meaning change, speaker/branch/merge/leak errors, command mutation/owner, and table mismatch.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm run test:unit -- --runInBand src/lib/story-plan/schema.test.ts
git add src/lib/story-plan/schema.ts src/lib/story-plan/schema.test.ts
git commit -m "feat: add flat story plan contracts"
```

---

### Task 2: Exact Source Segments and Command Inventory

**Files:**
- Create: `src/lib/story-plan/sourceSegments.ts`
- Create: `src/lib/story-plan/sourceSegments.test.ts`
- Reuse: `src/lib/story-ir/sourceUnits.ts`
- Reuse: `src/lib/story-ir/commands.ts`

**Interfaces:**
- Produces: `SourceSegment`, `SourceCommand`, `SegmentedStorySource`, `segmentStorySource`, `sourceRefsForSegmentIds`.

- [ ] **Step 1: Write failing tests**

```typescript
const source = [
  '神秘女子（声音轻柔）：深夜进山，风雨大作。',
  'O1: 走左边。 ($trust+=1; jump O1)',
  'O1 branch [O1 | 左边小路]',
  '(Jump Merge)',
].join('\n');
const result = segmentStorySource(source, 'fixture');

expect(result.segments).toEqual(expect.arrayContaining([
  expect.objectContaining({ kind: 'speaker', text: '神秘女子' }),
  expect.objectContaining({ kind: 'stage_direction', text: '声音轻柔' }),
  expect.objectContaining({ kind: 'dialogue', text: '深夜进山，风雨大作。' }),
  expect.objectContaining({ kind: 'choice_text', text: '走左边。' }),
  expect.objectContaining({ kind: 'branch_marker', text: '左边小路' }),
  expect.objectContaining({ kind: 'jump_hint', text: 'Merge' }),
]));
expect(result.commands[0]).toMatchObject({ source: '$trust+=1', variable: 'trust', operator: '+=', value: 1 });
```

Also assert every segment equals `source.slice(start, end)` and unsafe partial lines remain complete narration segments.

- [ ] **Step 2: Run RED**

```bash
npm run test:unit -- --runInBand src/lib/story-plan/sourceSegments.test.ts
```

- [ ] **Step 3: Implement the public contracts**

```typescript
export interface SourceSegment {
  id: string;
  unitId: string;
  kind: 'speaker' | 'dialogue' | 'stage_direction' | 'narration'
    | 'scene_heading' | 'choice_text' | 'branch_marker'
    | 'command' | 'jump_hint' | 'structural';
  text: string;
  start: number;
  end: number;
  display: boolean;
  required: boolean;
}

export interface SourceCommand {
  id: string;
  segmentId: string;
  source: string;
  variable: string;
  operator: '=' | '+=' | '-=' | '*=' | '/=';
  value: number;
}
```

Use anchored patterns for dialogue, options, branches/merges, jump-only lines, headings, and commands. Segment IDs are `${unit.id}:segment:${index}`; command IDs are `${unit.id}:command:${index}`. Unknown lines stay whole.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm run test:unit -- --runInBand src/lib/story-plan/sourceSegments.test.ts src/lib/story-ir/sourceUnits.test.ts src/lib/story-ir/commands.test.ts
git add src/lib/story-plan/sourceSegments.ts src/lib/story-plan/sourceSegments.test.ts
git commit -m "feat: segment story sources deterministically"
```

---

### Task 3: Deterministic Explicit Story Parser

**Files:**
- Create: `src/lib/story-plan/explicitParser.ts`
- Create: `src/lib/story-plan/explicitParser.test.ts`
- Reuse: `tests/fixtures/import-script/nested-trust-story.txt`

**Interfaces:**
- Produces: `tryParseExplicitStory(source): StoryRelationshipPlan | null`.

- [ ] **Step 1: Write failing fixture tests**

```typescript
expect(plan.entryNodeId).toBe('Start');
expect(plan.choices).toEqual(expect.arrayContaining([
  expect.objectContaining({ fromNodeId: 'Start', targetNodeId: 'O1' }),
  expect.objectContaining({ fromNodeId: 'Start', targetNodeId: 'O2' }),
  expect.objectContaining({ fromNodeId: 'O1', targetNodeId: 'O1A_END' }),
  expect.objectContaining({ fromNodeId: 'O1', targetNodeId: 'O1B_END' }),
  expect.objectContaining({ fromNodeId: 'O2', targetNodeId: 'O2A_END' }),
  expect.objectContaining({ fromNodeId: 'O2', targetNodeId: 'O2B_END' }),
]));
expect(plan.nodes.filter((node) => node.nextNodeId === 'Oend')).toHaveLength(4);
```

Assert option commands are command IDs and ordinary prose returns `null`.

- [ ] **Step 2: Run RED**

```bash
npm run test:unit -- --runInBand src/lib/story-plan/explicitParser.test.ts
```

- [ ] **Step 3: Implement exact parsing behavior**

```typescript
export function tryParseExplicitStory(
  source: SegmentedStorySource
): StoryRelationshipPlan | null;
```

Create/reuse explicit branch nodes, attach options to the nearest preceding prompt, attach commands from the option unit, resolve `Jump Merge` only when one merge declaration exists, and return `null` on duplicate labels, ambiguous merges, or absence of explicit branch structure.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm run test:unit -- --runInBand src/lib/story-plan/explicitParser.test.ts src/lib/story-plan/sourceSegments.test.ts
git add src/lib/story-plan/explicitParser.ts src/lib/story-plan/explicitParser.test.ts
git commit -m "feat: parse explicit story graphs"
```

---

### Task 4: Plan Validation and StoryDocument Hydration

**Files:**
- Create: `src/lib/story-plan/validator.ts`
- Create: `src/lib/story-plan/validator.test.ts`
- Create: `src/lib/story-plan/hydrator.ts`
- Create: `src/lib/story-plan/hydrator.test.ts`

**Interfaces:**
- Produces: `validateStoryPlan`, `StoryPlanIssue`, `hydrateStoryDocument`.

- [ ] **Step 1: Write failing validation tests**

Cover exact issue codes:

```typescript
type StoryPlanIssueCode =
  | 'invalid_entry' | 'duplicate_node_id' | 'duplicate_choice_id'
  | 'unknown_segment' | 'segment_kind_mismatch' | 'omitted_segment'
  | 'duplicate_segment' | 'unknown_command' | 'wrong_command_owner'
  | 'unresolved_target' | 'unreachable_node' | 'branch_leak'
  | 'invalid_merge' | 'automatic_cycle';
```

Use `A -> B -> A` for `automatic_cycle` and reuse one required dialogue segment in two nodes for `duplicate_segment`.

- [ ] **Step 2: Write failing hydration tests**

Assert exact content assembly, role mapping, option/command ownership, plan order, and server-created source references. No offset from the plan may influence the document.

- [ ] **Step 3: Run RED**

```bash
npm run test:unit -- --runInBand src/lib/story-plan/validator.test.ts src/lib/story-plan/hydrator.test.ts
```

- [ ] **Step 4: Implement stable validation and hydration**

```typescript
export interface StoryPlanIssue {
  code: StoryPlanIssueCode;
  message: string;
  unitIds: string[];
  nodeIds: string[];
}

export function validateStoryPlan(
  plan: StoryRelationshipPlan,
  source: SegmentedStorySource
): StoryPlanIssue[];

export function hydrateStoryDocument(
  plan: StoryRelationshipPlan,
  source: SegmentedStorySource,
  roleMap: RoleMap = {}
): StoryDocument;
```

Validate IDs, ownership, exact required coverage, duplication, targets, reachability, branch isolation, merges, and cycles in stable order. Hydrate only after zero issues; join content in source order, map speakers, resolve commands by ID, attach choices in plan order, and create source refs on the server.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm run test:unit -- --runInBand src/lib/story-plan/validator.test.ts src/lib/story-plan/hydrator.test.ts src/lib/story-ir/tableCompiler.test.ts src/components/libraries/components/scriptPlayer.test.ts
git add src/lib/story-plan/validator.ts src/lib/story-plan/validator.test.ts src/lib/story-plan/hydrator.ts src/lib/story-plan/hydrator.test.ts
git commit -m "feat: hydrate and validate story plans"
```

---

### Task 5: Audit Projection

**Files:**
- Create: `src/lib/story-plan/projection.ts`
- Create: `src/lib/story-plan/projection.test.ts`

**Interfaces:**
- Produces: `StoryAuditProjection`, `buildStoryAuditProjection`.

- [ ] **Step 1: Write failing tests**

```typescript
const projection = buildStoryAuditProjection(document);
expect(projection.rows[0]).toEqual({
  label: 'Start', type: 'dialogue', speaker: 'Guide', content: 'Choose a path.',
  commands: [], nextNodeId: '',
  choices: [{ text: 'Go left.', targetNodeId: 'Left', commands: ['$trust+=1'] }],
});
expect(projection.paths).toContainEqual({ labels: ['Start', 'Left', 'End'], terminalLabel: 'End' });
```

Add a cycle test that must throw instead of looping.

- [ ] **Step 2: Run RED**

```bash
npm run test:unit -- --runInBand src/lib/story-plan/projection.test.ts
```

- [ ] **Step 3: Implement projection**

```typescript
export interface StoryAuditProjection {
  rows: Array<{
    label: string;
    type: StoryNode['type'];
    speaker: string;
    content: string;
    commands: string[];
    nextNodeId: string;
    choices: Array<{ text: string; targetNodeId: string; commands: string[] }>;
  }>;
  table: CompiledStoryTable;
  paths: Array<{ labels: string[]; terminalLabel: string }>;
}

export function buildStoryAuditProjection(document: StoryDocument): StoryAuditProjection;
```

Use `document.nodes.length * 4` as the maximum traversal count.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm run test:unit -- --runInBand src/lib/story-plan/projection.test.ts src/lib/story-ir/tableCompiler.test.ts
git add src/lib/story-plan/projection.ts src/lib/story-plan/projection.test.ts
git commit -m "feat: project stories for semantic audit"
```

---

### Task 6: Flat MiniMax Converter and Mandatory Auditor

**Files:**
- Create: `src/lib/story-plan/prompts.ts`
- Create: `src/lib/story-plan/prompts.test.ts`
- Create: `src/lib/story-plan/conversion.ts`
- Create: `src/lib/story-plan/conversion.test.ts`

**Interfaces:**
- Produces: `resolveStoryPlanForImport`, `ResolvedAuditedStory`, `StoryPlanProgressEvent`, `ImportStoryPlanError`.

- [ ] **Step 1: Write failing prompt tests**

Assert the Converter root has only `version`, `entryNodeId`, `nodes`, `choices`; Auditor has only `verdict`, `issues`; neither has `$defs`, source refs, offsets, structural repairs, visible content, or numeric command values.

- [ ] **Step 2: Write failing orchestration tests**

Cover: explicit candidate uses Auditor only; natural input uses Converter then Auditor; audit failure triggers one Converter/Auditor repair round; second failure terminates; validation failure feeds structured issues to Converter; timeout/cancellation aborts; `{ item, next }` is strictly rejected without normalization.

Also assert a source above `maxSourceChars` fails before `completeLlm` is called and reports a concise oversized-story error.

- [ ] **Step 3: Run RED**

```bash
npm run test:unit -- --runInBand src/lib/story-plan/prompts.test.ts src/lib/story-plan/conversion.test.ts
```

- [ ] **Step 4: Implement tools, prompts, and orchestration**

```typescript
export interface ResolvedAuditedStory {
  document: StoryDocument;
  source: SegmentedStorySource;
  plan: StoryRelationshipPlan;
  projection: StoryAuditProjection;
  audit: StoryPlanAudit;
  converted: boolean;
  attempts: number;
}

export interface ResolveStoryPlanOptions {
  sourceId?: string;
  roleMap?: RoleMap;
  signal?: AbortSignal;
  llmTimeoutMs?: number;
  maxSourceChars?: number;
  onProgress?: (event: StoryPlanProgressEvent) => void;
}

export async function resolveStoryPlanForImport(
  sourceText: string,
  options: ResolveStoryPlanOptions = {}
): Promise<ResolvedAuditedStory>;
```

Implement the exact two-attempt loop from the design: segment, try explicit plan, request Converter when absent/rejected, validate, hydrate, project, request mandatory Auditor, return only on pass with no major/critical issues. Both LLM calls use temperature 0, disabled thinking, required tool choice, and combined 60-second abort signal.

Default `maxSourceChars` to the single-request safe limit selected from the current 24,000-character configuration. Reject larger input before explicit parsing or model calls; do not invoke the old chunker.

- [ ] **Step 5: Implement progress and safe errors**

```typescript
export type StoryPlanProgressPhase =
  | 'source_segmentation' | 'explicit_parse' | 'conversion'
  | 'deterministic_validation' | 'table_projection'
  | 'semantic_audit' | 'complete' | 'failed';
```

Errors expose only public message, issue codes, unit IDs, and node IDs.

- [ ] **Step 6: Run GREEN and commit**

```bash
npm run test:unit -- --runInBand src/lib/story-plan/prompts.test.ts src/lib/story-plan/conversion.test.ts
git add src/lib/story-plan/prompts.ts src/lib/story-plan/prompts.test.ts src/lib/story-plan/conversion.ts src/lib/story-plan/conversion.test.ts
git commit -m "feat: convert and audit flat story plans"
```

---

### Task 7: Wire Modal and Agent Imports

**Files:**
- Modify: `src/lib/services/scriptConversionService.ts`
- Modify: `src/app/api/import-script/route.ts`
- Modify: `src/lib/agent/tools/import-script.ts`
- Modify: `src/lib/import-script-stream.ts`
- Modify: `src/lib/agent/tool-execution-stream.ts`
- Modify: `src/components/libraries/ImportScriptModal.tsx`
- Test: `src/lib/services/scriptConversionService.test.ts`
- Test: `tests/unit/api-import-script-route.test.ts`
- Test: `tests/unit/agent/import-script-story-ir.test.ts`
- Test: `tests/unit/import-script-progress.test.ts`

- [ ] **Step 1: Write failing integration tests**

Assert no import before audit success, audit failure produces zero writes, success imports one hydrated document, progress has phase/attempt and no chunks, and cancellation prevents writes.

- [ ] **Step 2: Run RED**

```bash
npm run test:unit -- --runInBand src/lib/services/scriptConversionService.test.ts tests/unit/api-import-script-route.test.ts tests/unit/agent/import-script-story-ir.test.ts tests/unit/import-script-progress.test.ts
```

- [ ] **Step 3: Replace facade and entry-point behavior**

```typescript
export {
  resolveStoryPlanForImport as resolveStoryForImport,
  ImportStoryPlanError,
} from '@/lib/story-plan/conversion';
```

Resolve/audit before compile/write progress, pass only `resolved.document`, preserve abort propagation, keep `maxDuration = 300`, remove chunk display, and keep neutral input copy.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm run test:unit -- --runInBand src/lib/services/scriptConversionService.test.ts tests/unit/api-import-script-route.test.ts tests/unit/agent/import-script-story-ir.test.ts tests/unit/import-script-progress.test.ts
git add src/lib/services/scriptConversionService.ts src/app/api/import-script/route.ts src/lib/agent/tools/import-script.ts src/lib/import-script-stream.ts src/lib/agent/tool-execution-stream.ts src/components/libraries/ImportScriptModal.tsx src/lib/services/scriptConversionService.test.ts tests/unit/api-import-script-route.test.ts tests/unit/agent/import-script-story-ir.test.ts tests/unit/import-script-progress.test.ts
git commit -m "refactor: route script imports through audited plans"
```

---

### Task 8: Deterministic End-to-End Tests and Real MiniMax Probes

**Files:**
- Add: `tests/fixtures/import-script/rainy-manor-story.txt`
- Create: `tests/unit/import-script-minimal-plan.integration.test.ts`
- Create: `scripts/probe-import-story-plan.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing end-to-end tests**

Nested fixture uses real segmenter/explicit parser and mocks only Auditor pass; compile and play all four paths; assert trust `2`, `0`, `4`, `0` and no sibling labels. Rainy fixture mocks a flat Converter plan and Auditor pass; compile/play east and west; assert only the matching ending appears.

- [ ] **Step 2: Run RED**

```bash
npm run test:unit -- --runInBand tests/unit/import-script-minimal-plan.integration.test.ts
```

- [ ] **Step 3: Implement no-database real-provider probe**

`scripts/probe-import-story-plan.ts` accepts a fixture path and `--runs=N`, calls the resolver sequentially, and prints only elapsed time, attempts, node count, audit verdict, labels, targets, and commands. It exits nonzero on any failure or missing Auditor pass and never prints source, prompts, keys, or raw provider output.

Add scripts:

```json
{
  "probe:import-story": "tsx scripts/probe-import-story-plan.ts",
  "probe:import-story:rainy-five": "tsx scripts/probe-import-story-plan.ts tests/fixtures/import-script/rainy-manor-story.txt --runs=5"
}
```

- [ ] **Step 4: Run GREEN and real acceptance**

```bash
npm run test:unit -- --runInBand tests/unit/import-script-minimal-plan.integration.test.ts
npm run probe:import-story -- tests/fixtures/import-script/nested-trust-story.txt
npm run probe:import-story:rainy-five
```

Expected: deterministic test PASS, nested audited success, rainy 5/5 audited successes. Do not add provider-shape normalizers to force a fixture through.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/import-script/rainy-manor-story.txt tests/unit/import-script-minimal-plan.integration.test.ts scripts/probe-import-story-plan.ts package.json
git commit -m "test: verify audited story plan imports"
```

---

### Task 9: Remove Old Provider Contract and Verify Everything

**Files:**
- Delete: `src/lib/story-ir/conversion.ts`
- Delete: `src/lib/story-ir/prompts.ts`
- Delete: `src/lib/story-ir/chunking.ts`
- Delete or rewrite: `src/lib/story-ir/conversion.test.ts`
- Delete or rewrite: `src/lib/story-ir/chunking.test.ts`
- Modify: old and new Story IR design status lines.

- [ ] **Step 1: Prove no production consumer remains**

```bash
rg -n "story-ir/(conversion|prompts|chunking)|canonicalizeStory(SourceRefs|Commands|OptionTexts)|normalizeStoryCollections" src tests
```

Expected: obsolete implementation/tests only. Migrate any production match first.

- [ ] **Step 2: Delete obsolete provider files and update docs**

Keep internal Story IR schema, command parser, source units if referenced, table compiler, and player. Mark old design superseded; mark new design implemented only after all gates pass.

- [ ] **Step 3: Run focused and full verification**

```bash
npm run test:unit -- --runInBand src/lib/story-plan tests/unit/import-script-minimal-plan.integration.test.ts src/lib/story-ir/tableCompiler.test.ts src/components/libraries/components/scriptPlayer.test.ts tests/unit/api-import-script-route.test.ts tests/unit/agent/import-script-story-ir.test.ts
npm run test:unit -- --runInBand
npm run type-check:web
npm run type-check:api
npm run lint
git diff --check
npm run build
```

Expected: tests/type checks/build PASS, ESLint has zero errors, and diff check is empty.

- [ ] **Step 4: Re-run the real provider gate**

```bash
npm run probe:import-story -- tests/fixtures/import-script/nested-trust-story.txt
npm run probe:import-story:rainy-five
```

Expected: nested audited success and rainy 5/5 audited successes.

- [ ] **Step 5: Commit cleanup**

```bash
git add -A src/lib/story-ir src/lib/story-plan docs/superpowers/specs
git commit -m "refactor: remove legacy story conversion contract"
```

---

## Completion Review

Map every acceptance criterion in `docs/superpowers/specs/2026-07-11-import-script-minimal-story-plan-design.md` to a deterministic test, route/agent integration test, real MiniMax probe, or existing compiler/player regression.

Mocked Converter tests are not evidence of MiniMax reliability. Release requires the real nested probe and five consecutive rainy-manor successes, each with mandatory Auditor pass.
