# Feature Specification: Remove deprecated personal-sync workflow (issue #187)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #187 — `.github/workflows/sync-to-personal.yml` is permanently disabled via `if: false` but remains in the repo; it once `--force` pushed to a personal fork `xzy1124/keco-studio`. Personal-infra residue unsuitable for team CI.

## Overview

A disabled workflow that force-pushed the repo to a personal fork remains in the shared repository. Verified below.

### Investigation findings (verified 2026-07-09)

1. `.github/workflows/sync-to-personal.yml:19` — job guard begins with `if: false && github.repository == 'Caerulean-ai/keco-studio' && ...`. The leading `if: false &&` makes the whole condition permanently false, so the job never runs.
2. It force-pushes to a personal fork:
   - line 37-38: adds/sets remote `personal` → `https://x-access-token:${{ secrets.PERSONAL_GITHUB_TOKEN }}@github.com/xzy1124/keco-studio.git`.
   - line 66: `git push personal $CURRENT_BRANCH:main --force`.
3. It depends on repo secret `PERSONAL_GITHUB_TOKEN` (lines 37, 38, 46). Grep finds this secret used **only** in `sync-to-personal.yml` (no other workflow references it), so removing the workflow makes the secret orphaned.
4. This is personal infrastructure (a specific individual's fork), inappropriate for a shared team CI repo, and a latent force-push risk if ever re-enabled.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — No personal force-push workflow in shared CI (Priority: P2)

As a maintainer, the shared repo contains no workflow that force-pushes to an individual's personal fork, removing both clutter and a latent destructive-action risk.

**Why this priority**: Infra hygiene + risk reduction; the workflow is already inert (`if: false`) so removal is low-risk.

**Independent Test**: Delete the file; confirm no other workflow references it or `PERSONAL_GITHUB_TOKEN`; CI still passes.

**Acceptance Scenarios**:
1. **Given** `sync-to-personal.yml` deleted, **When** CI runs, **Then** no workflow references the removed file or `PERSONAL_GITHUB_TOKEN`, and CI is green.
2. **Given** the removal, **When** the workflows README (#185) is checked, **Then** it no longer lists `sync-to-personal.yml`.

### Edge Cases

- Removing the repo **secret** `PERSONAL_GITHUB_TOKEN` is a GitHub-settings action outside the codebase; this spec flags it as a manual owner action (recommended once the workflow is gone), not a code change.
- If anyone still relies on the personal-fork mirror, that mirroring should move to personal infrastructure (a local git remote / personal Action), not the shared repo — note this in the PR.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `.github/workflows/sync-to-personal.yml` MUST be deleted from the shared repo (it is permanently disabled and force-pushes to a personal fork).
- **FR-002**: The PR MUST confirm no other workflow/script references the deleted file or `PERSONAL_GITHUB_TOKEN`.
- **FR-003**: The PR MUST flag removal of the now-orphaned `PERSONAL_GITHUB_TOKEN` repo secret as a recommended manual owner action (cannot be done in code).
- **FR-004**: The workflows README (issue #185, spec 027) MUST be kept consistent — no reference to the deleted workflow.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `sync-to-personal.yml` no longer exists; grep for `PERSONAL_GITHUB_TOKEN` and `sync-to-personal` in `.github/` returns nothing.
- **SC-002**: CI is green after removal.
- **SC-003**: The secret-cleanup manual action is recorded in the PR.

## Out of Scope

- Setting up any replacement personal-mirror mechanism.
- Removing the GitHub secret itself (manual owner action, flagged not performed).
