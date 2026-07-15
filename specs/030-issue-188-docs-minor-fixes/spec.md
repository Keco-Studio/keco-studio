# Feature Specification: Documentation minor fixes (issue #188)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #188 — `.cursor/rules/specify-rules.mdc` says `npm test && npm run lint` but package.json has no `test` script (only `test:unit`); `docs/architecture/README.md` has an expired next-review date and omits two collaboration docs from its index.

## Overview

Three small, independent documentation corrections. All verified below.

### Investigation findings (verified 2026-07-09)

1. **Wrong command reference:** `.cursor/rules/specify-rules.mdc:30` — Commands section reads `npm test && npm run lint`. `package.json` has **no** `test` script; the unit-test script is `test:unit` (`"test:unit": "jest"`). So `npm test` would fail. Correct reference is `npm run test:unit && npm run lint` (or `npm run validate`, which chains lint+typecheck+test:unit+build).
2. **Expired review date:** `docs/architecture/README.md:195` — "📅 **Next review**: 2026-04-30 (suggested)". Today is 2026-07-09, so the suggested next-review date is past. It should be updated to a future date.
3. **Incomplete doc index:** `docs/architecture/README.md` "Core Documents" index (lines 13-32) lists only three docs: `ARCHITECTURE.md`, `OPTIMIZATION_RECOMMENDATIONS.md`, `FILE_CLEANUP_LIST.md`. It omits the two collaboration docs that exist in the same directory: `COLLABORATION_OVERVIEW.md` and `collaboration-table-unified-design.md` (both confirmed present).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Command reference actually works (Priority: P3)

As a contributor following the rules doc, the commands it lists run successfully (no `npm test` that does not exist).

**Acceptance Scenarios**:
1. **Given** `specify-rules.mdc`, **When** the Commands section is read, **Then** it references `test:unit` (e.g. `npm run test:unit && npm run lint`) or `npm run validate`, not `npm test`.

### User Story 2 — Architecture README index is complete and current (Priority: P3)

As a contributor, the architecture doc index lists all core docs and shows a future review date.

**Acceptance Scenarios**:
1. **Given** the README index, **When** read, **Then** it includes `COLLABORATION_OVERVIEW.md` and `collaboration-table-unified-design.md` entries.
2. **Given** the review date, **When** read, **Then** it is a future date (not 2026-04-30).

### Edge Cases

- Issue #184 (spec 026) may rewrite/archive the two collaboration docs; the index entries added here MUST stay consistent with that outcome (link to the rewritten doc, or mark archived). Coordinate ordering.
- If `npm run validate` is preferred over `test:unit && lint`, pick one and use it consistently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `.cursor/rules/specify-rules.mdc` Commands section MUST reference existing npm scripts (`npm run test:unit && npm run lint`, or `npm run validate`), not `npm test`.
- **FR-002**: `docs/architecture/README.md` next-review date MUST be updated to a future date.
- **FR-003**: `docs/architecture/README.md` core-docs index MUST include entries for `COLLABORATION_OVERVIEW.md` and `collaboration-table-unified-design.md`, consistent with issue #184's disposition of those docs.
- **FR-004**: Corrections MUST reference only files/scripts that actually exist at the time of the change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every command in `specify-rules.mdc` resolves to a real `package.json` script.
- **SC-002**: The architecture README index lists all five core docs and shows a future review date.
- **SC-003**: No broken links introduced (referenced docs exist).

## Out of Scope

- Rewriting the content of the collaboration docs (issue #184, spec 026) or `ARCHITECTURE.md` (issue #183, spec 025).
- Broader `.cursor/rules` restructuring.
