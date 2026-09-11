# GDD Async Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save a complete project GDD before derived tables, dialogue, and maps, then process each derived resource independently in the background.

**Architecture:** Keep the existing durable GDD generation job as the parent document job. Persist resource plans and create independent resource jobs after the document is committed; resource workers update their own status and never change a readable GDD back to failed. Preserve the existing inline behavior behind an explicit mode for compatibility.

**Tech Stack:** Next.js route handlers, TypeScript workers, Supabase/Postgres migrations and RPCs, Vitest.

**Spec:** User-approved chat design on 2026-09-11.

## Global Constraints

- A readable `output_document_id` is sufficient for parent GDD success.
- Resource failures must be isolated and independently retryable.
- Existing GDD and map artifact records remain readable.
- Map generation still requires its existing payment/confirmation policy.
- No manual `create_document` fallback is introduced.

### Task 1: Add resource-mode and durable resource-job schema

**Files:**
- Create: `supabase/migrations/20260911100000_gdd_async_resources.sql`
- Modify: `src/lib/services/gddGenerationService.ts`
- Test: `tests/unit/database/gdd-async-resources-migration.test.ts`

- [ ] Add `resource_mode` (`async` or `inline`) and `resource_plan` JSON columns to `gdd_generation_jobs`.
- [ ] Add `gdd_resource_jobs` with project/job/document ownership, resource kind, payload, status, attempts, lease, and error fields.
- [ ] Add guarded claim/heartbeat/retry/finish RPCs for resource jobs.
- [ ] Extend public DTOs with `resource_mode`, resource job summaries, and preserve old fields.
- [ ] Write migration-shape tests before implementation and run them red/green.

### Task 2: Persist GDD before derived-resource work

**Files:**
- Modify: `src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts`
- Modify: `src/lib/gdd-generation/worker.ts`
- Modify: `src/lib/services/gddGenerationService.ts`
- Test: `src/lib/gdd-generation/worker.test.ts`

- [ ] Accept `resourceMode` with default `async` for contract v2 and retain `inline` compatibility.
- [ ] Persist the document with resource plans recorded but no map compilation or derived-resource failure in the parent critical path.
- [ ] Mark the parent job `completed` immediately after document persistence.
- [ ] Enqueue table, dialogue, and map resource jobs only after a document ID exists.
- [ ] Ensure a map compiler failure cannot prevent the document write.
- [ ] Add tests proving parent completion is returned before resource processing.

### Task 3: Implement asynchronous resource worker and scheduling

**Files:**
- Create: `src/lib/gdd-generation/resources/worker.ts`
- Modify: `src/app/api/projects/[projectId]/gdd-generation-jobs/[id]/route.ts`
- Modify: `src/lib/services/gddGenerationService.ts`
- Test: `src/lib/gdd-generation/resources/worker.test.ts`

- [ ] Claim resource jobs with leases and process table/dialogue/map kinds independently.
- [ ] Reuse existing table materialization, dialogue materialization, and map artifact workers.
- [ ] Retry transient resource errors without retrying the parent GDD.
- [ ] Persist terminal resource errors with bounded diagnostics.
- [ ] Schedule one resource worker from job polling and allow later polling to resume expired leases.

### Task 4: Expose resource progress in the workspace

**Files:**
- Modify: `src/components/game-design-system/GameDesignSystemWorkspace.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.tsx`
- Test: `src/components/game-design-system/GameDesignSystemWorkspace.test.tsx`

- [ ] Render parent GDD status separately from table/dialogue/map statuses.
- [ ] Allow retry of a failed resource without resubmitting the GDD.
- [ ] Keep `completed_with_map_failures` readable and actionable.

### Task 5: Full verification

**Files:**
- Modify: `tests/unit/mcp/gds-tools.test.ts`
- Modify: `tests/e2e/specs/game-design-system.spec.ts`

- [ ] Verify API accepts async mode and returns resource summaries.
- [ ] Verify GDD read-back succeeds while resources are pending.
- [ ] Verify resource failure does not change parent status.
- [ ] Run focused unit/database tests, then the affected E2E suite.

