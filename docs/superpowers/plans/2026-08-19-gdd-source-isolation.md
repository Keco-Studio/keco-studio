# GDD Source Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent automatically gathered project sources from reusing previously generated GDD documents or tables in later GDD generation jobs.

**Architecture:** Add an opt-in filter to the existing source-listing service. The GDD route enables it, while the general Game Design System reference picker keeps its current behavior. The filter uses the existing `gdd_generation_job_id` provenance columns created by the GDD migrations.

**Tech Stack:** Next.js route handlers, Supabase query builders, TypeScript, Jest.

---

### Task 1: Lock the source-filter behavior with tests

**Files:**
- Modify: `src/lib/game-design-system/sourceSnapshots.test.ts`
- Modify: `tests/unit/gdd-generation-routes.test.ts`

- [x] **Step 1: Add a source-listing test that expects generated-resource filters.**

  Build two thenable Supabase query mocks returning ordinary rows. Call
  `listGameDesignReferenceOptions(client, 'project-1', { excludeGeneratedResources: true })` and assert that both the documents and libraries builders receive `.is('gdd_generation_job_id', null)`.

- [x] **Step 2: Run the focused source-listing test before implementation.**

  Run: `npx jest src/lib/game-design-system/sourceSnapshots.test.ts --runInBand`

  Expected: FAIL because the function does not yet accept the option or apply the `.is` filters.

- [x] **Step 3: Extend the route test to assert the opt-in filter.**

  In the existing successful POST test, assert
  `listGameDesignReferenceOptions` was called with the Supabase client, the
  project ID, and `{ excludeGeneratedResources: true }`.

- [x] **Step 4: Run the focused route test before implementation.**

  Run: `npx jest tests/unit/gdd-generation-routes.test.ts --runInBand`

  Expected: FAIL because the route currently calls the source lister with only two arguments.

### Task 2: Implement the opt-in filtering

**Files:**
- Modify: `src/lib/game-design-system/sourceSnapshots.ts:122-143`
- Modify: `src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts:46-47`

- [x] **Step 1: Add the optional source-listing parameter.**

  Give `listGameDesignReferenceOptions` a third parameter with
  `excludeGeneratedResources?: boolean`, defaulting to `false`. Build the
  existing documents and libraries queries, then conditionally append
  `.is('gdd_generation_job_id', null)` to each query before awaiting them.

- [x] **Step 2: Enable the filter only for GDD automatic sources.**

  Change `automaticProjectSources` to call
  `listGameDesignReferenceOptions(supabase, projectId, { excludeGeneratedResources: true })`.

- [x] **Step 3: Run the focused tests and confirm green.**

  Run: `npx jest src/lib/game-design-system/sourceSnapshots.test.ts tests/unit/gdd-generation-routes.test.ts --runInBand`

  Expected: all tests pass, including the new generated-resource regression coverage.

### Task 3: Verify the complete change

**Files:**
- Review: `src/lib/game-design-system/sourceSnapshots.ts`
- Review: `src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts`

- [x] **Step 1: Run TypeScript checks.**

  Run: `npx tsc --noEmit`

  Expected: exit code 0.

- [x] **Step 2: Run the focused GDD test suite.**

  Run: `npx jest src/lib/gdd-generation src/lib/gddGeneration.test.ts src/lib/game-design-system/sourceSnapshots.test.ts tests/unit/gdd-generation-routes.test.ts --runInBand`

  Expected: all selected suites pass.

- [x] **Step 3: Review the diff for scope.**

  Run: `git diff -- src/lib/game-design-system/sourceSnapshots.ts src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts src/lib/game-design-system/sourceSnapshots.test.ts tests/unit/gdd-generation-routes.test.ts`

  Confirm the change only adds the opt-in generated-resource filter and its tests; no historical documents are modified.
