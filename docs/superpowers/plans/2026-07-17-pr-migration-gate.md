# PR Migration Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip Supabase migration deployment for pull requests that do not change migration files while preserving strict migration deployment for migration PRs and main/release pushes.

**Architecture:** Keep the existing workflow jobs and outputs. Narrow only the `check-migrations` no-diff branch so it emits `has-migrations=false`; the existing `migrate-database.if` expression continues to force migrations on main/master/release pushes and to run for PRs whose diff emits `true`.

**Tech Stack:** GitHub Actions YAML, shell diff logic, Jest static workflow regression tests.

## Global Constraints

- Do not change or repair remote Supabase migration history.
- Do not add or change migration SQL files.
- Pull requests with a changed `supabase/migrations/**` file must still run `supabase db push --include-all`.
- Pushes to `main`, `master`, and `release/**` must still run migrations even without a migration diff.
- Migration failures must remain blocking; do not add `continue-on-error: true`.
- Keep the Vercel deploy job eligible when the migration job is skipped.

---

### Task 1: Make PR Migration Detection Diff-Only

**Files:**
- Modify: `tests/unit/ci-workflow.test.ts`
- Modify: `.github/workflows/deploy-vercel.yml`

**Interfaces:**
- Consumes: `MIGRATION_FILES` from the existing base-branch Git diff.
- Produces: `steps.check.outputs.has-migrations` as `true` only for an actual PR migration diff, while branch conditions retain always-run behavior for main/master/release pushes.

- [ ] **Step 1: Write the failing workflow regression test**

Append this test inside the existing `describe('CI workflow gates', ...)` block in
`tests/unit/ci-workflow.test.ts`:

```ts
it('does not deploy migrations for a PR with no migration diff', () => {
  expect(deployWorkflow).toContain(
    'MIGRATION_FILES=$(git diff --name-only "$BASE_BRANCH" HEAD | grep "^supabase/migrations/" || true)'
  );
  expect(deployWorkflow).toContain('echo "has-migrations=true" >> $GITHUB_OUTPUT');
  expect(deployWorkflow).toContain('echo "has-migrations=false" >> $GITHUB_OUTPUT');
  expect(deployWorkflow).not.toContain(
    'Migration files detected (no changes, but unapplied migrations may exist)'
  );
  expect(deployWorkflow).toContain("github.ref == 'refs/heads/main'");
  expect(deployWorkflow).toContain("github.ref == 'refs/heads/master'");
  expect(deployWorkflow).toContain("startsWith(github.ref, 'refs/heads/release/')");
  expect(deployWorkflow).toContain('supabase db push --include-all');
  expect(deployWorkflow).toContain('continue-on-error: false');
  expect(deployWorkflow).toContain("needs.migrate-database.result == 'skipped'");
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
npx jest tests/unit/ci-workflow.test.ts --runInBand
```

Expected: FAIL because the workflow still contains
`Migration files detected (no changes, but unapplied migrations may exist)`.

- [ ] **Step 3: Replace the no-diff fallback**

In `.github/workflows/deploy-vercel.yml`, replace the nested directory-existence fallback
inside the `MIGRATION_FILES` empty branch with:

```yaml
            else
              echo "has-migrations=false" >> $GITHUB_OUTPUT
              echo "No migration file changes (relative to $BASE_BRANCH)"
            fi
```

Do not change the missing-base fallback, `migrate-database.if`, `db push`, failure policy,
or deploy job condition.

- [ ] **Step 4: Run focused and full verification**

```bash
npx jest tests/unit/ci-workflow.test.ts --runInBand
npm run typecheck
npm run test:unit -- --runInBand
git diff --check
```

Expected: the focused suite passes, TypeScript exits 0, the full unit suite has no
failures, and `git diff --check` prints no output.

- [ ] **Step 5: Commit and push**

```bash
git add tests/unit/ci-workflow.test.ts .github/workflows/deploy-vercel.yml
git commit -m "fix: skip migrations for unchanged pull requests"
git push origin 7-17
```
