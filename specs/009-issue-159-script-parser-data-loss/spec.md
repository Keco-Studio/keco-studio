# Feature Specification: Script parser — stop silent data loss & misclassification (issue #159)

**Feature Branch**: `git-issues-fix`
**Created**: 2026-07-07
**Status**: Draft
**Input**: GitHub issue #159 — silent data loss and misclassification (curly quotes, colon fallback, >3 options dropped).

## Overview

The script parser (`src/lib/script-parser/`) silently loses or misclassifies data in three areas. One is confirmed by reading the code (options beyond 3 are hard-dropped); the other two are asserted by the issue and MUST first be reproduced with a failing test before fixing, since the current code already handles some curly-quote and full/half-width-colon cases. This spec follows TDD: add an input→expected reproduction test per defect, confirm the real behavior, then fix only what actually breaks. The colocated parser tests run under jest (`jest.config.mjs` roots include `src/`).

## User Scenarios & Testing *(mandatory)*

### Scenario 1 — A 4th+ option is not dropped (Priority: P1, confirmed)

**Root cause**: `src/lib/script-parser/postProcess.ts:73` iterates `for (idx = 0; idx < Math.min(opts.length, 3); idx++)`, so a node with 4+ options silently keeps only the first 3 (fields `option0/1/2` only, lines 24-29, 85-93).

**Acceptance Scenarios**:
1. **Given** a dialogue node with 4 options, **When** parsed, **Then** no option is silently discarded — either all are represented, or the excess is surfaced as an explicit warning/diagnostic rather than dropped without a trace.

### Scenario 2 — Curly/smart quotes are handled (Priority: P2, reproduce first)

**Root cause**: `parser.ts:21` / `classifier.ts:44` define `QUOTES = '"\'""\'""「」'`, which already includes some curly quotes. The issue claims curly quotes still cause loss; the exact failing input must be captured before asserting a fix.

**Acceptance Scenarios**:
1. **Given** a line quoted with `“ … ”` / `‘ … ’`, **When** parsed, **Then** the quoted content is extracted identically to straight-quoted content (verified by a reproduction test; if already correct, the test documents/guards it).

### Scenario 3 — Colon fallback does not misclassify (Priority: P2, reproduce first)

**Root cause**: `classifier.ts:49-51` `findColon` picks the first of full-width `：` or half-width `:`; certain lines (e.g. a time `12:30`, or a colon inside content) may be misread as a speaker/label delimiter.

**Acceptance Scenarios**:
1. **Given** a line whose colon is content (not a speaker/label separator), **When** parsed, **Then** it is not misclassified as speaker:dialogue (verified by a reproduction test).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A dialogue node with more than 3 options MUST NOT silently drop the extras. Preferred: support additional options; minimum acceptable: emit an explicit diagnostic so loss is visible. (Decision recorded during implementation based on the SimLite schema's option capacity.)
- **FR-002**: Add a failing reproduction test for curly/smart quotes; if it fails, normalize/handle all common curly quote pairs (`“” ‘’ 「」`) equivalently to straight quotes; if it already passes, keep the test as a regression guard.
- **FR-003**: Add a failing reproduction test for the colon-fallback misclassification; fix `findColon`/classification so a content colon is not treated as a delimiter; keep the test as a guard.
- **FR-004**: All existing parser test suites (`parser.e2e/structured/superset.test.ts`) MUST stay green.

### Non-Functional Requirements

- **NFR-001**: No change to correctly-parsed inputs' output shape.
- **NFR-002**: Fixes localized to `parser.ts` / `classifier.ts` / `postProcess.ts`.

## Success Criteria *(mandatory)*

- **SC-001**: A jest test with a 4-option input shows no silent drop (all represented or explicit diagnostic).
- **SC-002**: A jest test proves curly-quoted content parses identically to straight-quoted content.
- **SC-003**: A jest test proves a content-colon line is not misclassified.
- **SC-004**: CI (lint + unit incl. colocated parser suites + build) green.

## Out of Scope

- Redesigning the SimLite option schema to hold arbitrarily many options (only prevent silent loss).
- Broader grammar/format changes beyond the three named defects.
