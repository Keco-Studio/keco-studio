# Streaming GDD Dialogue Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start up to three dialogue planners as concrete dialogue scenes arrive in the GDD text stream, then atomically persist the completed GDD and validated dialogue resources.

**Architecture:** Add a bounded incremental parser for hidden scene events and a focused single-scene planner. Refactor the v2 GDD generator to consume `streamLlm`, dispatch scene planners through a three-slot pool without pausing the GDD stream, and await them before returning. Pass a worker-owned abort signal into generation so stream failure, lease loss, and cancellation stop in-flight planner calls before persistence.

**Tech Stack:** TypeScript, Zod, OpenAI-compatible streaming completions, Jest, existing GDD persistence and dialogue worker services.

---

## File Map

- Create `src/lib/gdd-generation/v2/dialogueSceneStream.ts`: scene event schema and chunk-safe hidden-marker parser.
- Create `src/lib/gdd-generation/v2/dialogueSceneStream.test.ts`: split-marker, visible Markdown, malformed marker, and duplicate-key tests.
- Create `src/lib/gdd-generation/v2/dialoguePlanner.ts`: one-scene prompt, strict response parsing, and one repair pass.
- Create `src/lib/gdd-generation/v2/dialoguePlanner.test.ts`: input isolation and repair behavior tests.
- Modify `src/lib/gdd-generation/v2/generator.ts`: stream GDD text, dispatch planners with concurrency three, normalize final Markdown, and expose runtime abort support.
- Modify `src/lib/gdd-generation/v2/generator.test.ts`: streaming trigger timing, concurrency, no-event, table coexistence, and abort tests.
- Modify `src/lib/gdd-generation/worker.ts`: create/abort a generation controller when heartbeat or generation fails.
- Modify `src/lib/gdd-generation/worker.test.ts`: prove abort propagation and no persistence after generation failure.
- Create `supabase/migrations/20260820125000_add_gdd_dialogue_to_script_workspace.sql`: add and backfill generated Dialogue Document membership in the Script workspace.
- Create `tests/unit/database/gdd-dialogue-script-workspace-migration.test.ts`: lock the Script tree persistence contract.

### Task 1: Incremental Scene Event Parser

**Files:**
- Create: `src/lib/gdd-generation/v2/dialogueSceneStream.ts`
- Test: `src/lib/gdd-generation/v2/dialogueSceneStream.test.ts`

- [ ] **Step 1: Write failing parser tests**

Cover a marker split over several chunks, ordinary visible Markdown, two unique
events, a duplicate `chapterKey`, malformed JSON, and an unterminated marker:

```ts
const parser = new DialogueSceneStreamParser();
expect(parser.push('## Arrival\nThe guide blocks the gate.\n<!-- KECO_DIAL')).toEqual({
  markdown: '## Arrival\nThe guide blocks the gate.\n', events: [],
});
expect(parser.push('OGUE_SCENE {"chapterKey":"arrival","title":"Arrival",')).toEqual({ markdown: '', events: [] });
expect(parser.push('"scene":"The guide asks for proof.","participants":["Guide","Hero"],"choices":[],"consequences":"The gate opens."} -->')).toEqual({
  markdown: '',
  events: [expect.objectContaining({ chapterKey: 'arrival', title: 'Arrival' })],
});
expect(parser.finish()).toBe('');
```

- [ ] **Step 2: Run the parser test and verify RED**

Run: `npx jest --runInBand src/lib/gdd-generation/v2/dialogueSceneStream.test.ts`

Expected: FAIL because `DialogueSceneStreamParser` and the event schema do not exist.

- [ ] **Step 3: Implement the bounded parser**

Define a strict Zod schema and a parser that retains only a possible marker
prefix or an open marker between calls:

```ts
export const dialogueSceneEventSchema = z.object({
  chapterKey: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  scene: z.string().trim().min(1).max(12_000),
  participants: z.array(z.string().trim().min(1).max(160)).max(30),
  choices: z.array(z.string().trim().min(1).max(300)).max(50),
  consequences: z.string().trim().max(4_000),
}).strict();

export class DialogueSceneStreamParser {
  push(chunk: string): { markdown: string; events: DialogueSceneEvent[] };
  finish(): string;
}
```

Reject malformed, duplicate, or unterminated markers with
`GddDialogueSceneValidationError`. Strip complete markers from returned
Markdown and cap an open marker at 20,000 characters.

- [ ] **Step 4: Run parser tests and verify GREEN**

Run: `npx jest --runInBand src/lib/gdd-generation/v2/dialogueSceneStream.test.ts`

Expected: PASS.

### Task 2: Isolated Single-Scene Planner

**Files:**
- Create: `src/lib/gdd-generation/v2/dialoguePlanner.ts`
- Test: `src/lib/gdd-generation/v2/dialoguePlanner.test.ts`

- [ ] **Step 1: Write failing planner tests**

Assert that the prompt contains only `gddContext` and the event, produces one
valid `DialoguePlan`, repairs invalid JSON once, and rejects a second invalid
response:

```ts
const complete = jest.fn(async () => JSON.stringify({
  chapterKey: 'arrival', title: 'Arrival', content: 'Guide: Stop.',
  hasChoices: false, branchSummary: [],
}));
const plan = await planDialogueScene({
  event, gddContext: '# GDD\n\n## Arrival\nThe guide blocks the gate.',
}, { complete });
expect(plan.chapterKey).toBe('arrival');
expect(JSON.stringify(complete.mock.calls[0])).not.toContain('creativeBrief');
```

- [ ] **Step 2: Run planner tests and verify RED**

Run: `npx jest --runInBand src/lib/gdd-generation/v2/dialoguePlanner.test.ts`

Expected: FAIL because `planDialogueScene` does not exist.

- [ ] **Step 3: Implement prompt, parse, and repair**

Use `completeLlm` with `gddV2LlmOptions`, JSON-only instructions, and the
existing `dialoguePlanSchema`:

```ts
export async function planDialogueScene(
  input: { event: DialogueSceneEvent; gddContext: string },
  dependencies: { complete?: Completion } = {},
  runtime: { signal?: AbortSignal } = {},
): Promise<DialoguePlan>;
```

The first prompt writes the complete importable script for exactly one event.
The repair prompt includes the validation error, bounded invalid output, the
same event, and the same GDD context. Throw
`GddDialoguePlanningValidationError` after the second invalid response.

- [ ] **Step 4: Run planner tests and verify GREEN**

Run: `npx jest --runInBand src/lib/gdd-generation/v2/dialoguePlanner.test.ts`

Expected: PASS.

### Task 3: Stream GDD and Dispatch Three Planner Tasks

**Files:**
- Modify: `src/lib/gdd-generation/v2/generator.ts`
- Modify: `src/lib/gdd-generation/v2/generator.test.ts`

- [ ] **Step 1: Write failing streaming orchestration tests**

Inject an async text stream and a controllable planner. Prove the first planner
starts before the stream requests its next chunk:

```ts
async function* gddStream() {
  yield text('# GDD\n## Arrival\nConcrete scene.\n<!-- KECO_DIALOGUE_SCENE {...} -->');
  expect(planScene).toHaveBeenCalledTimes(1);
  yield text('\n## Systems\nThe remaining GDD.');
  yield finish('stop');
}
```

Add tests for no marker, four markers with maximum active count three, table
marker coexistence, split markers, duplicate keys, `length` recovery, and an
aborted signal rejecting before planner completion.

- [ ] **Step 2: Run generator tests and verify RED**

Run: `npx jest --runInBand src/lib/gdd-generation/v2/generator.test.ts`

Expected: FAIL because generation still waits for `completeLlm` and has no planner pool.

- [ ] **Step 3: Refactor generation dependencies and stream consumption**

Change the generator boundary to explicit dependencies while retaining defaults:

```ts
type GddV2GeneratorDependencies = {
  stream?: typeof streamLlm;
  complete?: Completion;
  planScene?: typeof planDialogueScene;
};

export async function generateGddMarkdownV2(
  input: GddGenerationRequestV2,
  dependencies: GddV2GeneratorDependencies = {},
  runtime: { signal?: AbortSignal } = {},
): Promise<GeneratedGddV2>;
```

Consume `text_delta` and `finish` chunks directly. Feed text through
`DialogueSceneStreamParser`, append only visible Markdown, and submit each event
with the visible GDD accumulated at that point.

- [ ] **Step 4: Implement the three-slot task pool**

Keep the pool private to `generator.ts` and preserve encounter-order results:

```ts
const pool = createAsyncPool(3);
const plans = events.map((event, index) => pool.run(async () => ({
  index,
  plan: await planScene({ event, gddContext }, { complete }, { signal }),
})));
const dialoguePlans = (await Promise.all(plans))
  .sort((a, b) => a.index - b.index)
  .map((item) => item.plan);
```

The pool starts work immediately when a marker completes and never awaits a
planner from inside the GDD stream loop. Await the collected promises only after
the stream and parser finish. On any stream/parser error, abort the local child
controller and await `Promise.allSettled` before rethrowing.

- [ ] **Step 5: Replace the old dialogue-plan prompt contract**

Remove the instruction to append one final `KECO_DIALOGUE_PLAN`. Add the exact
`KECO_DIALOGUE_SCENE` shape, concrete-scene eligibility rules, immediate marker
placement, and explicit prohibitions for abstract features and illustrative
examples. Keep `KECO_TABLE_PLAN` unchanged.

- [ ] **Step 6: Run generator tests and verify GREEN**

Run: `npx jest --runInBand src/lib/gdd-generation/v2/generator.test.ts src/lib/gdd-generation/v2/dialogueSceneStream.test.ts src/lib/gdd-generation/v2/dialoguePlanner.test.ts`

Expected: PASS with observed maximum planner concurrency of three.

### Task 4: Propagate Worker Cancellation and Lease Loss

**Files:**
- Modify: `src/lib/gdd-generation/worker.ts`
- Modify: `src/lib/gdd-generation/worker.test.ts`

- [ ] **Step 1: Write failing worker abort tests**

Use a `generateV2` fake that captures `runtime.signal` and waits. Reject the
heartbeat, then assert the signal aborts and persistence is never called:

```ts
const generateV2 = jest.fn(async (_input, _deps, runtime) => {
  await new Promise((resolve, reject) => runtime.signal?.addEventListener('abort', () => reject(runtime.signal?.reason)));
  throw new Error('unreachable');
});
expect(persistV2).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run worker test and verify RED**

Run: `npx jest --runInBand src/lib/gdd-generation/worker.test.ts`

Expected: FAIL because `runWithLeaseHeartbeat` does not create or pass an abort signal.

- [ ] **Step 3: Add worker-owned abort controller**

Update `runWithLeaseHeartbeat` to create a controller linked to any parent
signal, abort it when heartbeat fails, and pass its signal into the generation
callback:

```ts
async function runWithLeaseHeartbeat<T>(
  input: WorkerInput,
  heartbeat: typeof heartbeatGddGenerationJob,
  generate: (signal: AbortSignal) => Promise<T>,
): Promise<T>;
```

Call v2 generation as
`dependencies.generateV2(job.input, undefined, { signal })`. Preserve existing
retry/permanent-failure classification. The persistence RPC's lease check
remains the final cancellation guard.

- [ ] **Step 4: Run worker and generator tests and verify GREEN**

Run: `npx jest --runInBand src/lib/gdd-generation/worker.test.ts src/lib/gdd-generation/v2/generator.test.ts`

Expected: PASS; aborted generation never reaches `persistV2`.

### Task 5: Verification and Documentation Consistency

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-gdd-derived-dialogue-planning-design.md` only if implementation reveals a contract correction.

- [ ] **Step 1: Run all focused dialogue and GDD tests**

Run: `npx jest --runInBand src/lib/gdd-generation/v2/dialogueSceneStream.test.ts src/lib/gdd-generation/v2/dialoguePlanner.test.ts src/lib/gdd-generation/v2/generator.test.ts src/lib/gdd-generation/dialogueResources.test.ts src/lib/gdd-generation/worker.test.ts src/lib/gdd-generation/dialogueWorker.test.ts src/lib/services/gddGenerationService.test.ts tests/unit/database/gdd-dialogue-script-workspace-migration.test.ts`

Expected: PASS.

- [ ] **Step 2: Run static verification**

Run: `npm run typecheck`

Expected: exit 0.

Run: `npx eslint src/lib/gdd-generation/v2/dialogueSceneStream.ts src/lib/gdd-generation/v2/dialogueSceneStream.test.ts src/lib/gdd-generation/v2/dialoguePlanner.ts src/lib/gdd-generation/v2/dialoguePlanner.test.ts src/lib/gdd-generation/v2/generator.ts src/lib/gdd-generation/v2/generator.test.ts src/lib/gdd-generation/worker.ts src/lib/gdd-generation/worker.test.ts`

Expected: exit 0.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 3: Inspect final diff for scope and isolation**

Confirm the scene planner receives no `creativeBrief`, Game Design System
creation description, raw project sources, or keyword detector; confirm no
database migration or Script worker behavior changed.
