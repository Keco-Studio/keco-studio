# Feature Specification: Rewrite outdated .github/workflows/README.md (issue #185)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #185 — `.github/workflows/README.md` references non-existent files and says Playwright CI runs serially with sharding "not yet done," but `playwright.yml` already uses a 4-way sharded matrix.

## Overview

The workflows README describes a CI setup that no longer matches the actual workflows. Verified drift below.

### Investigation findings — drift table (verified 2026-07-09)

Actual workflow files present in `.github/workflows/`: `ci.yml`, `deploy-vercel.yml`, `playwright.yml`, `sync-to-personal.yml`, `README.md`.

| README claim | Reality |
|---|---|
| References `playwright-advanced.yml` (lines 27, 42, 89, 105) | File does not exist. |
| References `playwright-parallel.yml` (lines 52, 73, 90, 116) | File does not exist. |
| References `docs/PLAYWRIGHT_CI_OPTIMIZATION.md` (lines 69, 111, 148) | Verify existence — appears missing. |
| References `CI_TEST_GUIDE.md` (line 149) | Verify existence — appears missing. |
| Implies current `playwright.yml` runs serially / sharding "not yet done" | `playwright.yml` uses a matrix `shardIndex: [1,2,3,4]`, `shardTotal: [4]` (lines 15-17) and runs `npx playwright test --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}` (line 248) — already 4-way sharded. |

So the README both names files that don't exist and mis-describes the real, already-sharded `playwright.yml`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Workflows README matches actual CI (Priority: P2)

As a contributor, the workflows README lists only the workflows that exist and correctly states that Playwright runs as a 4-way sharded matrix.

**Why this priority**: Docs-only; misleading CI docs waste debugging time.

**Independent Test**: Diff every file the README names against `ls .github/workflows/` and against the real `playwright.yml`; the rewritten README references only existing files and describes the real matrix.

**Acceptance Scenarios**:
1. **Given** the rewritten README, **When** each referenced workflow file is checked, **Then** all exist (`ci.yml`, `deploy-vercel.yml`, `playwright.yml`, `sync-to-personal.yml` — subject to issue #187's removal of the last).
2. **Given** the Playwright section, **When** read, **Then** it states the 4-way sharded matrix accurately (no "serial / not yet done" claim).
3. **Given** referenced docs (`PLAYWRIGHT_CI_OPTIMIZATION.md`, `CI_TEST_GUIDE.md`), **When** checked, **Then** dead links are removed or the docs are created.

### Edge Cases

- Issue #187 may remove `sync-to-personal.yml`; coordinate so the README does not list a just-deleted workflow.
- If any referenced doc is intended to exist, decide create-vs-delete-link explicitly rather than leaving a dead link.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The README MUST reference only workflow files that exist in `.github/workflows/`.
- **FR-002**: The Playwright section MUST accurately describe the current 4-way sharded matrix (`shardIndex 1..4`, `shardTotal 4`, `--shard=N/M`).
- **FR-003**: All broken doc links (`playwright-advanced.yml`, `playwright-parallel.yml`, `PLAYWRIGHT_CI_OPTIMIZATION.md`, `CI_TEST_GUIDE.md`, etc.) MUST be removed or resolved to existing files.
- **FR-004**: The README MUST stay consistent with issue #187's disposition of `sync-to-personal.yml`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every file/path referenced in the README exists (verified by grep/ls).
- **SC-002**: The README's Playwright description matches `playwright.yml` (sharded matrix).
- **SC-003**: No dead links remain.

## Out of Scope

- Changing CI behavior itself (only documenting it).
- The seed-doc conflict (issue #186, spec 028) and personal-sync removal (issue #187, spec 029), though this README must stay consistent with them.
