# GDD Generation Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover expired GDD jobs during project polling and surface actionable generation errors without MDX failures from numeric comparisons.

**Architecture:** Keep wake eligibility and error formatting as pure worker helpers. The authorized polling route reads the internal job through the service client, returns only `toPublicGddGenerationJob`, and schedules the existing worker when the lease is reclaimable. Markdown normalization happens at the generation boundary before persistence validation.

**Tech Stack:** Next.js route handlers, TypeScript, Jest, Supabase/PostgreSQL job leases, sanctioned MDX.

---

### Task 1: Reproduce Recovery And Error Failures

**Files:**
- Modify: `src/lib/gdd-generation/worker.test.ts`
- Modify: `tests/unit/gdd-generation-routes.test.ts`
- Modify: `src/lib/gdd-generation/v2/generator.test.ts`

- [ ] Add tests for queued/expired/live/terminal wake decisions.
- [ ] Add a polling-route test for an expired running job.
- [ ] Add a structured non-`Error` failure test.
- [ ] Add a numeric less-than MDX normalization test.
- [ ] Run the three suites and confirm the new assertions fail for the missing behavior.

### Task 2: Implement Recovery And Safe Output

**Files:**
- Modify: `src/lib/gdd-generation/worker.ts`
- Modify: `src/app/api/projects/[projectId]/gdd-generation-jobs/[id]/route.ts`
- Modify: `src/lib/gdd-generation/v2/generator.ts`

- [ ] Add `shouldWakeGddGenerationJob` and `describeGddGenerationError`.
- [ ] Read internal jobs through the authorized service-role boundary, convert to the public DTO, and wake claimable jobs.
- [ ] Escape raw numeric less-than expressions outside inline/fenced code before returning generated Markdown.
- [ ] Run the focused suites and confirm they pass.

### Task 3: Verify And Recover Production Job

**Files:**
- Verify all modified GDD generation files.

- [ ] Run focused Jest suites.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run focused ESLint and `git diff --check`.
- [ ] Requeue the confirmed expired production job without altering completed outputs.
- [ ] Query the job again and confirm it is queued or running under a fresh lease.

