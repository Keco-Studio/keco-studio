# GitHub Actions Workflows

This directory contains the active workflows for Keco Studio. Keep this file in
sync with the actual `.yml` files in this directory.

## Active Workflows

| Workflow | File | Triggers | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yml` | Pull requests to `main`; pushes to `main` | Installs dependencies, starts local Supabase, resets the database, runs lint, API typecheck, unit tests, and build. |
| Deploy to Vercel | `deploy-vercel.yml` | Pull requests and pushes to `main`, `master`, and `release/**` | Checks migration changes, runs Supabase migrations when needed, and deploys to Vercel. |
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
npm run test:unit
npm run build
```

`npm run validate` runs the same core local checks in sequence.

## Notes

- The shared repository should not contain a workflow that force-pushes to an
  individual's fork.
- Do not document placeholder workflow names unless the files are committed in
  `.github/workflows/`.
