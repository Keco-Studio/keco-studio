# Isolated GDD and Map Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Generate GDD + maps` create a new GDD from only the pinned Game Design System version and current Creative brief, then generate maps from only that new GDD and its pinned Art Style.

**Architecture:** Remove automatic project Document/Table collection at the project GDD generation request boundary and persist an empty project-source snapshot. Keep the existing GDD worker, Agent-driven map compiler, Create Map image worker, idempotency, refresh recovery, and document map-reference rendering unchanged.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.9, Zod 3, Supabase, Jest 30, Playwright 1.57.

## Global Constraints

- Work on the current `MapInsertGdd` branch; do not create another worktree.
- Implement before adding tests, per the user's explicit no-TDD instruction.
- Do not read any existing project Document or Table in `Generate GDD + maps`.
- Persist `input.projectSources` and `source_snapshots` as empty arrays for new jobs.
- Map compilation may read only the completed new GDD Markdown and pinned GDS Art Style.
- Keep map output image-only; do not generate collision grids, TileMaps, or navigation data.
- Preserve historical jobs and existing project resources.
- Do not modify `next-env.d.ts` or `.superpowers/`.

---

### Task 1: Isolate the GDD request boundary

**Files:**
- Modify: `src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts`

**Interfaces:**
- Consumes: the selected GDS detail/version, current request `creativeBrief`, project identity, and existing `GddGenerationRequestV2` contract.
- Produces: a `GddGenerationRequestV2` whose `projectSources` is always `[]`; `createGddGenerationJob` persists that same array through its existing `p_source_snapshots` argument.

- [x] **Step 1: Remove the implicit project-source collector**

Delete the `sourceSnapshots` imports and the local `automaticProjectSources` function from the route. Do not replace them with another query or resolver.

- [x] **Step 2: Construct an isolated request**

Remove `const projectSources = await automaticProjectSources(...)` and set the V2 request field directly:

```ts
const input: GddGenerationRequestV2 = {
  // existing pinned GDS, project, language, mode, and Creative brief fields
  projectSources: [],
};
```

- [x] **Step 3: Review the route data flow**

Confirm the POST path queries only project authorization, the project-to-GDS binding, the pinned GDS version, and the project name before calling `createGddGenerationJob`. Confirm map scheduling remains untouched.

### Task 2: Add focused regression coverage after implementation

**Files:**
- Modify: `tests/unit/gdd-generation-routes.test.ts`
- Verify: `src/lib/gdd-generation/v2/generator.test.ts`
- Verify: `src/lib/gdd-generation/maps/compiler.test.ts`
- Verify: `src/lib/gdd-generation/maps/worker.test.ts`

**Interfaces:**
- Consumes: the POST route and the existing mocked `createGddGenerationJob` service boundary.
- Produces: regression assertions that the route neither imports/calls source enumeration nor passes historical snapshots into the durable job.

- [x] **Step 1: Remove obsolete source collector mocks**

Delete `listGameDesignReferenceOptions` and the `@/lib/game-design-system/sourceSnapshots` Jest mock. The route must load and execute without that module.

- [x] **Step 2: Assert the durable input is isolated**

Extend the successful POST test to capture the second `createGddGenerationJob` argument and assert:

```ts
expect(createGddGenerationJob).toHaveBeenCalledWith(
  { service: true },
  expect.objectContaining({
    input: expect.objectContaining({
      creativeBrief: '请生成包含地图描述的新 GDD',
      projectSources: [],
    }),
  }),
);
expect(createGddGenerationJob.mock.calls[0][1].input.projectSources).toEqual([]);
```

Use the Creative brief in the POST request body so the assertion also proves the visible current input is preserved.

- [x] **Step 3: Verify persistence delegation**

Run the existing service test that asserts `createGddGenerationJob` passes `input.projectSources` to `p_source_snapshots`; with the route regression above this proves new jobs persist `source_snapshots: []` without duplicating service logic.

- [x] **Step 4: Verify the prompt boundary**

Run the existing generator test for an empty `projectSources` input and assert its generated prompt contains exactly the no-source statement:

```ts
expect(messages[1].content).toContain('No project Documents or Tables are available.');
```

Add this assertion to the nearest existing message-building test if it is not already explicit.

- [x] **Step 5: Run focused automated checks**

```bash
npx jest --runInBand tests/unit/gdd-generation-routes.test.ts src/lib/services/gddGenerationService.test.ts src/lib/gdd-generation/v2/generator.test.ts src/lib/gdd-generation/maps/compiler.test.ts src/lib/gdd-generation/maps/worker.test.ts
npm run typecheck
npm run typecheck:api
npx eslint 'src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts' tests/unit/gdd-generation-routes.test.ts src/lib/gdd-generation/v2/generator.test.ts
git diff --check
```

Expected: all focused Jest suites, both TypeScript checks, ESLint, and whitespace validation pass.

### Task 3: Verify the real browser and durable data path

**Files:**
- No product file changes expected.
- Retain generated GDD/map data in project `fbbfc0c3-07a2-4906-b8f6-6d0624910794`.

**Interfaces:**
- Consumes: the running app at `http://localhost:3000`, local Supabase, the current `hetu@qq.com` account, the bound GDS/version, and a new generic Creative brief.
- Produces: browser-visible and database evidence that the generated GDD/map do not inherit the old distinctive location `十字镇`.

- [x] **Step 1: Check local services**

Verify port 3000, local Supabase, and required Edge Functions are responsive. Start only missing services, using a different port only if port 3000 is occupied by an unrelated process.

- [x] **Step 2: Generate through the real UI**

Sign in with the supplied current account, open the existing `test` project, and submit a new Creative brief that requests a GDD with one map description but does not mention `十字镇`, for example:

```text
请生成一份全新的游戏设计文档，并在文档中包含一处适合核心玩法的基础地图描述。
```

Click `Generate GDD + maps` once and wait by polling the visible job status rather than using a fixed sleep.

- [x] **Step 3: Inspect the new GDD and map**

Open the generated document and verify it contains a newly generated map description and a rendered map reference/image. Confirm neither the new GDD nor the generated map metadata/image prompt reuses `十字镇` unless that name is independently present in the pinned GDS.

- [x] **Step 4: Inspect durable job evidence**

Query the newly created `gdd_generation_jobs` row with the local service role and verify:

```ts
job.input.projectSources === []
job.source_snapshots === []
```

Trace the completed map artifact back to the new output document and confirm collision generation remains disabled.

- [x] **Step 5: Review the final diff**

Check the changed files against the approved specification, confirm no unrelated behavior or user-owned files changed, and report the generated document/job identifiers so the retained test data is easy to inspect.
