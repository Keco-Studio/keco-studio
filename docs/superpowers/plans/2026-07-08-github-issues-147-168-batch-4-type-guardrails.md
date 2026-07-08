# GitHub Issues 147-168 Batch 4 Type Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add incremental #148 guardrails that block new explicit `any` in touched/high-risk files and clean one API route slice without forcing whole-repo `strict: true`.

**Architecture:** Add a project script that scans a curated touched/high-risk file list for explicit `any` patterns. Wire it into `npm run lint` after ESLint. Clean `src/app/api/search/assets/route.ts` as the first API route example.

**Tech Stack:** TypeScript script run by `tsx`, npm scripts, Jest static tests.

## Global Constraints

- User-facing final replies stay in Chinese.
- Code, comments, identifiers, and API names stay in English.
- Use TDD for behavior changes where a practical test surface exists.
- Preserve unrelated user changes.
- Keep commits scoped by issue or remediation batch.
- Prefer existing project patterns over new abstractions.
- Every batch must end with a targeted verification command, and the final remediation must run the broadest practical validation chain.
- Do not push commits.
- If a command fails because of sandboxing or network restrictions, rerun it with escalated permissions.

---

### Task 1: Add Incremental Explicit Any Guard

**Files:**
- Create: `scripts/check-no-explicit-any.ts`
- Create: `tests/unit/type-guardrails.test.ts`
- Modify: `package.json`
- Modify: `src/app/api/search/assets/route.ts`

**Interfaces:**
- Produces npm script `lint:types: "tsx scripts/check-no-explicit-any.ts"`
- Updates npm script `lint: "eslint . && npm run lint:types"`

- [x] **Step 1: Write failing guardrail tests**

Add `tests/unit/type-guardrails.test.ts` asserting:

```ts
expect(pkg.scripts['lint:types']).toBe('tsx scripts/check-no-explicit-any.ts');
expect(pkg.scripts.lint).toBe('eslint . && npm run lint:types');
expect(scriptSource).toContain('src/app/api/search/assets/route.ts');
expect(searchAssetsSource).not.toMatch(/\bany\b/);
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:unit -- tests/unit/type-guardrails.test.ts --runInBand
```

Expected: FAIL because the script does not exist, npm scripts are not wired, and the API route still uses explicit `any`.

- [x] **Step 3: Implement no-explicit-any scanner**

Create `scripts/check-no-explicit-any.ts` that scans the curated file list and exits 1 if a line contains `: any`, `as any`, `<any>`, `any[]`, `Array<any>`, `Record<string, any>`, or function parameter/rest forms using `any`.

- [x] **Step 4: Wire lint scripts**

Update `package.json`:

```json
"lint": "eslint . && npm run lint:types",
"lint:types": "tsx scripts/check-no-explicit-any.ts"
```

- [x] **Step 5: Remove explicit any from search assets API**

Type Supabase rows in `src/app/api/search/assets/route.ts`:

```ts
type AssetSearchRow = { id: string; name: string | null; library_id: string; updated_at: string | null; created_at: string | null };
type LibrarySearchRow = { id: string; name: string | null; project_id: string };
```

Use type guards instead of `any` casts.

- [x] **Step 6: Verify targeted tests, script, and typecheck**

Run:

```bash
npm run test:unit -- tests/unit/type-guardrails.test.ts --runInBand
npm run lint:types
npm run typecheck
```

Expected: PASS.

- [x] **Step 7: Commit Batch 4**

Run:

```bash
git add package.json scripts/check-no-explicit-any.ts src/app/api/search/assets/route.ts tests/unit/type-guardrails.test.ts docs/superpowers/plans/2026-07-08-github-issues-147-168-batch-4-type-guardrails.md
git commit -m "chore: add incremental explicit any guard"
```

Expected: Commit created. Do not push.

## Self-Review

- Spec coverage: this plan covers the incremental guardrail part of #148 without promising full-repo strict mode.
- Placeholder scan: no unresolved placeholders remain.
- Type consistency: script name and npm script references match.
