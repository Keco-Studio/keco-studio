# GDD Map Generation Reliability Implementation Plan

> **For agentic workers:** Execute inline in the current branch. Do not use subagents, a worktree, or TDD for this task.

**Goal:** Prevent duplicate paid GDD/map jobs across refreshes, keep progress live through map generation, and avoid treating incidental map UI text as a map description.

**Architecture:** Put the final active-job exclusion in PostgreSQL so concurrent tabs and refreshed clients cannot bypass it. Return the already-active job to the caller for the same generation input, let the UI recover that job, and disable generation until initial job discovery finishes. Keep deterministic map-signal filtering ahead of LLM extraction and persist bounded compiler diagnostics with the generated document metadata.

**Tech Stack:** Next.js App Router, React Query, TypeScript, Supabase/PostgreSQL, Jest, Playwright.

## Global Constraints

- Work on the current `MapInsertGdd` branch.
- Do not use TDD; add regression coverage after implementation.
- Generate map images only; do not add collision-grid generation.
- Preserve GDD availability when map extraction or map generation fails.
- Do not modify or commit the existing `.superpowers/` directory.

---

### Task 1: Active Job Exclusion

**Files:**
- Create: `supabase/migrations/20260819140000_gdd_active_job_guard.sql`
- Modify: `src/lib/services/gddGenerationService.ts`
- Modify: `src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts`
- Test: `src/lib/services/gddGenerationService.test.ts`
- Test: `tests/unit/gdd-generation-routes.test.ts`

**Interfaces:**
- Produce `GddActiveJobConflictError` carrying the existing public job.
- Preserve idempotent replay when `input_hash` matches the active job.
- Reject a different active payload without inserting another job.

- [x] Add a service-role RPC that takes a transaction-scoped project advisory lock, returns an equivalent active job, rejects a different active payload, or inserts one queued job.
- [x] Route all job creation through the RPC and map active conflicts to HTTP `409` with the existing public job.
- [x] Update the client to recover the returned active job instead of presenting a generic failure.
- [x] Add post-implementation service and route regression tests.

### Task 2: Frontend Recovery And Polling

**Files:**
- Modify: `src/components/game-design-system/GameDesignSystemWorkspace.tsx`
- Test: `src/components/game-design-system/GameDesignSystemsPage.test.tsx`

**Interfaces:**
- Consume the latest-job discovery loading state per project.
- Treat `queued`, `running`, and `waiting_for_maps` as pollable active states.

- [x] Disable generation until the initial latest-job request has settled.
- [x] Continue polling `waiting_for_maps` jobs and refresh document queries at both successful terminal statuses.
- [x] Add post-implementation UI regression tests for the loading gate and map-stage polling.

### Task 3: Explicit Map Detection And Diagnostics

**Files:**
- Modify: `src/lib/gdd-generation/maps/compiler.ts`
- Modify: `src/lib/gdd-generation/worker.ts`
- Test: `src/lib/gdd-generation/maps/compiler.test.ts`
- Test: `src/lib/gdd-generation/worker.test.ts`

**Interfaces:**
- Produce `hasExplicitGddMapSignal(markdown: string): boolean`.
- Store `mapCompilationError` as a bounded metadata string when extraction fails.

- [x] Require a map-oriented heading or an explicit spatial-map phrase; reject incidental UI phrases such as `map UI update`.
- [x] Keep byte-for-byte unchanged GDD Markdown and zero child artifacts when no explicit map signal exists.
- [x] Persist a bounded compiler error in GDD generation metadata while keeping the document usable.
- [x] Add post-implementation regression tests for the observed false-positive GDD content.

### Task 4: Verification

**Files:**
- Modify only if verification exposes a scoped defect.

- [x] Apply the new local migration without resetting data.
- [x] Run focused Jest, TypeScript, API TypeScript, lint, and diff checks.
- [x] Use a real browser session against `http://localhost:3000` to submit generation, refresh during activity, and attempt a repeat action.
- [x] Verify in PostgreSQL that only one active job exists and that incidental map UI text creates zero map artifacts without a partial-failure status.
- [x] Commit only task files and leave `.superpowers/` untracked.
