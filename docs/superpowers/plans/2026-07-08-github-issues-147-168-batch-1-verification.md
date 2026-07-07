# GitHub Issues 147-168 Batch 1 Verification Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining #162 validation-baseline gap by making local validation run lint, typecheck, unit tests, and build.

**Architecture:** Keep the existing Jest `.mjs` config and discovery test. Add a package-level `typecheck` script and update the static CI/local gate test so future changes cannot silently drop the typecheck gate.

**Tech Stack:** Next.js 16, TypeScript 5.9, Jest 30, npm scripts.

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

### Task 1: Add The Typecheck Validation Gate

**Files:**
- Modify: `tests/unit/ci-workflow.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Existing npm scripts `lint`, `test:unit`, and `build`.
- Produces: npm script `typecheck: "tsc --noEmit"` and validate chain `npm run lint && npm run typecheck && npm run test:unit && npm run build`.

- [x] **Step 1: Write the failing test**

Update `tests/unit/ci-workflow.test.ts` so `keeps local validate aligned with CI gates` asserts:

```ts
expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
expect(pkg.scripts.validate).toBe(
  'npm run lint && npm run typecheck && npm run test:unit && npm run build'
);
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:unit -- tests/unit/ci-workflow.test.ts --runInBand
```

Expected: FAIL because `pkg.scripts.typecheck` is `undefined`.

- [x] **Step 3: Write minimal implementation**

Update `package.json` scripts to include:

```json
"typecheck": "tsc --noEmit",
"validate": "npm run lint && npm run typecheck && npm run test:unit && npm run build"
```

- [x] **Step 4: Run targeted test to verify it passes**

Run:

```bash
npm run test:unit -- tests/unit/ci-workflow.test.ts --runInBand
```

Expected: PASS.

- [x] **Step 5: Run typecheck gate**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [x] **Step 6: Commit Batch 1**

Run:

```bash
git add package.json tests/unit/ci-workflow.test.ts docs/superpowers/plans/2026-07-08-github-issues-147-168-batch-1-verification.md
git commit -m "test: add typecheck validation gate"
```

Expected: Commit created. Do not push.

## Self-Review

- Spec coverage: this plan covers Batch 1 (#162) from the accepted remediation spec.
- Placeholder scan: no unresolved placeholders remain.
- Type consistency: npm script names are consistent across test, package script, and verification commands.
