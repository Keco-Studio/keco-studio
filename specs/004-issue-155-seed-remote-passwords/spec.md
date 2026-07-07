# Feature Specification: Remove hardcoded remote seed passwords (issue #155)

**Feature Branch**: `git-issues-fix`
**Created**: 2026-07-07
**Status**: Draft
**Input**: GitHub issue #155 — seed-remote.sql creates public mailinator accounts with a hardcoded password on the remote instance.

## Overview

`supabase/seed-remote.sql` creates/resets seven `*@mailinator.com` accounts on the **remote** Supabase instance with the bcrypt hash of the literal password `Password123!` (10 occurrences, e.g. lines 27, 52, 182). Mailinator inboxes are public, and `supabase/config.toml` sets `minimum_password_length = 6` and `enable_confirmations = false` (lines 169, 203). Anyone who reads this public repo can log into the deployed environment as these seeded users.

This spec removes the hardcoded credential from the repo so the seed script sources its password from an environment variable at run time, restricts remote seeding to an explicit opt-in, and hardens the auth config. Deleting/disabling the already-created remote accounts is a manual ops action (out of scope here) but must be done.

## User Scenarios & Testing *(mandatory)*

### Scenario 1 — Repo contains no usable remote credential (Priority: P1)

As a security reviewer reading the repository, I must not be able to derive a working login for the deployed environment from any committed file.

**Root cause**: `supabase/seed-remote.sql` embeds `crypt('Password123!', gen_salt('bf'))` at 10 sites, so the plaintext password is public in git history and current tree.

**Acceptance Scenarios**:
1. **Given** the seed-remote SQL, **When** it is scanned for password literals, **Then** no hardcoded plaintext password (`Password123!` or any literal) is present; the password is injected from an env var (e.g. `:'seed_password'` psql variable or a `SEED_TEST_PASSWORD` env) at execution time.
2. **Given** `scripts/seed-remote.sh`, **When** run without an explicit seed-password env var, **Then** it refuses to run (exits non-zero) rather than falling back to a default.

### Scenario 2 — Remote seeding is opt-in only (Priority: P2)

As an operator, remote test-user seeding must require an explicit, intentional flag so it can never run by accident from CI or a stray script.

**Acceptance Scenarios**:
1. **Given** `scripts/seed-remote.sh`, **When** invoked, **Then** it requires both `SUPABASE_DB_URL` (already required) and a non-empty `SEED_TEST_PASSWORD`, and prints a clear message otherwise.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `supabase/seed-remote.sql` MUST NOT contain any hardcoded plaintext password. It MUST read the password from a psql variable (e.g. `:'seed_password'`) bound at invocation.
- **FR-002**: `scripts/seed-remote.sh` MUST require a non-empty `SEED_TEST_PASSWORD` env var and pass it to psql via `-v seed_password="$SEED_TEST_PASSWORD"`; it MUST exit non-zero with guidance if unset.
- **FR-003**: Local `supabase/seed.sql` (local/CI only, non-public target) MAY keep the fixed `Password123!` used by the test harness/E2E — it never touches a public remote instance. This MUST be documented in the file header.
- **FR-004**: `supabase/config.toml` SHOULD raise `minimum_password_length` (e.g. to 12) for the auth config; enabling confirmations is noted but MAY stay off for CI compatibility.

### Non-Functional Requirements

- **NFR-001**: No change to local dev / CI seeding behavior (they use the local instance and the documented local password).
- **NFR-002**: Changes must not break the Playwright workflow, which seeds the local Supabase.

## Success Criteria *(mandatory)*

- **SC-001**: A unit test (jest) reads `supabase/seed-remote.sql` and asserts it contains no `Password123!` literal and instead references the psql variable placeholder.
- **SC-002**: A unit test asserts `scripts/seed-remote.sh` references `SEED_TEST_PASSWORD` and does not contain a hardcoded password.
- **SC-003**: CI (lint + unit + build) green; Playwright green (local seeding unaffected).

## Out of Scope

- Deleting/disabling the mailinator accounts already created on the remote instance — a manual ops action that MUST be performed but cannot be done from the repo.
- Rotating any other credentials.
- Enabling email confirmations in production config (tracked separately).
