# Resumable Professional GDD Generation Design

## Problem

Vercel Hobby limits each function invocation to 300 seconds. A professional GDD can require a long primary model stream, table-plan repair, dialogue planning, validation, and persistence. Running that entire workflow inside one request can be terminated by the platform before the worker records an error or releases its lease. After three reclaimed leases, the database marks the job failed with `Generation worker lease expired after final attempt.`

Increasing the application deadline beyond 300 seconds cannot solve this deployment constraint. Professional generation must make durable progress across multiple bounded worker invocations.

## Goals

- Complete complex professional GDD jobs across multiple Vercel Hobby invocations.
- Keep every invocation below the 300-second platform ceiling.
- Preserve completed model work across retries, expired leases, and process termination.
- Keep quick-mode behavior unchanged.
- Preserve the existing public job API and document persistence behavior.
- Surface the actual failed stage whenever the worker can still write a failure.

## Non-Goals

- Removing all generation deadlines.
- Introducing an external queue or a new hosted worker service.
- Changing generated document, table, dialogue, or map resource formats.
- Automatically rerunning already-terminal historical jobs.

## Architecture

Professional contract-v2 jobs use the existing `phase`, `blueprint`, `section_drafts`, `review_report`, and `repair_round` columns as a durable state machine. Each claim runs one bounded stage, checkpoints its output, clears the lease, and queues the same job for the next stage. A subsequent poll or cron invocation claims the job and resumes from its stored phase.

Quick jobs and legacy contract-v1 jobs continue through the current single-invocation generation path.

### Professional Phases

1. `collecting` validates the frozen job context and checkpoints the transition to `planning`.
2. `planning` asks the model for a compact JSON blueprint containing the ordered GDD section plan and cross-section numeric invariants. It stores the blueprint and queues `generating_core`.
3. `generating_core` generates the first bounded group of sections and queues `generating_systems`.
4. `generating_systems` generates the second bounded group, including system rules, formulas, boundaries, and guided table references, then queues `generating_content`.
5. `generating_content` generates the remaining content and presentation sections, plus table-plan and dialogue markers, then queues `reviewing`.
6. `reviewing` assembles all drafts, normalizes Markdown, repairs missing table plans and dialogue plans, validates the result, and stores the finalized generated payload in `review_report`. It queues `saving`.
7. `saving` reconstructs the validated generated payload from `review_report`, persists the GDD and resources idempotently, and reaches the existing completed or map-related terminal state.

The phase names already exist in the database constraint and TypeScript job type.

## Checkpoint Contracts

### Blueprint

`blueprint` is a JSON object with:

- `version: 1`
- `title: string`
- `sections: Array<{ id: string; title: string; stage: 'core' | 'systems' | 'content'; instructions: string[] }>`
- `invariants: string[]`

The planner must assign every section to exactly one generation stage. The worker validates this structure before checkpointing.

### Section Drafts

`section_drafts` is an ordered JSON array with:

- `sectionId: string`
- `stage: 'core' | 'systems' | 'content'`
- `markdown: string`

Each generation stage replaces drafts for its own stage and preserves drafts from earlier stages. Re-running a stage is therefore idempotent and cannot append duplicates.

### Finalized Review Payload

At the end of `reviewing`, `review_report` stores:

- `version: 2`
- `review: ReviewV2`
- `markdown: string`
- `tablePlans: GeneratedTablePlan[]`
- `tablePlanWarning: string | null`
- `dialoguePlans: DialoguePlan[]`
- `dialoguePlanWarning: string | null`

The `saving` stage validates this payload before persistence. Model output is never trusted solely because it was checkpointed.

## Invocation Budget

- All routes that can run the GDD worker keep `maxDuration = 300`.
- A worker invocation uses a 240-second application deadline for any individual professional stage.
- Heartbeats continue every 30 seconds with a 90-second renewable lease.
- The remaining 60 seconds are reserved for abort propagation, retry/checkpoint RPCs, response serialization, and platform variance.
- `GDD_GENERATION_DEADLINE_MS` remains the single-invocation deadline for quick and legacy jobs. Professional resumable stages use a separate bounded `GDD_PROFESSIONAL_STAGE_DEADLINE_MS`, accepted only from 30,000 through 240,000 milliseconds and defaulting to 240,000.

## Claim And Retry Semantics

The claim RPC must preserve the stored phase for resumable professional jobs. It may initialize a new job in `collecting`, but it must not reset an existing queued or expired-running job to `collecting`.

Checkpointing queues the next phase and resets `attempt_count` to zero because a completed stage is durable progress. A transient failure within a stage uses the existing retry RPC and retains `phase`, `blueprint`, `section_drafts`, and `review_report`. Exhaustion marks only that stage terminal.

An expired lease with remaining attempts is reclaimed at the same phase. An expired final attempt is terminal as today.

## Scheduling

Project polling remains the opportunistic wake mechanism. The internal cron endpoint must not attempt multiple long GDD stages within one invocation. It dispatches at most one claimed GDD stage per request while retaining its current behavior for other worker types.

After a successful checkpoint, the job is immediately claimable. The next client poll or cron tick starts the next stage. The server does not recursively process all remaining stages inside one invocation.

## Error Handling

- Invalid checkpoint data is a permanent validation failure.
- Provider/network/stage deadline failures are retryable and retain the current phase and prior checkpoints.
- Lost leases abort the active model request and do not persist partial stage output.
- Failure messages include the phase, for example `Professional GDD stage reviewing exceeded its 240-second deadline.`
- The public DTO remains bounded and does not expose blueprint, drafts, prompts, leases, or finalized internal payloads.

## Persistence And Idempotency

Only the `saving` stage creates or updates project resources. Earlier stages write only job checkpoints. Existing persistence RPC ownership and advisory locking remain authoritative.

If saving succeeds but the process ends before returning, the existing generation series/job identity must make a repeated saving stage reuse the same output rather than create duplicates. The worker re-reads the job after a persistence lease-loss response before deciding whether to retry.

## Database Migration

A new forward-only migration replaces these functions:

- `claim_gdd_generation_job`: preserve the job phase when claiming.
- `retry_gdd_generation_job`: preserve the job phase on queued retry.

The migration does not rewrite existing completed or failed jobs. New constraints are added only if required to validate checkpoint payload sizes; the current 256 KB input limit is unchanged.

## Testing

- Unit-test professional phase dispatch and checkpoint transitions.
- Unit-test that each stage reads prior checkpoint data and replaces only its own drafts.
- Unit-test the 240-second default, valid overrides, invalid overrides, abort propagation, and phase-specific retry error.
- Unit-test that quick mode still uses the existing direct generator.
- Migration-test that claim and retry preserve phase and checkpoint columns.
- Route-test all worker routes at `maxDuration = 300`.
- Worker-route test that one invocation does not recursively run multiple professional stages.
- Run focused Jest suites, TypeScript, ESLint, database migration tests, `next build`, and `git diff --check`.

## Rollout And Verification

1. Apply the database migration before deploying the application code.
2. Deploy with `GDD_PROFESSIONAL_STAGE_DEADLINE_MS=240000` or omit it to use the default.
3. Generate a professional GDD whose input is comparable to Blue Tide Cleanup.
4. Observe multiple phase transitions with renewed leases and increasing durable drafts.
5. Confirm one final document and its related resources are created without lease-expiry failure.
6. Keep the historical failed job unchanged; start a new job for the production acceptance run.

## Alternatives Rejected

- `maxDuration = 800`: Vercel Hobby caps the invocation at 300 seconds, so this value is ineffective.
- No application deadline: the platform can terminate the process without cleanup, recreating the lease-expiry symptom.
- One smaller prompt only: reduces probability but does not guarantee completion for complex table and dialogue workloads.
- External persistent worker: architecturally clean but adds deployment infrastructure beyond the requested scope; the existing database checkpoints are sufficient for this fix.
