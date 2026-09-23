# Always-Run Branch Migrations Design

**Date:** 2026-09-18
**Status:** Approved
**Scope:** Restore automatic retry of remote Supabase migrations on deployment branches while keeping pull requests isolated.

## Problem

The deploy workflow currently runs `migrate-database` only when the triggering push changes
a file under `supabase/migrations/`. If that migration attempt fails, a later application-only
push skips the job, so the remote database cannot automatically catch up.

Pull requests must not solve this by writing to a shared remote database. They already validate
the complete migration set with an isolated local Supabase instance in the Playwright workflow.

## Decision

Run the remote migration job on every push to `main`, `master`, and `release/**`, regardless of
whether the push changes a migration file. Keep pull requests excluded from the remote migration
job, including pull requests that contain migration files.

The existing environment selection remains unchanged:

- `main` and `master` pushes target the production Supabase project.
- `release/**` pushes target the preview Supabase project.
- Pull requests validate migrations only through isolated local Supabase instances.

The remote command remains `supabase db push --include-all --yes`. Supabase migration history
makes the operation idempotent, so a push with no pending migration succeeds without reapplying
completed migrations and a later push retries any unapplied migration.

## Failure Behavior

Migration setup, linking, or push failures remain blocking for the Vercel deployment. The workflow
must not use `continue-on-error: true` or allow a failed migration job to be treated as an
intentional skip.

The migration-change detector remains useful for diagnostics and pull-request reporting, but its
`has-migrations` output no longer controls whether a deployment-branch push runs remote migrations.

## Verification

Workflow regression tests must prove that:

- the remote migration job requires a `push` event;
- every supported deployment branch is explicitly included;
- the condition does not depend on `has-migrations`;
- pull requests cannot execute the remote migration job;
- `supabase db push --include-all --yes` remains strict and blocking;
- Vercel deployment still waits for a successful migration or an intentional PR skip.

## Non-Goals

- Applying migrations to a shared remote database from pull requests.
- Changing migration SQL files or repairing Supabase migration history.
- Making migration failures non-blocking.
- Changing which Supabase project each deployment branch targets.
