# PR Migration Gate Design

**Date:** 2026-07-17
**Status:** Approved through the standing instruction to repair failed PR checks
**Scope:** Prevent database-history drift from blocking pull requests with no migration changes.

## Root Cause

PR #243 changes no file under `supabase/migrations/`, but
`.github/workflows/deploy-vercel.yml` sets `has-migrations=true` whenever the repository
contains any migration file. Every pull request therefore runs `supabase db push` against
the shared preview project.

The preview project currently reports remote migration versions `20260716065000`,
`20260716065500`, and `20260716070000` that are absent locally. That independent history
drift makes the migration job fail before the Vercel deployment job, even for UI-only PRs.

## Decision

For pull requests, compare `HEAD` with `github.event.pull_request.base.sha` and run the
migration job only when that diff contains a file under `supabase/migrations/`. Using the
event's base commit is required because a PR may target `master` or `release/**`, whose
contents can differ from `main`. When no migration file changed, emit
`has-migrations=false`; the migration job is skipped and the existing deploy job may
proceed.

Pushes to `main`, `master`, and `release/**` retain the existing always-run behavior through
the migration job's branch condition. Pull requests containing a migration change retain
the existing strict `supabase db push --include-all` behavior and will still expose remote
history drift.

## Alternatives Rejected

- Repairing the shared preview migration history would unblock this run but would not fix
  the workflow bug that couples every unrelated PR to preview database health.
- Adding empty local files for unknown remote versions would falsely claim schema history
  that is not represented in the repository.
- Allowing migration failures to continue would hide real schema deployment failures.

## Implementation

Remove the fallback that marks `has-migrations=true` solely because the migration directory
is non-empty. Extract migration path detection into
`scripts/detect-migration-changes.sh`, using Git's pathspec support rather than a grep
pipeline. Git errors remain blocking.

The deploy job requires the migration detector job to succeed. This distinguishes an
intentional migration skip from a downstream skip caused by detector failure.

Add workflow wiring assertions and temporary-repository behavior tests proving that:

- unchanged migration directories do not opt a PR into database migration;
- added, modified, deleted, and renamed migration files are detected;
- UI-only PRs based on a diverged release branch use the release base commit rather than
  `main`;
- main/master/release branches still appear in the migration job's always-run condition;
- migration failures remain blocking.
- migration detection failures prevent deployment.

## Non-Goals

- Changing or repairing any remote Supabase migration history.
- Changing migration SQL files.
- Making migration failures non-blocking.
- Changing production or release deployment behavior.
