# GitHub Issues 147-168 Batch 8 English Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix issue #168 by translating developer comments in the audited paths to English and adding a static guard for those paths.

**Architecture:** Keep code behavior untouched. Add a Jest static test that scans only comment text in a fixed set of source/test/style files, so Chinese domain data, regex literals, parser syntax, and fixtures remain allowed outside comments.

**Tech Stack:** Jest, TypeScript, Next.js source files, CSS modules.

## Global Constraints

- Commit after this batch; do not push.
- Translate code comments only; do not translate user-facing strings, parser literals, regex syntax, or fixture data.
- Preserve unrelated worktree changes.
- Run the comment guard plus type/lint verification before commit.

---

### Task 1: English Comment Guard

**Files:**
- Create: `tests/unit/english-comments-static.test.ts`

**Interfaces:**
- Produces: a static Jest test that reports `file:line` for Chinese characters inside `//`, `/* */`, or JSDoc comments in the covered paths.

- [ ] **Step 1: Write the failing guard**

Create `tests/unit/english-comments-static.test.ts` with a fixed file list drawn from issue #168 and the current audit.

- [ ] **Step 2: Run guard to verify failure**

Run: `npm run test:unit -- tests/unit/english-comments-static.test.ts --runInBand`

Expected: FAIL with current Chinese developer comments.

### Task 2: Translate Comments

**Files:**
- Modify: files reported by the guard.

- [ ] **Step 1: Translate comments**

Translate developer comments to concise English. Keep Chinese examples, field names, regex literals, UI/domain data, and fixture strings unchanged when they are actual code or data.

- [ ] **Step 2: Run guard**

Run: `npm run test:unit -- tests/unit/english-comments-static.test.ts --runInBand`

Expected: PASS.

### Task 3: Verify And Commit

- [ ] **Step 1: Run focused verification**

Run: `npm run test:unit -- tests/unit/english-comments-static.test.ts --runInBand`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run lint:types`

Expected: PASS.

- [ ] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-github-issues-147-168-batch-8-english-comments.md tests/unit/english-comments-static.test.ts <translated files>
git commit -m "chore: translate developer comments to english"
```
