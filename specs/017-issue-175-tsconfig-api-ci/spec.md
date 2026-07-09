# Feature Specification: Wire tsconfig.api.json into CI (issue #175)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #175 — `tsconfig.api.json` is a stricter TS config for API routes but no npm script or CI step runs it, so it cannot prevent future API type regressions.

## Overview

`tsconfig.api.json` (verified 2026-07-09) extends the base config and tightens two options for API routes only:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noImplicitAny": true, "strictNullChecks": true },
  "include": ["src/app/api/**/*.ts", "src/app/api/**/*.tsx"]
}
```

### Investigation findings (verified 2026-07-09)

1. A repo-wide grep for `tsconfig.api` and `typecheck:api` across `package.json`, `.github/`, and `scripts/` returns **no references** — the file is never executed. It is effectively decorative.
2. `package.json` has a general `"typecheck": "tsc --noEmit"` (uses base `tsconfig.json`) but nothing that points `tsc` at `tsconfig.api.json`.
3. Because the stricter config is never run, an API route can introduce an implicit `any` or a null-unsafe access and CI stays green, defeating the config's purpose.
4. Issue #182 also mentions `tsconfig.api.json`; this spec owns the CI-wiring decision, and #182 (spec 024) should reference this spec rather than duplicate it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — API type regressions fail CI (Priority: P1)

As a maintainer, when an API route violates the stricter API type rules, CI fails, so the guarantee `tsconfig.api.json` encodes is actually enforced.

**Why this priority**: An unenforced config gives false confidence; wiring it is the whole point of the issue.

**Independent Test**: Add a `typecheck:api` script, introduce a temporary implicit-any in an API route, and confirm the script exits non-zero (then revert).

**Acceptance Scenarios**:
1. **Given** `typecheck:api` exists, **When** all API routes satisfy the stricter rules, **Then** it exits 0.
2. **Given** an API route with an implicit `any` or null-unsafe access, **When** `typecheck:api` runs, **Then** it exits non-zero and CI fails.
3. **Given** the CI workflow, **When** it runs, **Then** `typecheck:api` executes as a required step.

### Edge Cases

- If the current API routes do not yet pass the stricter config, the wiring MUST surface those errors; fixing pre-existing violations (or explicitly baselining them) is part of adoption, not a silent skip.
- If the team decides not to enforce yet, the alternative (see FR-005) is to explicitly document the config as non-enforced rather than leave it silently dead.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A `typecheck:api` npm script MUST run `tsc --noEmit -p tsconfig.api.json`.
- **FR-002**: `typecheck:api` MUST be executed in CI (add to the relevant `.github/workflows/*.yml` typecheck/lint job) so violations block merges.
- **FR-003**: `typecheck:api` SHOULD be included in the local `validate` script alongside `typecheck` so contributors catch API type errors before pushing.
- **FR-004**: Adoption MUST first confirm the current API routes pass `tsconfig.api.json`; any pre-existing violations MUST be fixed (preferred) or explicitly tracked before the CI gate is turned on, so the gate does not land red.
- **FR-005**: If (and only if) the team elects not to enforce now, `tsconfig.api.json` MUST carry a comment/README note stating it is not yet enforced and why — the file MUST NOT remain silently unused.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `npm run typecheck:api` exists and passes on the current codebase.
- **SC-002**: A deliberately-introduced API implicit-any makes `typecheck:api` (and CI) fail; reverting restores green.
- **SC-003**: CI shows `typecheck:api` as an executed step.

## Out of Scope

- Broadening the stricter options to the whole codebase.
- The `check-no-explicit-any.ts` / ESLint duplication question (that is issue #182, spec 024).
