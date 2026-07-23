# GitHub Actions Workflows

This directory contains the active workflows for Keco Studio. Keep this file in
sync with the actual `.yml` files in this directory.

## Active Workflows

| Workflow | File | Triggers | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yml` | Pull requests to `main`; pushes to `main` | Installs dependencies, resets local Supabase, runs lint/typechecks/tests/build, validates MCP probes and RLS, builds the representative MCP load fixture, and scans production evidence. |
| Deploy to Vercel | `deploy-vercel.yml` | Pull requests and pushes to `main`, `master`, and `release/**` | Checks migration changes, runs Supabase migrations, deploys Vercel, verifies the production codec, then deploys the production MCP Edge Function on main/master pushes. |
| Playwright Tests | `playwright.yml` | Pull requests and pushes to `main`, `master`, and `release/**` | Starts local Supabase and runs Playwright E2E tests in a 4-way shard matrix. |

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
codec health check, and then `supabase functions deploy mcp --no-verify-jwt`.
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
