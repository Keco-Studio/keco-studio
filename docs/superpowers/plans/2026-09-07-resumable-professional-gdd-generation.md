# Resumable Professional GDD Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make complex professional contract-v2 GDD jobs complete across multiple Vercel Hobby invocations without exceeding the 300-second function limit or losing durable progress.

**Architecture:** Keep quick and legacy jobs on the current single-call path. Route professional contract-v2 jobs through a durable phase machine using the existing `blueprint`, `section_drafts`, `review_report`, and `repair_round` columns; each invocation performs one phase, checkpoints, and requeues the job. Preserve the route ceiling at 300 seconds and use a 240-second application deadline per phase.

**Tech Stack:** Next.js route handlers, TypeScript, Jest, Supabase/PostgreSQL RPC migrations, existing streaming LLM and GDD v2 resource planners.

**Spec:** `docs/superpowers/specs/2026-09-07-resumable-professional-gdd-generation-design.md`

## Global Constraints

- All routes that can run the GDD worker keep `maxDuration = 300`.
- Professional resumable stages use `GDD_PROFESSIONAL_STAGE_DEADLINE_MS`, accepted only from `30000` through `240000` milliseconds and defaulting to `240000`.
- Quick mode and legacy contract-v1 generation behavior remain unchanged.
- Checkpoints must not expose `blueprint`, `section_drafts`, `review_report`, prompts, leases, or source snapshots through the public DTO.
- Existing persistence RPCs, advisory locks, resource ownership, and document formats remain authoritative.
- Every production-code change is preceded by a failing test and followed by focused verification.

---

### Task 1: Extend The Job Contract And Preserve Phase On Claim

**Files:**
- Create: `supabase/migrations/20260907100000_resumable_professional_gdd_jobs.sql`
- Modify: `src/lib/services/gddGenerationService.ts:67-145`
- Modify: `src/lib/services/gddGenerationService.ts:359-423`
- Test: `tests/unit/database/gdd-resumable-generation-migration.test.ts`
- Test: `src/lib/services/gddGenerationService.test.ts`

**Interfaces:**
- Consumes: existing `public.gdd_generation_jobs` rows and `checkpoint_gdd_generation_job` RPC.
- Produces: `GddGenerationJob` fields `blueprint`, `section_drafts`, `review_report`, and `repair_round`; service functions `checkpointGddGenerationJob` and `retryGddGenerationJob` preserve the phase/checkpoints; migration-defined `claim_gdd_generation_job` and `retry_gdd_generation_job` behavior.

- [ ] **Step 1: Write the failing migration assertions**

Add `tests/unit/database/gdd-resumable-generation-migration.test.ts` that reads the new migration and asserts:

```ts
expect(sql).toMatch(/create or replace function public\.claim_gdd_generation_job/i);
expect(sql).toMatch(/phase = job\.phase|phase = case/i);
expect(sql).toMatch(/blueprint|section_drafts|review_report|repair_round/i);
expect(sql).toMatch(/create or replace function public\.retry_gdd_generation_job/i);
expect(sql).toMatch(/phase = job\.phase/i);
```

Add a service fixture with `phase: 'generating_systems'`, a blueprint, and one section draft. Assert that `retryGddGenerationJob` sends `p_phase: 'generating_systems'` only if the RPC contract requires it, and that `checkpointGddGenerationJob` sends all four checkpoint values unchanged.

- [ ] **Step 2: Run the migration and service tests to verify they fail**

Run:

```bash
npx jest --runInBand tests/unit/database/gdd-resumable-generation-migration.test.ts src/lib/services/gddGenerationService.test.ts
```

Expected: the migration file is missing and the job type/service column contract does not contain checkpoint fields.

- [ ] **Step 3: Add the forward-only migration**

Create `20260907100000_resumable_professional_gdd_jobs.sql` with these semantics:

```sql
create or replace function public.claim_gdd_generation_job(
  p_worker_id text,
  p_lease_seconds integer default 90
)
returns setof public.gdd_generation_jobs
language plpgsql security definer set search_path = '' as $$
declare v_job_id uuid;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker ID is required' using errcode = '22023';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'lease seconds must be between 30 and 300' using errcode = '22023';
  end if;
  update public.gdd_generation_jobs
  set status = 'failed', phase = 'failed', completed_at = now(),
      lease_owner = null, lease_expires_at = null, heartbeat_at = null,
      error = coalesce(error, 'Generation worker lease expired after final attempt.')
  where status = 'running' and attempt_count >= max_attempts
    and (lease_expires_at is null or lease_expires_at < now());
  select job.id into v_job_id
  from public.gdd_generation_jobs job
  where job.attempt_count < job.max_attempts
    and ((job.status = 'queued' and job.available_at <= now())
      or (job.status = 'running' and job.lease_expires_at < now()))
  order by job.available_at, job.created_at, job.id
  for update skip locked limit 1;
  if v_job_id is null then return; end if;
  return query update public.gdd_generation_jobs job
  set status = 'running',
      phase = case when job.contract_version = 2 and job.mode = 'professional'
        then job.phase else 'collecting' end,
      attempt_count = job.attempt_count + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(), started_at = coalesce(job.started_at, now()),
      completed_at = null, error = null
  where job.id = v_job_id returning job.*;
end;
$$;
```

Replace the retry function with the same status transition as the existing function, but set `phase = job.phase` for professional contract-v2 jobs and clear only the lease fields. Keep the existing final-attempt terminal behavior and service-role grants. Add `notify pgrst, 'reload schema';`.

- [ ] **Step 4: Extend the service type and columns**

Add these fields to `GddGenerationJob` after `resource_change_summary`:

```ts
blueprint: Record<string, unknown> | null;
section_drafts: Array<Record<string, unknown>>;
review_report: Record<string, unknown> | null;
repair_round: number;
```

Include the columns in `JOB_COLUMNS`, but do not add them to `PUBLIC_JOB_COLUMNS`. Keep `toPublicGddGenerationJob` unchanged with respect to private fields. Ensure `checkpointGddGenerationJob` passes `null`/`[]` defaults exactly as before.

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
npx jest --runInBand tests/unit/database/gdd-resumable-generation-migration.test.ts src/lib/services/gddGenerationService.test.ts
```

Expected: all assertions pass and no private checkpoint field appears in the public DTO.

- [ ] **Step 6: Commit the independently testable database/service contract**

```bash
git add supabase/migrations/20260907100000_resumable_professional_gdd_jobs.sql src/lib/services/gddGenerationService.ts tests/unit/database/gdd-resumable-generation-migration.test.ts src/lib/services/gddGenerationService.test.ts
git commit -m "feat: preserve resumable GDD phases in job leases"
```

---

### Task 2: Add Bounded Professional Stage Generation Helpers

**Files:**
- Modify: `src/lib/gdd-generation/v2/generator.ts`
- Modify: `src/lib/gdd-generation/v2/generator.test.ts`
- Create: `src/lib/gdd-generation/v2/professionalStages.ts`
- Test: `src/lib/gdd-generation/v2/professionalStages.test.ts`

**Interfaces:**
- Consumes: `GddGenerationRequestV2`, `GddV2GeneratorDependencies`, `ChatMessage`, existing `gddV2LlmOptions`, table/dialogue marker schemas.
- Produces: `ProfessionalBlueprint`, `ProfessionalSectionDraft`, `ProfessionalStage` types and `generateProfessionalStage(input, stage, priorCheckpoint, dependencies, signal)` returning one validated stage payload without persistence.

- [ ] **Step 1: Write failing stage-contract tests**

Create tests that use a deterministic fake completion and assert:

```ts
const blueprint = await generateProfessionalStage(input, 'planning', emptyCheckpoint, { complete });
expect(blueprint.blueprint).toEqual(expect.objectContaining({ version: 1, sections: expect.any(Array) }));

const core = await generateProfessionalStage(input, 'generating_core', {
  blueprint: validBlueprint,
  section_drafts: [],
}, { complete });
expect(core.sectionDrafts.every((draft) => draft.stage === 'core')).toBe(true);
```

Also assert that a systems stage preserves core drafts, a content stage preserves both earlier stages, malformed blueprint JSON throws `GddV2GenerationValidationError`, and a pre-aborted signal rejects before invoking completion.

- [ ] **Step 2: Run the stage tests to verify they fail**

Run:

```bash
npx jest --runInBand src/lib/gdd-generation/v2/professionalStages.test.ts
```

Expected: the stage module and exported contracts do not exist.

- [ ] **Step 3: Implement the compact blueprint and section prompts**

Create `professionalStages.ts` with these exact stage types:

```ts
export type ProfessionalStage = 'planning' | 'generating_core' | 'generating_systems' | 'generating_content';
export type ProfessionalBlueprint = {
  version: 1;
  title: string;
  sections: Array<{ id: string; title: string; stage: 'core' | 'systems' | 'content'; instructions: string[] }>;
  invariants: string[];
};
export type ProfessionalSectionDraft = {
  sectionId: string;
  stage: 'core' | 'systems' | 'content';
  markdown: string;
};
```

Use one JSON completion for `planning`, then one Markdown completion per generation stage. Each stage prompt must include the frozen source context, the validated blueprint, previous drafts truncated to 24,000 characters, exact numeric invariants, and a strict instruction to output only the requested sections. Parse and validate JSON/Markdown, reject empty output and incomplete trailing headings, and use `raceWithAbort` for every completion. Do not invoke dialogue planning during these stages; dialogue resources are recovered in `reviewing`.

The stage helper must replace drafts whose `stage` matches the current stage while retaining all prior-stage drafts. Its public return shape is:

```ts
type ProfessionalStageResult = {
  blueprint: ProfessionalBlueprint | null;
  sectionDrafts: ProfessionalSectionDraft[];
};
```

- [ ] **Step 4: Run stage tests to verify they pass**

Run:

```bash
npx jest --runInBand src/lib/gdd-generation/v2/professionalStages.test.ts src/lib/gdd-generation/v2/generator.test.ts
```

Expected: the new stage contract tests and all existing generator tests pass.

- [ ] **Step 5: Commit stage generation helpers**

```bash
git add src/lib/gdd-generation/v2/professionalStages.ts src/lib/gdd-generation/v2/professionalStages.test.ts src/lib/gdd-generation/v2/generator.ts src/lib/gdd-generation/v2/generator.test.ts
git commit -m "feat: add bounded professional GDD stages"
```

---

### Task 3: Implement The Resumable Worker State Machine

**Files:**
- Modify: `src/lib/gdd-generation/worker.ts:52-70`
- Modify: `src/lib/gdd-generation/worker.ts:415-525`
- Modify: `src/lib/gdd-generation/worker.test.ts`
- Modify: `src/lib/gdd-generation/v2/generator.ts`

**Interfaces:**
- Consumes: `generateProfessionalStage`, checkpoint service RPC, existing `persistGeneratedGddV2Document` and review/resource recovery logic.
- Produces: `processClaimedGddJob` that returns `queued` after a durable professional checkpoint and `completed` only after saving; `professionalStageDeadlineMs(job)` with a 30,000–240,000 range.

- [ ] **Step 1: Write failing worker state-machine tests**

Add tests asserting:

```ts
const result = await processClaimedGddJob({ serviceClient: {}, workerId: 'worker-1', job: professionalJob }, deps);
expect(result).toBe('queued');
expect(checkpoint).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ nextPhase: 'planning' }));
expect(persistV2).not.toHaveBeenCalled();
```

Cover transitions `collecting -> planning`, `planning -> generating_core`, `generating_core -> generating_systems`, `generating_systems -> generating_content`, `generating_content -> reviewing`, `reviewing -> saving`, and `saving -> completed`. Assert each stage sends the prior checkpoint fields, replaces only its own draft stage, resets attempts through checkpoint, and does not run a second stage recursively. Assert a 240,000 ms deadline aborts a hanging stage, retries while retaining the current phase, and reports `Professional GDD stage <phase> exceeded its 240-second deadline.`.

- [ ] **Step 2: Run worker tests to verify they fail**

Run:

```bash
npx jest --runInBand src/lib/gdd-generation/worker.test.ts
```

Expected: professional jobs still call `generateGddMarkdownV2` in one invocation and no checkpoint is recorded.

- [ ] **Step 3: Add the professional stage deadline helper**

Replace the professional 600-second default with:

```ts
const PROFESSIONAL_STAGE_DEADLINE_MS = 240_000;
const MIN_PROFESSIONAL_STAGE_DEADLINE_MS = 30_000;
const MAX_PROFESSIONAL_STAGE_DEADLINE_MS = 240_000;

function professionalStageDeadlineMs(): number {
  const configured = Number(process.env.GDD_PROFESSIONAL_STAGE_DEADLINE_MS);
  return Number.isSafeInteger(configured)
    && configured >= MIN_PROFESSIONAL_STAGE_DEADLINE_MS
    && configured <= MAX_PROFESSIONAL_STAGE_DEADLINE_MS
    ? configured
    : PROFESSIONAL_STAGE_DEADLINE_MS;
}
```

Keep the existing 120,000 ms quick/legacy deadline helper untouched.

- [ ] **Step 4: Add phase dispatch and checkpoint serialization**

In `processClaimedGddJob`, detect `isGddGenerationRequestV2(job.input) && job.input.mode === 'professional'` and dispatch exactly one phase:

```ts
switch (job.phase) {
  case 'collecting': return checkpointPhase('planning');
  case 'planning': return runProfessionalStage('planning', 'generating_core');
  case 'generating_core': return runProfessionalStage('generating_core', 'generating_systems');
  case 'generating_systems': return runProfessionalStage('generating_systems', 'generating_content');
  case 'generating_content': return runProfessionalStage('generating_content', 'reviewing');
  case 'reviewing': return runProfessionalReview();
  case 'saving': return runProfessionalSave();
  default: throw new GddJobContextInvalidError(`Unsupported professional GDD phase: ${job.phase}`);
}
```

`runProfessionalStage` must call `generateProfessionalStage` under `runWithLeaseHeartbeat`, serialize the validated blueprint and drafts into `checkpointGddGenerationJob`, and return `queued`. `runProfessionalReview` must assemble drafts in blueprint order, call the existing normalization/table/dialogue recovery helpers through an exported generator review helper, store the finalized payload in `review_report`, and checkpoint `saving`. `runProfessionalSave` must deserialize and validate `review_report`, then call `persistGeneratedGddV2Document` once.

Retryable errors must call `retryGddGenerationJob` without changing `phase` or checkpoint fields. Permanent validation errors must call `failGddGenerationJob` with the phase in the bounded error message.

- [ ] **Step 5: Run worker tests to verify they pass**

Run:

```bash
npx jest --runInBand src/lib/gdd-generation/worker.test.ts src/lib/gdd-generation/v2/professionalStages.test.ts src/lib/gdd-generation/v2/generator.test.ts
```

Expected: all phase transitions, deadline, abort, retry, and quick-mode regression tests pass.

- [ ] **Step 6: Commit the worker state machine**

```bash
git add src/lib/gdd-generation/worker.ts src/lib/gdd-generation/worker.test.ts src/lib/gdd-generation/v2/professionalStages.ts src/lib/gdd-generation/v2/generator.ts
git commit -m "feat: resume professional GDD generation by phase"
```

---

### Task 4: Restore Hobby Route Budgets And Single-Stage Scheduling

**Files:**
- Modify: `src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts:21`
- Modify: `src/app/api/projects/[projectId]/gdd-generation-jobs/[id]/route.ts:16`
- Modify: `src/app/api/internal/game-design-system-worker/route.ts:9`
- Modify: `tests/unit/gdd-generation-routes.test.ts:113-116`
- Modify: `tests/unit/game-design-system-worker-route.test.ts`
- Modify: `.env.example:15-16`
- Test: `tests/unit/gdd-generation-routes.test.ts`
- Test: `tests/unit/game-design-system-worker-route.test.ts`

**Interfaces:**
- Consumes: the phase-aware `processNextGddJob` from Task 3.
- Produces: all GDD-capable routes with `maxDuration = 300`; cron dispatch that runs at most one GDD stage per request.

- [ ] **Step 1: Write failing scheduling assertions**

Add a cron test with `processGdd.mockResolvedValue({ claimed: true, jobId: 'stage-1', status: 'queued' })` and assert `processGdd` is called once for the invocation. Keep the route max-duration assertions at `300`. Add an env documentation test only if the repository’s config tests require it.

- [ ] **Step 2: Run route tests to verify they fail**

Run:

```bash
npx jest --runInBand tests/unit/gdd-generation-routes.test.ts tests/unit/game-design-system-worker-route.test.ts
```

Expected: the current branch still permits the earlier 800-second expectations or cron loops over multiple claims.

- [ ] **Step 3: Restore route limits and bound cron dispatch**

Set all three route exports to `300`. Keep `maxDuration = 300` in the internal worker route. Change only the GDD branch of the cron loop so one invocation cannot process multiple long GDD stages; other worker types retain their existing bounded dispatch. Document:

```env
# Optional professional GDD stage deadline in milliseconds (30000-240000).
GDD_PROFESSIONAL_STAGE_DEADLINE_MS=240000
```

- [ ] **Step 4: Run route tests to verify they pass**

Run:

```bash
npx jest --runInBand tests/unit/gdd-generation-routes.test.ts tests/unit/game-design-system-worker-route.test.ts
```

Expected: route ceilings are 300, the poll route still wakes expired leases, and one cron request runs at most one GDD stage.

- [ ] **Step 5: Commit the Hobby scheduling boundary**

```bash
git add src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts src/app/api/projects/[projectId]/gdd-generation-jobs/[id]/route.ts src/app/api/internal/game-design-system-worker/route.ts tests/unit/gdd-generation-routes.test.ts tests/unit/game-design-system-worker-route.test.ts .env.example
git commit -m "fix: keep GDD workers within Hobby invocation limits"
```

---

### Task 5: Validate End-To-End Contracts And Production Build

**Files:**
- Verify all files from Tasks 1-4.
- Modify: `docs/superpowers/specs/2026-09-07-resumable-professional-gdd-generation-design.md` only if verification reveals a contract mismatch.

**Interfaces:**
- Consumes: the complete resumable professional GDD implementation.
- Produces: verified migration, tests, type safety, lint, build, and documented rollout instructions.

- [ ] **Step 1: Run all focused tests**

```bash
npx jest --runInBand \
  src/lib/gdd-generation/worker.test.ts \
  src/lib/gdd-generation/v2/professionalStages.test.ts \
  src/lib/gdd-generation/v2/generator.test.ts \
  src/lib/services/gddGenerationService.test.ts \
  tests/unit/database/gdd-resumable-generation-migration.test.ts \
  tests/unit/gdd-generation-routes.test.ts \
  tests/unit/game-design-system-worker-route.test.ts
```

Expected: zero failures and no unhandled rejection warnings.

- [ ] **Step 2: Run static checks**

```bash
npm run typecheck
npx eslint src/lib/gdd-generation src/lib/services/gddGenerationService.ts 'src/app/api/projects/[projectId]/gdd-generation-jobs' src/app/api/internal/game-design-system-worker tests/unit/database/gdd-resumable-generation-migration.test.ts
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: Next.js compiles, runs TypeScript, collects page data, and finalizes optimization successfully. Restore any generated-only `next-env.d.ts` path change before reviewing the diff.

- [ ] **Step 4: Run local database migration checks**

```bash
npx jest --runInBand tests/unit/database/gdd-resumable-generation-migration.test.ts tests/unit/database/gdd-generation-v2-migration.test.ts
```

Expected: the forward-only migration preserves service-role-only checkpoint access and phase-aware claim/retry semantics.

- [ ] **Step 5: Perform a controlled resumability simulation**

Use the worker test harness with a professional job and fake timers to execute one phase at a time. Assert the sequence of persisted phases is:

```text
planning -> generating_core -> generating_systems -> generating_content -> reviewing -> saving -> completed
```

Assert that every invocation has one claim, one phase completion, and no second model stage after checkpoint. Do not call a live paid provider for this verification.

- [ ] **Step 6: Record production rollout checks**

Before accepting a new Blue Tide Cleanup generation in production:

1. Apply `20260907100000_resumable_professional_gdd_jobs.sql`.
2. Deploy the application with `GDD_PROFESSIONAL_STAGE_DEADLINE_MS=240000` or omit it for the default.
3. Start a new professional GDD job; do not mutate the historical failed job.
4. Poll until each phase changes and confirm drafts increase while `attempt_count` resets after checkpoints.
5. Confirm one final document and its resources exist and no lease-expiry fallback error is written.

- [ ] **Step 7: Request final review and finish the branch**

Review the complete diff against the spec, then run the verification-before-completion checklist before claiming the task complete.

