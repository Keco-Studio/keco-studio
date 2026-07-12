# Full Story IR Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Converter LLM create complete Story IR from arbitrary story prose while the server validates source traceability, commands, graph behavior, and Auditor approval.

**Architecture:** The LLM returns a strict version-3 extraction containing nodes, options, source unit IDs, and exact command sources. The server materializes canonical `StoryDocument` data from source units and parsed commands, performs deterministic validation, compiles the table, enumerates paths, and sends all evidence to an independent Auditor.

**Tech Stack:** TypeScript, Zod, Jest 30, MiniMax through `completeLlm`, existing Story IR compiler/player.

## Global Constraints

- Converter may create nodes, choices, IDs, branches, jumps, merges, and command ownership.
- Visible text and speakers must trace to declared source units without paraphrasing.
- Commands must be reconstructed from exact commands parsed from source.
- Every non-empty source unit must be assigned once to a node, option, or structural set.
- Database writes require deterministic validation and Auditor pass.
- Keep two candidate attempts, four total LLM calls, cancellation, timeout, player, compiler, and Excel behavior.
- Route old and natural formats through the same full extraction pipeline.

---

### Task 1: Full Extraction Schema And Materializer

**Files:**
- Create: `src/lib/story-extraction/schema.ts`
- Create: `src/lib/story-extraction/materializer.ts`
- Create: `src/lib/story-extraction/materializer.test.ts`

**Interfaces:**
- Produces: `StoryExtractionSchema`, `parseStoryExtraction(value)`, and `materializeStoryExtraction(extraction, source, roleMap?): StoryDocument`.
- Consumes: `SegmentedStorySource`, exact source unit IDs, and parsed source commands.

- [ ] **Step 1: Write failing materializer tests**

Define a version-3 extraction with arbitrary IDs and nested options. Assert exact `StoryDocument` speaker, content, source refs, targets, and canonical numeric commands. Add rejection tests for unknown/duplicate/omitted units, invented or paraphrased content, invalid speakers, changed commands, duplicated commands, wrong command owner, unresolved targets, unreachable nodes, branch fallthrough, and automatic cycles.

Representative contract:

```ts
const extraction = {
  version: 3,
  entryNodeId: 'start',
  structuralUnitIds: ['fixture:2'],
  nodes: [{
    id: 'start',
    type: 'dialogue',
    speaker: '七号',
    content: '我们必须选择一条路线。',
    sourceUnitIds: ['fixture:0'],
    commandSources: [],
    nextNodeId: '',
    choices: [{
      text: '前往能源舱',
      targetNodeId: 'energy',
      sourceUnitIds: ['fixture:1'],
      commandSources: ['$resolve+=1'],
    }],
  }],
};
```

- [ ] **Step 2: Run RED test**

Run `npm run test:unit -- src/lib/story-extraction/materializer.test.ts --runInBand`.

Expected: FAIL because the extraction modules do not exist.

- [ ] **Step 3: Implement strict Zod schemas**

Create strict schemas for:

```ts
type StoryExtraction = {
  version: 3;
  entryNodeId: string;
  structuralUnitIds: string[];
  nodes: Array<{
    id: string;
    type: 'dialogue' | 'narration' | 'scene' | 'system';
    speaker: string;
    content: string;
    sourceUnitIds: string[];
    commandSources: string[];
    nextNodeId: string;
    choices: Array<{
      text: string;
      targetNodeId: string;
      sourceUnitIds: string[];
      commandSources: string[];
    }>;
  }>;
};
```

Use the existing label pattern for node and target IDs. Require non-empty node `sourceUnitIds`; allow empty content only for `system` nodes.

- [ ] **Step 4: Implement deterministic materialization and validation**

Build maps for units, nodes, parsed commands, and visible unit ownership. Reject every invalid reference or duplicate. Normalize traceability with:

```ts
function normalizeEvidence(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\$[A-Za-z_]\w*\s*(?:\+=|-=|\*=|\/=|=)\s*-?(?:\d+\.?\d*|\.\d+)/g, '')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/, '')
    .replace(/[\s“”‘’"'「」『』【】()[\]（）:：,，。.!！?？;；]/g, '')
    .toLowerCase();
}
```

Require normalized speaker, content, and option text to be contained in their declared source text. Rebuild each command by exact whitespace-normalized match against `source.commands`, then use the source parser's variable, operator, value, and source ref. Convert unit IDs to full `SourceRef` values. Validate entry, targets, reachability, choice fallthrough, and automatic cycles before returning `StoryDocument`.

- [ ] **Step 5: Run GREEN tests and commit**

Run the Task 1 test; expect PASS.

Commit:

```bash
git add src/lib/story-extraction
git commit -m "feat: materialize complete story extractions"
```

### Task 2: Full Converter And Auditor Contracts

**Files:**
- Create: `src/lib/story-extraction/prompts.ts`
- Modify: `src/lib/story-plan/conversion.ts`
- Modify: `src/lib/story-plan/conversion.test.ts`
- Modify: `src/lib/story-plan/prompts.test.ts`

**Interfaces:**
- Consumes: source units and `materializeStoryExtraction`.
- Produces: one Converter tool returning version-3 extraction and one Auditor tool reviewing source, extraction, projection, table, and paths.

- [ ] **Step 1: Replace conversion tests with failing full-extraction expectations**

Require explicit and natural input to call Converter then Auditor. Mock a valid full extraction and assert `result.document`, `result.converted === true`, retry issue propagation, strict wrapper rejection, provider-abort retries, cancellation, timeout, and fail-closed behavior. Add a test where the Converter creates choices even though deterministic segmentation has zero `choice_text` segments.

- [ ] **Step 2: Run RED conversion tests**

Run `npm run test:unit -- src/lib/story-plan/conversion.test.ts src/lib/story-plan/prompts.test.ts --runInBand`.

Expected: FAIL because the current tool only accepts inventory relationship edges and explicit input bypasses Converter.

- [ ] **Step 3: Implement version-3 Converter prompt and tool**

The prompt must say:

```text
You are the semantic story extractor. Infer the complete playable graph from arbitrary prose.
Create nodes and choices even when the source has no labels or standard option syntax.
Copy visible speaker, content, and option text from source units without paraphrasing.
Assign every source unit exactly once to a node, option, or structuralUnitIds.
Use only exact command strings present in the declared source units.
```

The JSON tool schema mirrors `StoryExtractionSchema`, uses strict objects, requires every field, and allows arbitrary valid node IDs.

- [ ] **Step 4: Route every import through Converter and materializer**

Remove `tryLegacyStoryImport`, `tryParseExplicitStory`, `tryParseNaturalBranchStory`, inventory materialization, and relationship validation from the runtime conversion path. Each attempt calls Converter, parses the strict extraction, materializes it, compiles projection/table/path evidence, calls Auditor, and retries with deterministic or audit issues.

Keep existing timeout, abort, provider-abort budget, progress phases, and public error handling.

- [ ] **Step 5: Expand Auditor evidence**

Pass `sourceUnits`, parsed commands, extraction, `StoryDocument`, projection rows, compiled table, and enumerated paths. Require the Auditor to reject hidden visible content, missing options, wrong structure, wrong command ownership, and table mismatch.

- [ ] **Step 6: Run tests and commit**

Run the Task 2 tests plus `src/lib/story-extraction/materializer.test.ts`; expect PASS.

Commit:

```bash
git add src/lib/story-extraction src/lib/story-plan/conversion.ts src/lib/story-plan/conversion.test.ts src/lib/story-plan/prompts.test.ts
git commit -m "refactor: let llm create complete story ir"
```

### Task 3: Regression Integration

**Files:**
- Modify: `src/lib/story-plan/projection.ts`
- Modify: `src/lib/story-plan/projection.test.ts`
- Modify: `scripts/probe-import-story-plan.ts`
- Modify: affected import tests discovered by focused Jest.

**Interfaces:**
- Consumes: full extraction conversion result.
- Produces: diagnostic choice/path counts and unchanged compiled Library behavior.

- [ ] **Step 1: Add failing regression assertions**

Update probes to print choice count, path count, table columns, and non-empty option cells. Update fixture tests so mocked LLM responses provide full extractions and verify old explicit and rainy natural text both compile to fixed 17-column playable tables.

- [ ] **Step 2: Run focused story suites**

Run:

```bash
npm run test:unit -- src/lib/story-extraction src/lib/story-plan src/lib/story-ir src/lib/services/scriptImportService.test.ts src/components/libraries/components/scriptPlayer.test.ts --runInBand
```

Expected: initial failures identify every old relationship-plan assumption; update only those consumers to the new result shape, then rerun until PASS.

- [ ] **Step 3: Commit integration**

```bash
git add src/lib/story-extraction src/lib/story-plan scripts/probe-import-story-plan.ts src/lib/services/scriptImportService.test.ts src/components/libraries/components/scriptPlayer.test.ts
git commit -m "test: cover complete llm story extraction"
```

### Task 4: Live Random Story Verification And Completion

**Files:**
- Create temporary generated stories under `/tmp`; do not commit them.
- Modify production code only after a reproduced failing test identifies a root cause.

**Interfaces:**
- Consumes: live MiniMax Converter/Auditor pipeline.
- Produces: evidence for arbitrary natural-language branch recognition and playback.

- [ ] **Step 1: Test the orbital-station story that currently fails**

Require four enumerated paths with `resolve` values `2`, `0`, `4`, and `0`; require nested `OptionN` cells and Auditor pass. A linearized pass is a failure.

- [ ] **Step 2: Generate at least two additional random stories**

Use different formatting: one prose-only story with inline choices and one Markdown/dialogue story with three top-level choices. Require expected choice counts, terminal paths, no leakage, command fidelity, and valid 17-column or minimally extended tables.

- [ ] **Step 3: Debug and fix every reproduced failure with TDD**

For each failure, capture source, extraction/error, deterministic issue, and Auditor result. Add the smallest failing automated test before changing prompts, schemas, or materialization. Rerun the exact live story after the focused test passes.

- [ ] **Step 4: Run full verification**

Run independently:

```bash
npm run test:unit -- --runInBand
npm run typecheck
npm run typecheck:api
npm run lint
npm run build
git diff --check
```

Expected: all tests pass, TypeScript passes, ESLint has zero errors, build succeeds, and diff check is empty.

- [ ] **Step 5: Print final evidence and commit fixes**

Print each generated source summary, Converter attempts, Auditor verdict, node/choice/path counts, variable outcomes, and compiled non-empty table cells. Commit any final tested fixes with a scoped message.
