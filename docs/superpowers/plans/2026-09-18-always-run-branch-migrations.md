# Always-Run Branch Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run remote Supabase migrations on every supported deployment-branch push while keeping pull requests isolated.

**Architecture:** Restore the branch fallback from commit `a958e972` inside the existing `migrate-database.if` condition. Preserve the later `github.event_name == 'push'` isolation gate, migration detector, environment selection, and strict `supabase db push --include-all --yes` command.

**Tech Stack:** GitHub Actions YAML, Jest, TypeScript string-level workflow assertions.

## Global Constraints

- Pull requests must never write to a shared remote Supabase project.
- Pushes to `main`, `master`, and `release/**` must run remote migrations even without a migration diff.
- Migration failures must remain blocking.
- Do not change migration SQL files or Supabase project selection.

---

### Task 1: Restore Deployment-Branch Migration Retries

**Files:**
- Modify: `tests/unit/ci-workflow.test.ts`
- Modify: `.github/workflows/deploy-vercel.yml`

**Interfaces:**
- Consumes: `github.event_name`, `github.ref`, and `needs.check-migrations.outputs.has-migrations` from GitHub Actions.
- Produces: a `migrate-database` job condition that excludes pull requests and always admits supported deployment-branch pushes.

- [x] **Step 1: Write the failing workflow regression test**

Change the existing migration-condition assertion to require this exact condition:

```yaml
(github.repository == 'Keco-Studio/keco-studio' || github.repository == 'xzy1124/keco-studio') &&
github.event_name == 'push' && (
    needs.check-migrations.outputs.has-migrations == 'true' ||
    github.ref == 'refs/heads/main' ||
    github.ref == 'refs/heads/master' ||
    startsWith(github.ref, 'refs/heads/release/')
  )
```

Also rename the test to state that pull requests are isolated while deployment branches always run migrations.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx jest tests/unit/ci-workflow.test.ts --runInBand
```

Expected: FAIL because the current condition only admits pushes whose detector output is `true`.

- [x] **Step 3: Restore the historical branch fallback**

Replace the `migrate-database.if` expression with the exact condition asserted above. Update its comment to explain that pull requests use isolated Supabase while branch pushes always retry unapplied migrations.

- [x] **Step 4: Run focused and repository verification**

Run:

```bash
npx jest tests/unit/ci-workflow.test.ts --runInBand
npx jest tests/unit/detect-migration-changes.test.ts --runInBand
git diff --check
```

Expected: both Jest suites pass with zero failures and `git diff --check` prints no output.

- [x] **Step 5: Review the final diff**

Run:

```bash
git diff -- .github/workflows/deploy-vercel.yml tests/unit/ci-workflow.test.ts
```

Confirm that only the migration job condition, its explanatory comment, and matching assertions changed.
