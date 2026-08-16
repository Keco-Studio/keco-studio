# Game Design System Worker Scheduling Design

**Date:** 2026-08-16

## Context

Game Design System generation jobs are stored in PostgreSQL and claimed with
leases. The accepting request runs an opportunistic worker through Next.js
`after()`, but durable recovery still needs an independent scheduler. The
original one-minute Vercel Cron cannot deploy on the project's Hobby plan,
which permits only daily Cron jobs.

## Decision

Move durable recovery scheduling from Vercel Cron to GitHub Actions.

- Keep the request-scoped `after()` worker as the low-latency path.
- Add a scheduled workflow that runs every five minutes on the default branch.
- Allow manual dispatch for operational recovery and verification.
- Call `https://keco-studio-main.vercel.app/api/internal/game-design-system-worker`
  with a bearer secret.
- Keep one scheduled invocation in flight at a time. Do not cancel an active
  worker when the next schedule is delayed or starts.
- Remove the Cron declaration from `vercel.json` so Hobby preview and
  production deployments are accepted.

GitHub schedule delivery can be delayed under platform load, so five minutes is
the target recovery interval rather than a strict upper bound. Each worker
request claims up to three jobs; later ticks drain any remaining backlog.

## Secret Flow

Use one dedicated repository secret named
`GAME_DESIGN_SYSTEM_WORKER_SECRET`.

1. The production deploy workflow requires the repository secret and writes it
   to the Vercel production environment as `CRON_SECRET` before building.
2. The scheduled workflow sends the same secret in the `Authorization: Bearer`
   header.
3. The internal route continues to reject missing configuration with `503` and
   invalid credentials with `401` using timing-safe comparison.

The secret is not shared with MCP signing or codec endpoints. Preview
deployments do not receive it because scheduled recovery targets production
only. Local Playwright continues to inject an isolated test secret.

## Failure Handling

- Missing workflow secret fails the scheduled job before making a request.
- HTTP errors and timeouts fail the workflow visibly.
- Transient connection failures receive bounded curl retries.
- A failed schedule does not mutate job state unless the worker successfully
  claims a job. PostgreSQL lease expiry permits a later run to recover work.
- Manual dispatch uses the identical production path and authentication.

## Verification

- Add a static contract test for the five-minute schedule, manual dispatch,
  production endpoint, secret header, concurrency, and Vercel Cron removal.
- Assert the deploy workflow maps the dedicated repository secret to Vercel
  `CRON_SECRET` only for production.
- Retain route tests for `503`, `401`, and successful worker invocation.
- Retain real Playwright coverage proving that a queued job completes through
  the authenticated worker route without an accepting request instance.
- Run the repository English-character check, typecheck, focused Jest tests,
  production build, and the real Game Design System Playwright workflow.

## Operations

Before merging, an administrator creates
`GAME_DESIGN_SYSTEM_WORKER_SECRET` in GitHub Actions secrets. The next
production deployment synchronizes it to Vercel. After deployment, the
scheduled workflow runs automatically; operators use manual dispatch only to
drain or verify the queue immediately.
