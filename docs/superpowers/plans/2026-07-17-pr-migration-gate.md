# PR Migration Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip Supabase migration deployment for pull requests that do not change migration files while preserving strict migration deployment for migration PRs and main/release pushes.

**Architecture:** Keep the existing workflow jobs and outputs. For pull requests, compare
against `github.event.pull_request.base.sha` through a small shell helper that uses a Git
pathspec. The existing `migrate-database.if` expression continues to force migrations on
main/master/release pushes and to run for PRs whose diff emits `true`.

**Tech Stack:** GitHub Actions YAML, Bash, Git, Jest temporary-repository behavior tests.

## Global Constraints

- Do not change or repair remote Supabase migration history.
- Do not add or change migration SQL files.
- Pull requests with a changed `supabase/migrations/**` file must still run `supabase db push --include-all`.
- Pushes to `main`, `master`, and `release/**` must still run migrations even without a migration diff.
- Migration failures must remain blocking; do not add `continue-on-error: true`.
- Migration detection failures must block deployment.
- Keep the Vercel deploy job eligible when the migration job is skipped.

---

### Task 1: Make PR Migration Detection Diff-Only

**Files:**
- Modify: `tests/unit/ci-workflow.test.ts`
- Create: `tests/unit/detect-migration-changes.test.ts`
- Create: `scripts/detect-migration-changes.sh`
- Modify: `.github/workflows/deploy-vercel.yml`

**Interfaces:**
- Consumes: the pull request's `github.event.pull_request.base.sha`.
- Produces: `steps.check.outputs.has-migrations` as `true` only for an actual PR migration diff, while branch conditions retain always-run behavior for main/master/release pushes.

- [ ] **Step 1: Write the failing workflow regression test**

Add a workflow wiring assertion and a temporary-Git-repository suite. The behavior suite
must cover no migration change, add, modify, delete, rename, and a UI-only PR based on a
release branch that differs from `main`.

- [ ] **Step 2: Run the test and verify RED**

```bash
npx jest tests/unit/ci-workflow.test.ts tests/unit/detect-migration-changes.test.ts --runInBand
```

Expected: FAIL because the detector script and `base.sha` wiring do not exist.

- [ ] **Step 3: Implement base-aware detection**

Create `scripts/detect-migration-changes.sh` with strict Bash settings and this Git
pathspec-based diff:

```bash
git diff --name-only "$BASE_COMMIT" HEAD -- supabase/migrations/
```

Wire PR events to `github.event.pull_request.base.sha`. Preserve the missing-base fallback
for first pushes and preserve `migrate-database.if`, `db push`, failure policy, and the
successful-detection deploy behavior. Require `needs.check-migrations.result == 'success'`
so detector errors cannot be mistaken for an intentional migration skip.

- [ ] **Step 4: Run focused and full verification**

```bash
npx jest tests/unit/ci-workflow.test.ts tests/unit/detect-migration-changes.test.ts --runInBand
npm run typecheck
npm run test:unit -- --runInBand
git diff --check
```

Expected: the focused suite passes, TypeScript exits 0, the full unit suite has no
failures, and `git diff --check` prints no output.

- [ ] **Step 5: Commit and push**

```bash
git add tests/unit/ci-workflow.test.ts tests/unit/detect-migration-changes.test.ts scripts/detect-migration-changes.sh .github/workflows/deploy-vercel.yml
git commit -m "fix: skip migrations for unchanged pull requests"
git push origin 7-17
```
