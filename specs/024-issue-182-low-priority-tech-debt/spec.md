# Feature Specification: Low-priority tech debt cleanup (issue #182)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #182 — three items: (a) `check-no-explicit-any.ts` duplicates an ESLint rule and is a fragile regex scan; (b) `tsconfig.api.json` exists but is not run by CI; (c) `FILE_CLEANUP_LIST.md` is a stale cleanup doc.

## Overview

Three independent, low-priority debt items. Each verified below.

### Investigation findings (verified 2026-07-09)

**(a) `scripts/check-no-explicit-any.ts`** — invoked by `package.json` as `"lint:types": "tsx scripts/check-no-explicit-any.ts"`, which is chained into `"lint": "eslint . && npm run lint:types"`. Meanwhile `eslint.config.mjs` already enforces `@typescript-eslint/no-explicit-any` (`'error'` at line 41 for one scope, `'warn'` at line 51 for another). So the custom regex scanner overlaps the ESLint rule. A regex scanner is fragile (misses type-position anys, false-positives in strings/comments) compared to the type-aware ESLint rule. Decision needed: drop the script and rely on ESLint (raising the `'warn'` scope to `'error'` if the script currently catches more), or keep it with a documented reason.

**(b) `tsconfig.api.json` not run by CI** — confirmed no `typecheck:api`/`tsconfig.api` reference in `package.json`/`.github/`/`scripts/`. This is the **same** concern as issue #175. To avoid duplicate/conflicting plans, the CI-wiring work is owned by `specs/017-issue-175-tsconfig-api-ci/spec.md`; this spec only cross-references it and does not restate the implementation.

**(c) `docs/architecture/FILE_CLEANUP_LIST.md`** — exists (~27 KB, dated in the `001-architecture-review` doc set). It is a point-in-time cleanup catalog; several items it lists overlap issues #177/#178/#180 and are being executed there, so the doc is stale as a living reference. Decision: archive or delete, or convert to a pointer to the issue-driven cleanup.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — No duplicated/fragile any-check (Priority: P3)

As a maintainer, `no-explicit-any` is enforced by one authoritative mechanism, not a fragile regex duplicating ESLint.

**Acceptance Scenarios**:
1. **Given** the ESLint rule already flags explicit `any`, **When** the redundant script is removed (or justified), **Then** `npm run lint` still fails on an introduced explicit `any` in the enforced scope.
2. **Given** the script currently catches cases ESLint's `'warn'` scope does not, **When** removing it, **Then** that scope is promoted to `'error'` so coverage is not lost.

### User Story 2 — Stale cleanup doc no longer misleads (Priority: P3)

As a contributor, `FILE_CLEANUP_LIST.md` is either archived or clearly marked superseded by the issue-driven cleanups, so it is not mistaken for current guidance.

**Acceptance Scenarios**:
1. **Given** the doc, **When** resolved, **Then** it is archived/deleted or annotated as superseded with pointers to issues #177/#178/#180.

### Edge Cases

- Removing `lint:types` from the `lint` chain MUST NOT reduce effective any-coverage — verify by introducing a test `any` before/after.
- `FILE_CLEANUP_LIST.md` is referenced by `docs/architecture/README.md` (index entry #3); removing it requires updating that index (coordinate with issue #188/#183).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `check-no-explicit-any.ts` overlap MUST be resolved: either remove the script and its `lint:types` chaining (promoting any ESLint scope needed to keep coverage), or keep it with a documented justification.
- **FR-002**: If the script is removed, `npm run lint` MUST still fail on an explicit `any` that was previously caught.
- **FR-003**: Item (b) MUST be handled via spec 017 (issue #175); this spec MUST NOT introduce a competing `typecheck:api` plan — only reference it.
- **FR-004**: `FILE_CLEANUP_LIST.md` MUST be archived, deleted, or annotated as superseded, and any index reference (`docs/architecture/README.md`) updated accordingly.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `no-explicit-any` coverage is verified equivalent-or-better after the change (introduce/remove a test `any`).
- **SC-002**: `FILE_CLEANUP_LIST.md`'s status is unambiguous and its README index entry is consistent.
- **SC-003**: `npm run lint` and `npm run test:unit` are green.

## Out of Scope

- The full `tsconfig.api.json` CI wiring (issue #175, spec 017).
- Executing the file/dep deletions the cleanup doc lists (issues #177/#178/#180).
