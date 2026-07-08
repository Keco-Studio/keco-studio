# GitHub Issues #147–#168 Completion Spec (all 9 open issues)

**Date**: 2026-07-08
**Status**: Draft for execution by codex
**Depends on**: `2026-07-08-github-issues-147-168-design.md` (the accepted remediation spec)
**Open issues at time of writing**: #147, #148, #149, #154, #160, #162, #164, #166, #168.

**Scope**: This spec is the single source of truth for closing the entire open set to a level that actually satisfies each issue, not just a line-count nudge or a self-narrowed goal. Every open issue falls into exactly one of three dispositions:

1. **Verified done — close-only, no code work** — #149, #164. The code fixes already landed and were audited (see next section). These are still OPEN on GitHub only because the issues have not been closed. Executing this spec does NOT change their code; the action for them is to **close the GitHub issue** (or merge the PR that references them). Do not skip this — otherwise the board will still show them open after all code work is finished.
2. **Never-started batches** — #160 (Batch 6), #147 (Batch 7), #168 (Batch 8).
3. **Marked "done" but not actually satisfying their issue** — #154 (Batch A: service-role leak still open), #148 (Batch B: eslint rule never added; goal self-narrowed to a whitelist script), #166 (Batch C: `useRequestCache` never deleted; ~42 of 87 event sites unmigrated).
4. **Partially done — main defect fixed, a stated sub-requirement still open** — #162 (Batch D: clean-checkout environment is fixed and verified, but the issue's "coverage is monocultural" sub-requirement is untouched).

## Audit of the "Done" Batches (why category 2 exists)

I verified each already-committed batch against its issue's own "Fix" text. Result: three are genuinely aligned, one is half-done with a named security tail left in place, and two were quietly narrowed below what the issue asked for.

**Genuinely aligned — no further work:**

- **#149 (proxy auth)** — `src/proxy.ts` now fails closed on timeout/error (`buildUnauthenticatedResponse`), redirects unauthenticated page requests, returns 401 for protected APIs, and writes no `httpOnly:false` token cookies. All three issue requirements met.
- **#162 (test infra)** — the *environment* half is genuinely fixed and verified by running the chain: `jest.config.mjs` (no ts-node), no active vitest imports, dead `battleLogic` suite gone, parser tests under jest, typecheck gate present; `npm run typecheck` clean and `npm run test:unit` green (96 suites / 503 tests pass, 5 suites / 17 tests skipped = RLS env-gated, unrelated to #162). **But the issue's trailing "Also:" paragraph — coverage is monocultural, auth / all API routes / 16-of-18 `src/lib/services/*` / Yjs have zero unit tests — is untouched.** So #162 is NOT close-only; see Batch D.
- **#164 (dependencies)** — react/react-dom `^19`, next `^16`, `xlsx` removed (exceljs in its place, no app imports), `node-fetch`/`@types/echarts` removed, `ngrok` moved to devDependencies, axios/echarts upgraded. Every issue bullet addressed.

**Not actually done — covered by the new batches below:**

- **#154** — storage adapters were removed (good), but the issue's named service-role leak is untouched: `src/lib/services/projectService.ts` and `collaborationService.ts` are `'use client'` modules that read `SUPABASE_SERVICE_ROLE_KEY`. It "only fails to leak because the env var is undefined in the browser bundle" — exactly the fragile pattern the issue calls out. → **Batch A**.
- **#148** — the issue asked for an eslint `no-explicit-any` rule plus incremental `strict`; what shipped is a bespoke `scripts/check-no-explicit-any.ts` scanning a hand-picked whitelist, one API route cleaned, no eslint rule, `strict` still false. → **Batch B**.
- **#166** — the DOM self-loop in `LibraryDataContext` is gone (good), but `useRequestCache` still exists with 17 consumers and `window.dispatchEvent` sites only dropped from 87 to ~42. → **Batch C**.

## Why This Spec Exists

The original remediation spec and its batch plans are sound in direction but have three concrete gaps that let "partial extraction" pass as "done":

1. **The acceptance bar for #147 is a no-op.** The current guard test
   `tests/unit/library-module-decomposition-static.test.ts` asserts
   `LibraryDataContext.tsx < 1060` (now 1022) and `LibraryAssetsTable.tsx < 2150`
   (now 2143). Both pass today with essentially no decomposition. Issue #147
   cites the Sidebar precedent (2330 → 1416, ~40% reduction); the current files
   are barely touched.

2. **The guard test claims pre-existing files as batch output.** It asserts
   `SectionTabs.tsx`, `LibraryTableTopBar.tsx`, and `ViewerBanner.tsx` exist, but
   those files already existed before Batch 7 and Batch 7's plan never creates
   them. Existence-of-already-present-file is not evidence of extraction.

3. **Batch 7 extracts only pure helpers.** It moves `tableStructure`,
   `yjsAssetHydration`, and `updatedAt` out, which are small. It never touches
   the actually-bloated parts: the mutation orchestration in
   `LibraryDataContext` (`updateAssetField` 128 lines, `createAsset` 144 lines)
   and the 1600–2140 JSX render body of `LibraryAssetsTable`.

This spec redefines the acceptance criteria for those batches so completion is
measured against issue intent, adds behavioral-equivalence and anti-gaming
gates, and makes the plan↔spec contract explicit so future plans cannot silently
lower the bar.

## Non-Negotiable Constraints (apply to every batch below)

These are the "anti-gaming red lines". A batch that violates any of them is **not
done**, regardless of what the numeric guards say. Each is machine-checkable.

- **No test deletion to pass.** The set of active test files may only grow. A
  test file may be renamed or converted (vitest → jest), but the assertion count
  covering a given behavior must not drop. Removing a test to make a suite green
  is a failure.
- **No skip inflation.** The number of `it.skip` / `describe.skip` / `.todo` /
  `xit` occurrences in `tests/` and `src/**/*.test.ts(x)` must not increase
  relative to the pre-batch baseline. Record the baseline count in the plan.
- **No suppression to pass typecheck/lint.** No new `@ts-ignore`, `@ts-expect-error`,
  `eslint-disable`, or `: any` / `as any` may be introduced in files touched by
  the batch. Widening a type to `unknown` with a real narrow is allowed; silencing
  is not.
- **No commenting-out of live code.** Behavior is removed by deleting dead code
  with justification, not by commenting it out and leaving it. Extraction moves
  code; it does not stub it.
- **Public API stability until callers migrate.** `LibraryDataProvider`,
  `useLibraryData`, and `LibraryAssetsTable` keep their exported signatures until
  a dedicated caller-migration step changes them on purpose.
- **Green chain per batch.** Each batch ends with `npm run typecheck`,
  `npm run lint:types` (or `npm run lint`), and the batch's targeted
  `npm run test:unit` run — all passing, with output pasted into the plan's
  completion note.

## The plan ↔ spec Contract

To answer "how do plan and spec work together, and is it real":

- **This spec owns the acceptance criteria** (the "what done means" and the
  numeric/behavioral gates). Plans may not weaken a threshold defined here. A
  plan that needs a looser bar must amend this spec first, with rationale, in the
  same change.
- **Plans own the task-by-task execution** (files, interfaces, TDD steps). Every
  plan task must map to at least one acceptance criterion in this spec, cited by
  ID (e.g. `AC-147-1`). A task with no acceptance criterion is out of scope.
- **The guard test is the enforcement layer.** Acceptance criteria that are
  machine-checkable must be encoded in `library-module-decomposition-static.test.ts`
  (or a sibling) so they cannot silently regress. The guard test's thresholds
  must match this spec's numbers exactly.
- **Verification is real only when the command output is recorded.** "PASS" in a
  checkbox is not evidence. Each completed batch appends a short block with the
  actual command lines and their pass/fail summary counts.

---

## Batch 6 — Yjs Simplification (#160) — must land before Batch 7

Rationale: decomposing `LibraryDataContext` while the misleading Yjs
clear+repopulate and dual-document machinery are still present would just relocate
code that should be deleted. Do #160 first.

### Acceptance Criteria

- **AC-160-1** No code path clears then fully repopulates a Yjs doc as the
  authoritative load strategy. `yAssets.clear()` followed by full repopulate on
  load / on IndexedDB `synced` / on restore is gone. (Guard: static grep gate in
  a test — assert `LibraryDataContext.tsx` no longer contains the clear+repopulate
  load pattern.)
- **AC-160-2** No source string claims offline editing support without a provider.
  The `YjsContext.tsx:36` "supports offline editing" claim is removed or corrected
  to describe the actual online behavior. (Guard: grep test asserting the false
  claim string is absent.)
- **AC-160-3** The dual `library-${id}` + `asset-table-${id}` document / dual
  IndexedDB path is collapsed to a single source of truth for one table, or the
  redundant one is removed. (Guard: static assertion + typecheck.)
- **AC-160-4** User-visible table editing, formula recompute, reference updates,
  and presence still work — proven by the existing behavior tests for those paths
  staying green (and, where a test gap exists, one focused test added).
- **AC-160-5** Conflict behavior is documented as online-only / last-write-wins for
  this pass; the wall-clock `Date.now()` "remote wins" console.warn path is either
  kept with an explicit comment or replaced, but not silently left as if it were
  CRDT merge.

---

## Batch 7 — Library Module Decomposition (#147)

Target model: the Sidebar precedent cited in the issue (2330 → 1416, ~40%), using
`hooks/*` for logic and `components/*` for subviews, leaving each top-level file as
a thin composition surface.

### Acceptance Criteria

- **AC-147-1 (size — LibraryAssetsTable).** `src/components/libraries/LibraryAssetsTable.tsx`
  is **≤ 1300 lines** (from 2229 at issue-open; guard currently 2150). The guard
  test threshold is updated to `1300`.
- **AC-147-2 (size — LibraryDataContext).** `src/lib/contexts/LibraryDataContext.tsx`
  is **≤ 650 lines** (from 1129 at issue-open; guard currently 1060). The guard
  test threshold is updated to `650`.
- **AC-147-3 (real extractions, not pre-existing files).** The guard test must not
  assert existence of files that predate the batch. Replace those assertions with
  assertions that the *newly extracted* units exist AND that the corresponding
  logic is no longer inline in the top-level file (assert the inline block is
  absent, e.g. the `updateAssetField` body is not defined in
  `LibraryDataContext.tsx`).
- **AC-147-4 (LibraryDataContext extraction targets).** At minimum, extract into
  focused hooks/helpers under `src/lib/library/` or
  `src/components/libraries/hooks/`:
  - asset mutation orchestration (`updateAssetField`, `updateAssetName`,
    `createAsset`, `deleteAsset`, `updateMultipleFields`, `updateAssetsBatch`) into
    a `useLibraryAssetMutations`-style hook;
  - realtime event handlers (`handleCellUpdateEvent`, `handleAssetCreateEvent`,
    `handleAssetDeleteEvent`, `handleConflictEvent`, `handleRowOrderChangeEvent`,
    `handleCellsBatchUpdateEvent`) into a realtime-wiring hook;
  - reference-sync logic (`applyReferenceSyncToLocalState`,
    `syncReferencesAfterSourceChange`) into a helper.
  The provider becomes composition of these plus context assembly.
- **AC-147-5 (LibraryAssetsTable extraction targets).** At minimum, extract the
  JSX render body (currently ~lines 1600–2140) into subview components under
  `src/components/libraries/components/` (e.g. table body / row rendering,
  drawer/detail panel wiring), and move section-editing and find/replace handler
  clusters into hooks. Inline `useMemo`/`useCallback` clusters that duplicate
  extractable logic are replaced by hook calls.
- **AC-147-6 (behavioral equivalence).** Public APIs of `LibraryDataProvider`,
  `useLibraryData`, and `LibraryAssetsTable` are byte-identical in signature
  before/after (guard: a type-level snapshot test or an `expect(typeof ...)` +
  exported-keys assertion). All previously green library table tests stay green.
- **AC-147-7 (incremental, verified slices).** Each extraction slice is its own
  commit with typecheck+lint+targeted tests green before the next. No single
  commit both extracts and rewrites behavior.

### Explicitly out of scope for #147

- No table UI redesign, no user-facing workflow change (inherited from parent
  spec Non-Goals).
- No performance re-architecture beyond what falls out of narrower re-render
  scope.

---

## Batch 8 — English Developer Comments (#168)

### Acceptance Criteria

- **AC-168-1** Every file *touched by Batches 6 and 7* has its Chinese-only
  developer comments (`//`, `/* */`, JSDoc) translated to English.
- **AC-168-2** Domain data is preserved: script-parser regex/format literals,
  Chinese format-string syntax, and Chinese test fixture data representing real
  product shapes stay as-is. Translation applies to *explanatory comments*, not
  *data*.
- **AC-168-3** An audit gate (a focused test or a grep-based script wired into
  `test:unit`) fails if a touched path reintroduces a Chinese-only comment,
  scoped to the batch's touched files to avoid churning the ~30-file long tail.

---

## Batch A — Service-Role Server Boundary (#154 residual) — highest priority

This is the only remaining item that is a live security exposure, so it goes first.

The storage-adapter consolidation from the original Batch 2 is done. What remains
is the issue's explicit requirement: "move all service-role usage into server-only
modules (`import 'server-only'`)". Today `getServiceClient()` (reading
`SUPABASE_SERVICE_ROLE_KEY`) lives in `'use client'` modules
`src/lib/services/projectService.ts:17` and `src/lib/services/collaborationService.ts:28`.
It does not leak *only* because non-`NEXT_PUBLIC_` env vars are undefined in the
browser bundle — one accidental `NEXT_PUBLIC_` prefix or bundler change turns it
into account-level key exposure. The permission check that gates the service-role
delete also currently runs in the browser.

### Acceptance Criteria

- **AC-154-1** All `getServiceClient()` / `SUPABASE_SERVICE_ROLE_KEY` usage lives in
  a module that starts with `import 'server-only';` and is NOT marked `'use client'`.
  (Guard: static test asserting no file containing `SUPABASE_SERVICE_ROLE_KEY` also
  contains `'use client'`, and every such file imports `server-only`.)
- **AC-154-2** Client components no longer import the service-role code path
  directly. Service-role operations (`deleteProject` and any collaboration
  equivalents that bypass RLS) are reached only through server routes under
  `src/app/api/**` or server actions. Client callers (`Sidebar.tsx`,
  `useCacheMutations.ts`, etc.) call the API/action, not the service module.
  (Guard: static assertion that no `'use client'` module imports the extracted
  service-role module.)
- **AC-154-3** The authorization check (`verifyProjectDeletionPermission` and
  siblings) runs server-side in the same request path as the service-role call,
  not in the browser before it.
- **AC-154-4** Behavior is preserved: an admin collaborator (non-owner) can still
  delete a project; a non-admin cannot. Prove with a focused test on the new
  server boundary (or, if a DB-backed test is impractical here, a unit test around
  the permission gate plus a recorded manual verification note).
- **AC-154-5** No new browser-readable secret. `grep` for `NEXT_PUBLIC_SUPABASE_SERVICE`
  or any `NEXT_PUBLIC_*SERVICE_ROLE*` returns nothing.

---

## Batch B — Type Safety, Real #148 Coverage

The shipped work (`scripts/check-no-explicit-any.ts` over a whitelist + one route
cleaned) is a defensible *start* but does not match the issue, which asked for an
eslint rule and incremental `strict` beginning in `src/app/api/**`. codex must
pick ONE of two paths and record the choice on the issue — silently shipping the
narrowed version is not acceptable.

### Acceptance Criteria (choose Path 1 or Path 2, then meet its ACs)

**Path 1 — meet the issue as written (preferred):**

- **AC-148-1** Add `@typescript-eslint/no-explicit-any` (via
  `typescript-eslint`) to `eslint.config.mjs` as an `error` for `src/app/api/**`
  and `warn` elsewhere, so new `any` is flagged by the standard linter, not only a
  bespoke script. (Guard: config test asserting the rule is present and scoped.)
- **AC-148-2** Enable `noImplicitAny` + `strictNullChecks` (or `strict: true`) for
  the `src/app/api/**` slice — via a scoped `tsconfig` or per-file cleanup that
  keeps `npm run typecheck` green — and clean the `any` in the three high-density
  routes the issue names (`libraries/route.ts`, `search/assets/route.ts`,
  `export/route.ts`), not just one.
- **AC-148-3** Typecheck and lint stay green; the remaining ~330 `any` outside the
  API slice may be deferred, documented as a follow-up.

**Path 2 — formally accept the narrower scope:**

- **AC-148-4** If the team decides the whitelist-script approach is sufficient for
  now, update the parent remediation spec's #148 acceptance text to say so, expand
  the script's file list to cover all three named API routes, and post a comment
  on issue #148 stating the deviation and rationale. The issue is only closed once
  that deviation is on the record.

---

## Batch C — Finish the Event-Bus Migration (#166 residual)

The `LibraryDataContext` DOM self-loop is already gone — record that as satisfied.
The rest of #166 is not: `useRequestCache` still exists with 17 consumers and
`window.dispatchEvent` is only down from 87 to ~42.

### Acceptance Criteria

- **AC-166-1 (satisfied — record only)** `LibraryDataContext` no longer dispatches a
  `window` CustomEvent that its own effect consumes to trigger `loadInitialData`.
  (Guard: static assertion that `LibraryDataContext.tsx` contains no
  `window.dispatchEvent` for data-sync event names.)
- **AC-166-2** `src/lib/hooks/useRequestCache.ts` is deleted, and its 17 consumers
  are migrated to React Query (or an existing cache). No file imports
  `useRequestCache` after this batch. (Guard: grep gate.)
- **AC-166-3** Every remaining `window.dispatchEvent` site is a genuine UI
  command/control event (topbar toggle, highlight clear, modal open, agent
  command), not a cache-invalidation signal. Produce a short classified inventory
  in the plan: each remaining site tagged `ui-command` (kept) or `data-sync`
  (must be migrated). Data-sync count must reach 0.
- **AC-166-4** No behavior regression in cross-component refresh: creating/renaming/
  deleting projects, folders, libraries, and assets still updates the sidebar and
  open views. Covered by existing tests staying green plus any focused test added
  for a migrated path.

> Note: full migration of all ~42 sites may be large. If codex splits AC-166-2/3
> across more than one commit, each commit must still leave the chain green and
> must not increase the data-sync site count.

---

## Batch D — Test Coverage Breadth (#162 residual)

The clean-checkout environment defect (#162's main body) is fixed and verified. The
only open part is the issue's trailing requirement: coverage is monocultural — the
agent subsystem is heavily tested while auth, all API routes, 16-of-18
`src/lib/services/*`, and Yjs/collaboration have zero unit tests. Satisfying #162
"as written" requires closing this gap, not just the environment.

Because this is a broad, open-ended effort, it is lowest priority and may be split
into follow-up slices — but it is in scope, not deferred to a new issue (per the
instruction to satisfy the current issue's requirements).

### Acceptance Criteria

- **AC-162-1** Add unit tests for the auth layer, so it is no longer at zero
  coverage (proxy policy classification, one server/client Supabase path, the
  service-role permission gate from Batch A).
- **AC-162-2** Add unit tests for API routes: at minimum the high-density routes
  the issues already name (`libraries/route.ts`, `search/assets/route.ts`,
  `export/route.ts`), covering auth-required and success paths.
- **AC-162-3** Add unit tests for previously-untested `src/lib/services/*` modules,
  prioritizing those touched by Batches A/6/7/C so coverage lands where code is
  already changing.
- **AC-162-4** Add at least a smoke-level unit test for the Yjs/collaboration data
  path that remains after Batch 6 (#160).
- **AC-162-5** No skip inflation and no `any`/suppression added to make the new
  tests pass (spec red lines). Record the new suite/test counts vs. the pre-batch
  baseline (96 suites / 503 passing today).

> This AC set is intentionally breadth-first, not a coverage-percentage target;
> the goal is that each named area is no longer at zero, matching the issue's own
> framing. If the full breadth is too large for one pass, split into slices — but
> #162 stays open until every AC-162-* area has real tests.

---

## Suggested Execution Order for codex

Order by risk, not by issue number. Security first, then the architecture refactors
(which are coupled), then the cleanup.

1. **Batch A (#154 service-role boundary)** — live security exposure, do it first
   and standalone.
2. **Rewrite the guard test** (`library-module-decomposition-static.test.ts`)
   to encode AC-147-1/2/3, the anti-gaming baselines (skip count, suppression
   count), and the #160/#166 static assertions. Run it — it must FAIL now. This is
   the TDD anchor and it locks the bar before any refactor.
3. **Batch 6 (#160)** to green against its ACs — before #147, since it deletes code
   #147 would otherwise just relocate.
4. **Batch 7 (#147)** slice-by-slice to green against AC-147, each slice a commit.
5. **Batch C (#166 residual)** — delete `useRequestCache`, finish the ~42-site
   migration. Naturally overlaps files touched in #147/#160.
6. **Batch B (#148)** — eslint rule + API-slice strictness (or the recorded
   narrow-scope decision).
7. **Batch 8 (#168)** on every file the batches above touched.
8. **Batch D (#162 coverage)** — lowest priority, breadth-first; add tests to the
   auth / API-route / services / Yjs areas that are at zero coverage. Naturally
   reuses the server boundary from Batch A and code changed by 6/7/C. May be split
   into slices.
9. **Final chain:** `npm run lint && npm run typecheck && npm run test:unit && npm run build`,
   plus `npm audit --omit=dev`, output recorded.

## How to Judge "Done" (the checklist you asked for)

A batch is done when ALL of these hold — and the plan's completion note pastes the
evidence for each:

- [ ] Every AC for the batch is satisfied and encoded in the guard test where
      machine-checkable.
- [ ] All Non-Negotiable Constraints hold (no test deletion, no skip inflation, no
      suppression, no commented-out code, stable public API, green chain).
- [ ] The guard test thresholds equal this spec's numbers (1300 / 650), not the old
      placeholder numbers.
- [ ] Recorded command output shows targeted tests + typecheck + lint passing, with
      pass/skip counts, and the skip count did not rise vs. baseline.
- [ ] Each plan task cites the AC it satisfies.

## Does Executing This Spec Close All 9 Open Issues?

Yes — if and only if the close-only step is done too. Full execution of every
batch below satisfies the *engineering* requirement of all 9 issues. But four
issues need an explicit GitHub action beyond code, so the board reflects reality.
This is the final disposition matrix; the work is not "complete" until every row
is checked.

| Issue | Batch here | Code work needed | GitHub action to close |
|-------|-----------|------------------|------------------------|
| #149  | (none — verified done) | none | **Close issue** / merge PR |
| #162  | Batch D | env fixed (verified); coverage-breadth tests still needed | Close after AC-162-* green |
| #164  | (none — verified done) | none | **Close issue** / merge PR |
| #154  | Batch A | server-only boundary + client callers via API | Close after AC-154-* green |
| #160  | Batch 6 | Yjs simplification | Close after AC-160-* green |
| #147  | Batch 7 | decomposition to ≤1300 / ≤650 | Close after AC-147-* green |
| #166  | Batch C | delete `useRequestCache`, finish migration | Close after AC-166-* green |
| #148  | Batch B | eslint rule + API strict slice **OR** recorded narrow-scope decision | Close after AC-148-* green (Path 2 also requires an issue comment stating the deviation) |
| #168  | Batch 8 | English comments in touched files | Close after AC-168-* green |

Caveats that could leave an issue *not* fully closable:

- **#148 Path 2**: if codex chooses the narrow whitelist-script scope, #148 is only
  closable after the deviation is posted on the issue and the parent spec's #148
  text is amended. Closing it silently under the narrowed scope is not allowed.
- **#164 residual advisories**: closing #164 assumes any remaining `npm audit`
  advisories are documented as no-fix. If a new fixable advisory has appeared
  since the batch landed, re-run `npm audit --omit=dev` and address or document it
  before closing.
- **#166 scale**: if the ~42-site migration is split across commits, #166 stays
  open until the data-sync site count reaches 0 and `useRequestCache` is deleted,
  not merely reduced.

## Self-Review

- This spec does not redefine the parent spec's direction; it tightens the
  acceptance layer for the still-open batches and fixes the demonstrably-broken
  guard.
- The numeric targets (1300 / 650) are chosen to match the ~40% Sidebar precedent
  the issue itself cites, not picked arbitrarily; if codex finds a target
  infeasible without behavior change, the contract requires amending this spec
  with rationale rather than silently shipping under it.
- The anti-gaming constraints are all machine-checkable (file counts, skip counts,
  grep for suppressions), so "is it real" is answerable by CI, not by trust.
