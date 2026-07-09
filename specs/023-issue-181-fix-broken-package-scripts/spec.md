# Feature Specification: Fix two broken package.json scripts (issue #181)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #181 — `test:upload-security:manual` targets a non-existent spec; `test:e2e:shard` is `playwright test --shard` missing the required `=N/M` argument.

## Overview

Two npm scripts in `package.json` are broken (verified 2026-07-09):

- `"test:upload-security:manual": "playwright test tests/e2e/specs/file-upload-security-manual.spec.ts --headed"` — the file `tests/e2e/specs/file-upload-security-manual.spec.ts` does not exist. The real spec is `file-upload-security.spec.ts` (used by the working `test:upload-security` script).
- `"test:e2e:shard": "playwright test --shard"` — `--shard` requires a value in the form `=N/M`; invoked as-is it errors, so the script is non-functional.

### Investigation findings (verified 2026-07-09)

1. Grep confirms no `file-upload-security-manual.spec.ts` anywhere; only `file-upload-security.spec.ts` exists (referenced by `test:upload-security` and `test:e2e:sequential`).
2. Real sharding is invoked by CI directly, not through `test:e2e:shard`: `.github/workflows/playwright.yml` uses a matrix `shardIndex: [1,2,3,4]`, `shardTotal: [4]` and runs `npx playwright test --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}` (playwright.yml:248). So `test:e2e:shard` has no CI consumer and is dead/broken as written.
3. Because CI does not depend on `test:e2e:shard`, the safest fix is either to delete it or to make it a parameter-accepting helper for local runs (`playwright test --shard=$npm_config_shard` style is awkward in npm; a documented `npx playwright test --shard=1/4` is clearer).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — No package script references a missing file (Priority: P1)

As a contributor, every script in `package.json` either runs or is removed; none silently fails because it points at a deleted/renamed spec.

**Why this priority**: A script that cannot run is a trap for contributors and CI.

**Acceptance Scenarios**:
1. **Given** `test:upload-security:manual`, **When** resolved, **Then** it targets an existing spec (`file-upload-security.spec.ts`) or is removed.
2. **Given** `test:e2e:shard`, **When** resolved, **Then** it either includes a valid `--shard=N/M` form (or is removed) so it does not error on invocation.

### Edge Cases

- If `--headed` manual upload testing is still wanted, the fix keeps a `:manual` variant pointing at the real spec; if the manual variant is obsolete, remove it rather than repoint it — decide based on whether a headed manual run is still useful.
- Removing `test:e2e:shard` MUST NOT affect CI (CI shards via the matrix, not this script) — verified above.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `test:upload-security:manual` MUST either be repointed to `tests/e2e/specs/file-upload-security.spec.ts` (keeping `--headed`) or removed if a manual headed run is no longer needed.
- **FR-002**: `test:e2e:shard` MUST either be removed or rewritten to a valid, documented `--shard=N/M` invocation; it MUST NOT be left as bare `playwright test --shard`.
- **FR-003**: Any stale comments in `package.json`/scripts referencing the removed/renamed items MUST be cleaned up.
- **FR-004**: CI sharding behavior (playwright.yml matrix) MUST remain unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every `package.json` script resolves to an existing target or is removed (a quick audit script or manual check confirms no missing spec paths).
- **SC-002**: `npm run test:e2e:shard` (if kept) no longer errors on argument parsing.
- **SC-003**: CI (playwright.yml) still runs its 4-way shard matrix and is green.

## Out of Scope

- Rewriting the Playwright CI sharding strategy (that is the domain of issue #185's README accuracy).
- Adding new test suites.
