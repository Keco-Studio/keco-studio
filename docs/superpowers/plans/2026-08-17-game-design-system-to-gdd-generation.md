# Game Design System to GDD Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a reviewable project GDD Document from a pinned Game Design System version without requiring an uploaded GDD or a manually entered project brief.

**Architecture:** Add a small structured GDD generation core, a durable project-scoped job with a leased worker, and a project binding action that starts the job. The worker resolves authorized project context, asks the existing LLM client for bounded JSON, validates and deterministically renders Markdown, then creates a new project Document and stores rule/source evidence. Existing Game Design System version semantics and the design-upload-to-tables flow remain unchanged.

**Tech Stack:** Next.js API routes, Supabase/Postgres migrations and RLS, Zod, existing `completeLlm`, `documentService`, `documentStateGateway`, React Query, Jest/React Testing Library.

---

## File Map

- Create `src/lib/gddGeneration.ts`: GDD schema, prompt construction, Markdown renderer, input hashing.
- Create `src/lib/gdd-generation/worker.ts`: lease-aware generation, validation, document creation, job transitions.
- Create `src/lib/services/gddGenerationService.ts`: typed job reads/writes and worker RPC wrappers.
- Create `src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts`: authorize a target project and enqueue a job.
- Create `src/app/api/projects/[projectId]/gdd-generation-jobs/[id]/route.ts`: owner/editor status polling.
- Create `supabase/migrations/20260817140000_gdd_generation_jobs.sql`: durable jobs, source snapshot/evidence columns, RLS, claim/heartbeat/retry RPCs.
- Modify `src/app/api/internal/game-design-system-worker/route.ts`: process both existing Game Design System jobs and GDD jobs without weakening the cron secret boundary.
- Modify `src/components/game-design-system/GameDesignSystemWorkspace.tsx`: expose `Generate GDD Draft` for authorized project rows and poll the new job until a Document is created.
- Modify `src/lib/services/gameDesignSystemClient.ts`: client helpers for starting and polling GDD jobs.
- Add focused tests beside the core, service, route, worker, and workspace code.

## Task 1: Define the structured GDD contract

**Files:**
- Create `src/lib/gddGeneration.ts`
- Create `src/lib/gddGeneration.test.ts`

- [ ] **Step 1: Write failing tests** for parsing a complete GDD payload, rejecting missing/oversized fields, rejecting rule IDs not in the injected policy, deterministic Markdown headings, assumptions output, and stable input hashes.
- [ ] **Step 2: Run the focused test** with `npx jest src/lib/gddGeneration.test.ts --runInBand` and confirm the module is missing.
- [ ] **Step 3: Implement the bounded Zod schema** with title, overview, design intent, player fantasy, core loop, decision structure, gameplay systems, content model, progression/economy, difficulty/balance, narrative/world, experience/presentation, table plans, assumptions, applied rule IDs, and optional omitted rule IDs.
- [ ] **Step 4: Implement `buildGddGenerationMessages`** so the system prompt requires JSON only, treats the pinned Game Design System as untrusted design policy, separates project evidence/system guidance/AI proposals/assumptions, and forbids claiming invented facts as verified.
- [ ] **Step 5: Implement `renderGddMarkdown`** with deterministic section order and an `Assumptions to Confirm` section; include compact generation provenance without injecting raw source content into the policy block.
- [ ] **Step 6: Run the focused test** and confirm all contract and renderer tests pass.

## Task 2: Add durable GDD generation persistence

**Files:**
- Create `supabase/migrations/20260817140000_gdd_generation_jobs.sql`
- Create `src/lib/services/gddGenerationService.ts`
- Create `src/lib/services/gddGenerationService.test.ts`

- [ ] **Step 1: Write failing service tests** for owner/editor enqueue authorization, idempotency, job status visibility, and service-only claim/heartbeat/retry transitions.
- [ ] **Step 2: Add `gdd_generation_jobs`** with owner, project, system/version IDs, status, phase, normalized input, source snapshots, policy IDs, output document ID, idempotency key/hash, lease fields, attempt counters, timestamps, and bounded error.
- [ ] **Step 3: Add RLS** so the owner and users with project access can read job status, while inserts and worker transitions are service-role only. Add indexes and a unique owner/idempotency key constraint.
- [ ] **Step 4: Add claim, heartbeat, retry, and completion RPCs** using `FOR UPDATE SKIP LOCKED`, a 90-second lease, 5/20-second retry delays, and permanent failure after the configured attempts.
- [ ] **Step 5: Implement typed service functions** matching the database contract and preserving normalized input for retries.
- [ ] **Step 6: Run service tests** and a migration syntax check if local Supabase is available.

## Task 3: Build generation and Document persistence worker

**Files:**
- Create `src/lib/gdd-generation/worker.ts`
- Create `src/lib/gdd-generation/worker.test.ts`
- Modify `src/lib/services/documentService.ts` only if a narrowly scoped service-role document creation helper is required.

- [ ] **Step 1: Write failing worker tests** for successful JSON generation, invalid-model failure, missing binding, no-write-permission failure, deterministic Document creation, and retryable LLM failure.
- [ ] **Step 2: Resolve the job's target project and pinned version server-side**; never trust client labels or the system `current_version_id`.
- [ ] **Step 3: Build bounded project context** from readable Documents/Tables, recording IDs, timestamps, hashes, excerpts, byte counts, and truncation state.
- [ ] **Step 4: Build the sanitized Agent policy** from the pinned version with the existing `buildAgentRulePolicy`; retain applied/omitted IDs for evidence and do not pass provenance or raw Markdown as policy instructions.
- [ ] **Step 5: Call the existing LLM client**, parse and validate the GDD JSON, and perform one repair attempt for malformed JSON/schema output.
- [ ] **Step 6: Create a new `Game Design Document - Draft` Document** with a collision-safe name, initialize collaborative state, and persist generation metadata/source evidence. Never overwrite an existing Document.
- [ ] **Step 7: Complete the job atomically with the output Document ID**; failed jobs must create no partial Document and must retain error/input data.
- [ ] **Step 8: Run worker tests** and the existing Game Design System worker tests to verify no regression.

## Task 4: Expose authenticated enqueue and polling APIs

**Files:**
- Create `src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts`
- Create `src/app/api/projects/[projectId]/gdd-generation-jobs/[id]/route.ts`
- Create route tests under `tests/unit/`

- [ ] **Step 1: Write failing route tests** for project write permission, pinned-version validation, idempotency conflicts, status visibility, viewer denial, and cross-project/version rejection.
- [ ] **Step 2: Implement POST** requiring `designSystemId`, `versionId`, and an `Idempotency-Key`; require editor/admin document permission; verify the version belongs to the system, is readable, is conflict-free, and is the exact version stored in the resolved job input.
- [ ] **Step 3: Implement GET** returning status, phase, retry metadata, output document ID/name, applied/omitted rule IDs, and bounded error without exposing unauthorized project sources.
- [ ] **Step 4: Schedule one opportunistic worker run after enqueue** while relying on the protected cron worker for correctness.
- [ ] **Step 5: Run route tests** and authorization tests.

## Task 5: Process GDD jobs from the protected worker

**Files:**
- Modify `src/app/api/internal/game-design-system-worker/route.ts`
- Add worker dispatch tests.

- [ ] **Step 1: Write a failing dispatch test** proving a cron invocation can process one GDS job and one GDD job while an unauthorized invocation cannot claim either.
- [ ] **Step 2: Add bounded dispatch** that claims at most the existing worker batch size across both job types and keeps the `CRON_SECRET` timing-safe check unchanged.
- [ ] **Step 3: Run worker route tests** and the existing GDS worker tests.

## Task 6: Add the project action and completion handoff

**Files:**
- Modify `src/lib/services/gameDesignSystemClient.ts`
- Modify `src/components/game-design-system/GameDesignSystemWorkspace.tsx`
- Add/update `GameDesignSystemWorkspace.test.tsx`

- [ ] **Step 1: Write failing component tests** for generating from the selected concrete version, polling queued/running/completed/failed jobs, showing the created Document link, and denying viewers.
- [ ] **Step 2: Add typed client helpers** for enqueue/status requests with an idempotency key.
- [ ] **Step 3: Add `Generate GDD Draft` to each eligible project binding row**; use the selected version, target project, and no additional form fields. Do not alter the existing apply/remove binding behavior.
- [ ] **Step 4: Poll the durable job**, show phase/error/retry state, invalidate project Documents on completion, and link to the newly created Document.
- [ ] **Step 5: Run focused component tests** and the existing Game Design System workspace tests.

## Task 7: End-to-end verification

- [ ] **Step 1:** Run `npx jest src/lib/gddGeneration.test.ts src/lib/gdd-generation/worker.test.ts src/lib/services/gddGenerationService.test.ts --runInBand`.
- [ ] **Step 2:** Run route and workspace tests covering authorization, pinned-version behavior, and Document creation.
- [ ] **Step 3:** Run `npx tsc --noEmit` and the repository lint command.
- [ ] **Step 4:** Run the focused Playwright flow when local Supabase and the development server are available: select a version, choose a writable project, generate a GDD draft, observe durable progress, open the created Document, and verify the assumptions/rule evidence sections.
- [ ] **Step 5:** Run `git diff --check` and inspect the final diff for unrelated changes.

