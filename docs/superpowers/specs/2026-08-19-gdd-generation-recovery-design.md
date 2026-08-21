# GDD Generation Recovery Design

## Problem

GDD jobs can remain `running` after their worker lease expires. The database claim function can reclaim them, but the project polling route only wakes `queued` jobs. A stalled cron or request worker therefore leaves the UI polling a dead job indefinitely. Non-`Error` failures also collapse to `GDD generation failed.`, and model prose such as `<5` can fail sanctioned MDX parsing.

## Design

- Add a pure `shouldWakeGddGenerationJob` predicate matching the existing Game Design System worker behavior: wake available queued jobs and running jobs whose lease expired.
- After authorization, read the internal job with the service-role client in the single-job polling route. Convert it to the bounded public DTO before responding, and schedule a worker only when the predicate says the job is claimable.
- Add `describeGddGenerationError` so database/provider error objects retain a bounded message, details, hint, and code instead of becoming a generic fallback.
- Normalize raw numeric less-than expressions outside fenced and inline code before sanctioned MDX validation. This converts `<5` to `&lt;5` without changing code samples or sanctioned components.

## Data And Security

The response remains the existing public DTO. Lease owner, input snapshots, hashes, and other internal fields are never returned. The service-role read occurs only after editor/admin authorization and only for the requested job ID.

## Verification

- Unit test queued, expired-running, live-running, and terminal wake decisions.
- Route test that polling an expired running job schedules recovery while still returning no private fields.
- Worker test that structured failures preserve their message/code.
- Generator test that numeric comparisons become valid MDX while code spans and fences are unchanged.
- Run focused Jest suites, TypeScript, ESLint, and `git diff --check`.

