# Feature Specification: Resolve CI seed doc conflict + broken README links (issue #186)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #186 — `scripts/README.md` says GitHub Actions auto-runs `npm run seed:api`, but `playwright.yml` comments say it's not needed because `supabase/seed.sql` handles it; root `README.md` links to non-existent `docs/CI_SETUP.md` and `docs/ENVIRONMENT_SETUP.md`.

## Overview

Two documentation defects: a contradiction about how CI seeds test data, and two dead links in the root README.

### Investigation findings (verified 2026-07-09)

1. **Contradiction:**
   - `scripts/README.md:43` — "The GitHub Actions workflow will automatically run `npm run seed:api` before tests."
   - `.github/workflows/playwright.yml:227-228` — comments: "Test users are automatically seeded via `supabase/seed.sql` when supabase starts / No need to run seed:api script for local Supabase."
   - These directly conflict. The workflow comments are the more authoritative signal (they live next to the actual CI steps), indicating CI relies on `supabase/seed.sql`, not `seed:api`. The implementer MUST confirm by inspecting the full `playwright.yml` job (is `npm run seed:api` actually invoked anywhere in it?) and whether `supabase/seed.sql` exists and seeds the test users.
2. **Broken links (root `README.md:6-7`):**
   - `[CI/GitHub Actions Setup Guide](docs/CI_SETUP.md)` — target missing.
   - `[Environment Setup](docs/ENVIRONMENT_SETUP.md)` — target missing.
3. `scripts/README.md` still documents `seed:api` as the recommended path (lines 3, 14, 16) with a note that the alternate seeding "may fail in GitHub Actions due to IPv6/network issues" (line 57) — so `seed:api` may still be a valid *local/manual* path even if CI uses `seed.sql`. The fix must distinguish "CI behavior" from "local/manual behavior" rather than flatly deleting `seed:api` docs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Seed docs state the true CI behavior (Priority: P2)

As a contributor, the docs unambiguously say how CI seeds test data (via `supabase/seed.sql`) versus how to seed locally (`seed:api`), with no contradiction.

**Why this priority**: A contradiction makes contributors distrust the docs and mis-debug CI failures.

**Independent Test**: Read `playwright.yml` end-to-end to establish whether `seed:api` runs in CI; update `scripts/README.md` to match; confirm the two docs no longer contradict.

**Acceptance Scenarios**:
1. **Given** the actual `playwright.yml`, **When** the true seed mechanism is determined, **Then** `scripts/README.md` states it correctly (CI = `seed.sql`, local/manual = `seed:api`, if that is the reality).
2. **Given** the root README, **When** the two links are checked, **Then** each either points to a created doc or is removed.

### Edge Cases

- If `seed:api` IS still invoked somewhere in CI, the doc must reflect that instead — the implementer follows the evidence, not this spec's assumption.
- If `CI_SETUP.md`/`ENVIRONMENT_SETUP.md` content is genuinely useful, creating them may be preferable to deleting the links; decide explicitly.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The true CI seeding mechanism MUST be determined by reading `.github/workflows/playwright.yml` and confirming whether `supabase/seed.sql` seeds test users.
- **FR-002**: `scripts/README.md` MUST be corrected so its CI statement matches reality and clearly separates CI seeding from local/manual `seed:api` usage (retaining `seed:api` docs if it remains the local path).
- **FR-003**: The two dead links in root `README.md` (`docs/CI_SETUP.md`, `docs/ENVIRONMENT_SETUP.md`) MUST be resolved by either creating the docs or removing the links.
- **FR-004**: After the fix, no doc claims a CI behavior that the workflow does not perform.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `scripts/README.md` and `playwright.yml` no longer contradict each other on seeding.
- **SC-002**: Both root-README links resolve (target exists) or are removed.
- **SC-003**: The determined CI seed behavior is stated in the PR notes with the evidence (line references).

## Out of Scope

- Changing the actual seeding mechanism or `supabase/seed.sql` content.
- The workflows README rewrite (issue #185, spec 027).
