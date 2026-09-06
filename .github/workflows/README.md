# GitHub Actions Workflows

This directory contains the active workflows for Keco Studio. Keep this file in
sync with the actual `.yml` files in this directory.

## Active Workflows

| Workflow | File | Triggers | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yml` | Pull requests to `main`; pushes to `main` | Installs dependencies, resets local Supabase, runs lint/typechecks/tests/build, validates MCP probes and RLS, builds the representative MCP load fixture, and scans production evidence. |
| Deploy to Vercel | `deploy-vercel.yml` | Pull requests and pushes to `main`, `master`, and `release/**` | Checks migration changes, runs Supabase migrations, deploys Vercel, verifies the production codec, then deploys the production MCP Edge Function on main/master pushes. |
| Playwright Tests | `playwright.yml` | Pull requests and pushes to `main`, `master`, and `release/**` | Starts local Supabase and runs Playwright E2E tests in a 4-way shard matrix. |
| MCP Account Connections Production Acceptance | `mcp-account-connections-production.yml` | Manual dispatch from `main` | Creates isolated temporary production fixtures; verifies OAuth account isolation/revocation, responsive UI, local-image writeback, and table/document reference insertion with authoritative read-back; then removes the fixtures. |
| Game Design System Worker | `game-design-system-worker.yml` | Every five minutes; manual dispatch | Recovers queued, leased, and retryable Game Design System generation jobs through the protected production worker endpoint. |

## Playwright Sharding

`playwright.yml` already runs tests in parallel with a matrix:

```yaml
strategy:
  fail-fast: false
  matrix:
    shardIndex: [1, 2, 3, 4]
    shardTotal: [4]
```

Each job runs:

```bash
npx playwright test --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}
```

This means the current Playwright workflow is sharded across four jobs.

## Local Equivalents

Use these commands before pushing workflow-sensitive changes:

```bash
npm run lint
npm run typecheck
npm run typecheck:api
npm run check:mcp
npm run test:mcp
npm run test:unit -- --runInBand tests/unit/mcp/oauth-probe.test.ts tests/unit/mcp/capabilities-probe.test.ts tests/unit/mcp/load-probe.test.ts tests/unit/mcp/performance-probe.test.ts tests/unit/mcp/evidence-scan.test.ts
npm run test:unit
npm run build
```

`npm run validate` runs the same core local checks in sequence.
The MCP checks use the Deno npm runner pinned in `package.json`.
The CI load fixture is isolated under project
`22222222-2222-4222-8222-222222222222` and is recreated transactionally.
Production evidence is scanned only after an observed evidence file exists.

## Account MCP Rollout

The account-scoped MCP endpoint is additive. The deployment dependency order is
database migrations, Vercel OAuth metadata and consent handling, production
codec health check, and then the `pixellab-map`, `pixellab-character`, and `mcp`
Edge Functions in that order. Every function deployment uses `--no-verify-jwt`;
the functions enforce their own service and user authorization.
The production workflow publishes the same repository service-role secret to
Vercel as `SUPABASE_SERVICE_ROLE_KEY` and to Supabase as
`KECO_SERVICE_ROLE_KEY` before deploying the Edge Functions. Keep those writes
paired so trusted Vercel-to-Edge calls cannot drift to different credentials.
The workflow pins `supabase/setup-cli@v1` to Supabase CLI `2.90.0`; retain that
pin for the account rollout.

Supabase CLI `2.90.0` can configure `[auth.oauth_server]` for local
`supabase start`, but does not serialize remote OAuth Server settings. A
successful `supabase link` or `supabase db push` is therefore not proof of
production OAuth enablement. Production release acceptance must directly verify
root protected-resource discovery, DCR, authorization, code exchange,
`list_projects`, viewer denial, account/legacy replay denial, and a legacy
project endpoint.

If account acceptance fails, disable only `/functions/v1/mcp`; retain
`/functions/v1/mcp/{projectId}` traffic and credentials. The service-grant
migration is additive and does not need a destructive rollback.

## Notes

- The shared repository should not contain a workflow that force-pushes to an
  individual's fork.
- Do not document placeholder workflow names unless the files are committed in
  `.github/workflows/`.

The Game Design System worker is scheduled by GitHub Actions because the Hobby
Vercel plan does not support the required one-minute Cron frequency. Configure
the repository secret `GAME_DESIGN_SYSTEM_WORKER_SECRET`; the production deploy
workflow syncs it to Vercel as `CRON_SECRET`. The worker workflow keeps runs
non-cancelling so overlapping polls can safely rely on atomic job claims.

Stripe Checkout uses the Vercel environment selected by the deploy workflow. Set
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` either in that Vercel environment
or as GitHub Actions repository secrets. When GitHub secrets are present they are
synced before the build; otherwise the workflow preserves values already stored in
Vercel. Preview sync passes an empty git-branch argument so `vercel env add`
targets all Preview branches without hanging on the interactive prompt. The
workflow pulls the environment into `.vercel/.env.<target>.local` and fails
before build if either value is missing, so a deployment cannot publish a
checkout route that will always return a Stripe configuration error.
