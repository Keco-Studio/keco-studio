# Feature Specification: Resolve duplicate RLS-performance migration (issue #179)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #179 — `20260109000001_optimize_rls_performance.sql` and `20260109000002_optimize_rls_performance.sql` are byte-identical; filenames enter Supabase migration history, so blind deletion is unsafe.

## Overview

The two migrations under `supabase/migrations/` are byte-for-byte identical (verified 2026-07-09 with `diff` → no differences). Both create RLS-supporting indexes.

### Investigation findings (verified 2026-07-09)

1. `diff 20260109000001_optimize_rls_performance.sql 20260109000002_optimize_rls_performance.sql` reports no differences — identical content, purpose "Add database indexes to improve RLS policy query performance."
2. The statements use `CREATE INDEX IF NOT EXISTS ...` (e.g. `idx_project_collaborators_permission_check`). So applying the file twice is **idempotent at the SQL level** — the second run creates nothing new. The harm is not runtime breakage but migration-history clutter and confusion.
3. Supabase records each applied migration by filename/timestamp in `supabase_migrations.schema_migrations`. If `...000002` has already been applied in an environment, deleting the file from the repo can cause drift/checksum mismatches on future `supabase db push`/reset. Filenames are effectively immutable history (same principle as spec 014).
4. Therefore the resolution is audit-first per environment, not blind deletion.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Know which environments applied the duplicate before touching it (Priority: P1)

As an operator, before removing either file I can see, per environment, whether `...000001` and/or `...000002` are recorded as applied, so I choose a safe path.

**Why this priority**: Deleting a migration already in history risks reset/drift errors; the audit gates the decision.

**Independent Test**: Query `supabase_migrations.schema_migrations` (or `supabase migration list`) in each environment and record which of the two versions are present.

**Acceptance Scenarios**:
1. **Given** an environment, **When** the audit runs, **Then** it reports whether each of the two versions is applied.
2. **Given** neither is applied anywhere (fresh), **When** resolving, **Then** the redundant file may be deleted outright.
3. **Given** one/both already applied somewhere, **When** resolving, **Then** a compensating approach is used (keep both as no-ops, or replace `...000002` content with a documented no-op comment) rather than deleting a recorded filename.

### Edge Cases

- A fresh `supabase db reset` replays every file in order; two identical idempotent files simply run twice harmlessly — acceptable but still worth removing the redundancy where safe.
- Editing `...000001` in place is forbidden (it is applied history); only the redundant later file is a candidate for change/removal.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The resolution MUST begin by auditing, per environment, whether each migration version is recorded as applied (via `supabase migration list` or the `schema_migrations` table).
- **FR-002**: If neither version is applied in any environment, the redundant `...000002` file MAY be deleted.
- **FR-003**: If either version is already applied in any environment, `...000002` MUST NOT be silently deleted; instead keep it (idempotent no-op on replay) or replace its body with a documented no-op comment explaining the duplication, preserving the filename in history.
- **FR-004**: `...000001` MUST remain unedited (applied history).
- **FR-005**: The outcome (which environments had which versions, and the chosen action) MUST be recorded in the PR/migration notes.

### Non-Functional Requirements

- **NFR-001**: No index is dropped; the indexes these migrations create MUST remain present after the resolution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The per-environment applied-state of both versions is recorded in the PR.
- **SC-002**: After the change, a fresh `supabase db reset` succeeds and all `idx_*` indexes from the migration exist.
- **SC-003**: No migration drift/checksum error on `supabase db push` against environments that had the file applied.

## Out of Scope

- Changing the actual indexes or RLS policies.
- Auditing unrelated migrations for duplication (this spec covers only the `optimize_rls_performance` pair).
