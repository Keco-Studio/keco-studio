# Git Issues Fix Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the approved GitHub issue specs in order, pushing after each issue and waiting for GitHub checks to pass before starting the next.

**Architecture:** Each issue is implemented as an isolated slice with regression tests first, minimal code/migration changes second, and local verification before commit and push. GitHub check polling happens after each push at a 3 minute cadence, and the next issue starts only after checks are green. Spec 006 is explicitly deferred by its own spec and is not part of the automated implementation queue.

**Tech Stack:** Next.js 16, React 18, Supabase migrations/RLS, Jest/ts-jest, Playwright, GitHub Actions.

## Global Constraints

- Implement in this order: 003, 004, 005, 007, 008, 009, 010 phase 1.
- Skip 006 because `specs/006-issue-149-154-auth-hardening/spec.md` says "documentation only" and "deferred".
- Use TDD for behavior changes: write/update tests, verify RED, implement, verify GREEN.
- Preserve unrelated user changes and untracked specs.
- After each issue: run targeted tests, run `npm run build`, commit, push to `origin/git-issues-fix`, poll GitHub checks every 3 minutes until green, then continue.
- If GitHub checks fail, inspect logs, fix in the same issue slice, push again, and resume polling.

---

### Task 003: Scope shared_documents RLS to Project Members

**Files:**
- Create: `tests/unit/database/shared-documents-rls.test.ts`
- Create: `tests/unit/database/shared-documents.rls.behavior.test.ts`
- Modify: `tests/unit/database/helpers/rlsTestClient.ts`
- Modify: `src/lib/types/shared-document.ts`
- Modify: `src/lib/services/sharedDocumentService.ts`
- Create: `supabase/migrations/20260707000000_scope_shared_documents_rls.sql`

**Interfaces:**
- Produces: `shared_documents.project_id uuid references public.projects(id) on delete cascade`
- Produces: policies `shared_documents_select_policy`, `shared_documents_insert_policy`, `shared_documents_update_policy`
- Produces: service functions that accept/pass `project_id` when creating shared documents

- [ ] **Step 1: Write static migration tests**

Add assertions that the new migration adds `project_id`, drops `shared_documents_*_all`, creates scoped policies, and uses `public.is_project_owner(project_id, auth.uid())` plus `public.is_accepted_collaborator(project_id, auth.uid())`.

- [ ] **Step 2: Verify RED**

Run: `npm run test:unit -- tests/unit/database/shared-documents-rls.test.ts --runInBand`

Expected: FAIL because the forward migration does not exist.

- [ ] **Step 3: Write live RLS behavior test**

Use `buildProjectFixture()` to create a project fixture, insert shared documents with service role, then prove owner/admin/editor/viewer can read and outsider cannot read/write/update.

- [ ] **Step 4: Verify RED for behavior test when DB tests are enabled**

Run: `RLS_DB_TESTS=1 npm run test:unit -- tests/unit/database/shared-documents.rls.behavior.test.ts --runInBand`

Expected: FAIL until migration is applied in a local Supabase test DB; skipped when local Supabase env is absent.

- [ ] **Step 5: Implement migration and service typing**

Create the forward migration with additive `project_id`, safe-by-default null behavior, legacy policy drops, scoped read/write policies, and a `project_id` index. Update TypeScript document type and create function to require `projectId`.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run test:unit -- tests/unit/database/shared-documents-rls.test.ts --runInBand
npm run test:unit -- tests/unit/database/shared-documents.rls.behavior.test.ts --runInBand
npm run build
```

- [ ] **Step 7: Commit, push, poll GitHub checks**

Commit message: `fix: scope shared documents rls to project members`

Push to `origin git-issues-fix`, then poll checks every 3 minutes until green.

### Task 004: Remove Hardcoded Remote Seed Passwords

**Files:**
- Create: `tests/unit/seed-remote-passwords.test.ts`
- Modify: `supabase/seed-remote.sql`
- Modify: `scripts/seed-remote.sh`
- Modify: `supabase/seed.sql`
- Modify: `supabase/config.toml`

**Interfaces:**
- Produces: `seed-remote.sql` uses `:'seed_password'`
- Produces: `scripts/seed-remote.sh` requires `SEED_TEST_PASSWORD` and passes `-v seed_password="$SEED_TEST_PASSWORD"`

- [ ] **Step 1: Write failing unit tests**
- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Replace literals with psql variable and harden script/config**
- [ ] **Step 4: Verify targeted tests and build**
- [ ] **Step 5: Commit, push, poll GitHub checks**

### Task 005: Re-enable Security E2E Assertions

**Files:**
- Modify: `tests/e2e/specs/security.spec.ts`

**Interfaces:**
- Produces: active Playwright tests for unauthenticated API gating, IDOR, XSS, and SQLi.

- [ ] **Step 1: Inspect current commented blocks and helpers**
- [ ] **Step 2: Re-enable tests with deterministic assertions**
- [ ] **Step 3: Run targeted Playwright spec if local services are available**
- [ ] **Step 4: Run build**
- [ ] **Step 5: Commit, push, poll GitHub checks**

### Task 007: Agent Token Budget and Compaction

**Files:**
- Create/modify unit tests under `tests/unit/agent/`
- Modify: `src/lib/agent/core.ts`
- Modify: `src/lib/agent/llm-client.ts` if needed for explicit max token plumbing
- Create: `src/lib/agent/turn-budget.ts`

**Interfaces:**
- Produces: centralized budget constants/helpers, explicit `maxTokens`, resume iteration preservation, and large user content compaction.

- [ ] **Step 1: Write failing unit tests**
- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Implement minimal budget/max-token/resume/compaction changes**
- [ ] **Step 4: Verify targeted tests and build**
- [ ] **Step 5: Commit, push, poll GitHub checks**

### Task 008: Abort Agent Loop and Pin Retry Policy

**Files:**
- Modify: `src/lib/agent/sse.ts`
- Modify: `src/app/api/agent-chat/route.ts`
- Modify: `src/lib/agent/core.ts`
- Modify: `src/lib/agent/llm-client.ts`
- Create/modify unit tests under `tests/unit/agent/`

**Interfaces:**
- Produces: `sseResponse` cancellation aborts an `AbortController`
- Produces: `runAgentTurn` receives/checks an `AbortSignal`
- Produces: `isRetriableStatus(status: number): boolean`

- [ ] **Step 1: Write failing unit tests**
- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Implement abort threading and retry predicate**
- [ ] **Step 4: Verify targeted tests and build**
- [ ] **Step 5: Commit, push, poll GitHub checks**

### Task 009: Script Parser Data Loss and Misclassification

**Files:**
- Modify parser tests under `src/lib/script-parser/`
- Modify: `src/lib/script-parser/postProcess.ts`
- Modify: `src/lib/script-parser/classifier.ts`
- Modify: `src/lib/script-parser/parser.ts` only if reproduction requires it

**Interfaces:**
- Produces: no silent option truncation, curly quote regression guard, content-colon regression guard.

- [ ] **Step 1: Write reproduction tests**
- [ ] **Step 2: Verify RED for confirmed failing behavior and document already-green guards**
- [ ] **Step 3: Implement minimal parser fixes**
- [ ] **Step 4: Verify parser test suites and build**
- [ ] **Step 5: Commit, push, poll GitHub checks**

### Task 010: Yjs Misuse Phase 1

**Files:**
- Create/modify unit tests under `tests/unit/`
- Modify: `src/lib/contexts/YjsContext.tsx`
- Modify: `src/lib/contexts/LibraryDataContext.tsx` or extracted helper module
- Modify: `src/lib/hooks/useRealtimeSubscription.ts` or extracted helper module

**Interfaces:**
- Produces: persistence reset/compaction helper
- Produces: deterministic `resolveConflict` helper independent of client wall-clock
- Produces: corrected offline editing comment

- [ ] **Step 1: Write failing unit tests**
- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Implement phase 1 helpers and integrate minimally**
- [ ] **Step 4: Verify targeted tests and build**
- [ ] **Step 5: Commit, push, poll GitHub checks**
