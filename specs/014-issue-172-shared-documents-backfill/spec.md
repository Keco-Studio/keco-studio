# Feature Specification: Resolve inaccessible legacy shared_documents after RLS scoping (issue #172)

**Feature Branch**: `issue-fix-172-188` (or a dedicated `git-issues-fix` follow-up)
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #172 — `20260707000000_scope_shared_documents_rls.sql` added a nullable `project_id` to `shared_documents` and rebuilt RLS to require project membership, but performed no backfill. Legacy rows have `project_id = NULL`, so the new owner/collaborator predicates evaluate false for everyone, making pre-existing shared documents unreadable by all users.

## Overview

Migration `20260707000000_scope_shared_documents_rls.sql` (the fix for #152) replaced the blanket `auth.role() = 'authenticated'` policies on `public.shared_documents` with project-membership predicates:

```sql
USING (
  public.is_project_owner(project_id, auth.uid())
  OR public.is_accepted_collaborator(project_id, auth.uid())
)
```

The added `project_id` column is nullable and was **not backfilled**. For any row where `project_id IS NULL`, both helper predicates return false, so the row is invisible and immutable to every user — including its original `owner_id`. This is the deliberate deny-by-default behavior recorded in spec 003 (#152) FR-005, but issue #172 flags it as an unresolved data-access risk for any rows that existed before the migration ran.

### Investigation findings (verified 2026-07-09)

These findings shape the decision and MUST be re-confirmed against each real environment before acting:

1. **`shared_documents` has no live read/write path.** The only code touching the table is `src/lib/services/sharedDocumentService.ts`, and a repository-wide search finds no importers of it. Real collaborative editing runs through online Yjs sync, not this table. In-flight collaboration data does not depend on these rows.
2. **`doc_id` carries no recoverable project linkage.** It is an arbitrary `text unique` value; a legacy row exposes no reliable column, foreign key, or naming convention from which the correct `project_id` can be derived automatically. An unconditional SQL backfill therefore cannot safely infer ownership — it could only guess, which risks cross-tenant exposure (assigning another tenant's project) that is worse than the current denial.
3. **Migration filenames are historical and immutable.** `20260707000000_scope_shared_documents_rls.sql` may already be recorded in one or more environments' Supabase migration history. It MUST NOT be edited in place or deleted; any correction ships as a new forward migration (consistent with spec 003 FR-004).
4. **The current deny-by-default is already asserted as intended.** `tests/unit/database/shared-documents.rls.behavior.test.ts` ("denies rows without project_id by default") treats a NULL-`project_id` row as correctly unreadable. Any change here must keep NULL rows unreadable by non-members and must not reopen the #152 cross-tenant hole.

### Decision framing

Because the table is dead code and `project_id` is not derivable, the correct resolution is **audit-first**, not blind-backfill:

- If an environment has **zero** legacy `project_id IS NULL` rows (expected, since the table is unused), the issue is a documentation/verification gap: record that no data is affected and codify the guarantee so future rows cannot be inserted without a project.
- If an environment has **some** NULL rows, they cannot be auto-mapped to a project. Each must be resolved by an explicit, owner-approved decision: delete (safe, since the table is unused and data is orphaned) or, only where an operator can supply the correct mapping, backfill with an explicitly provided `project_id`.

The recommended long-term guarantee is to make `project_id` `NOT NULL` so no future row can become inaccessible — done only after confirming no NULL rows remain in any environment.

## User Scenarios & Testing *(mandatory)*

### Scenario 1 — Audit reveals affected legacy rows before any destructive action (Priority: P1)

As an operator resolving this issue, before deleting or altering anything I can enumerate exactly which `shared_documents` rows have `project_id IS NULL` in each environment, so the resolution is driven by real data rather than assumption.

**Why this priority**: Every downstream decision (do nothing, delete, or backfill) depends on knowing whether affected rows actually exist. Acting without the audit risks either deleting live data or leaving a real access hole unaddressed.

**Independent Test**: Run the audit query with the service role against a target database and confirm it returns an accurate count and the `id`/`doc_id`/`owner_id`/`created_at` of every NULL-`project_id` row.

**Acceptance Scenarios**:
1. **Given** a database where the migration has been applied, **When** the operator runs the audit query, **Then** it returns the count and identifying columns of all `project_id IS NULL` rows.
2. **Given** a database with zero such rows, **When** the audit runs, **Then** it returns count 0 and the resolution proceeds down the "no affected data" path.

### Scenario 2 — Legacy owner regains access only through an explicit, correct mapping (Priority: P1)

As the original owner of a legacy document that predates the migration, I regain access to that document only if an operator explicitly and correctly associates it with a project I own or collaborate on — never through an automatic guess.

**Why this priority**: Restoring access is the literal subject of the issue, but doing it by inference could attach a row to the wrong tenant's project, converting an availability bug into a confidentiality breach.

**Acceptance Scenarios**:
1. **Given** a NULL-`project_id` legacy row and an operator-supplied `project_id` that the row's `owner_id` owns, **When** the correction migration/script sets that `project_id`, **Then** the owner and that project's accepted collaborators can read/update the row and non-members still cannot.
2. **Given** no trustworthy mapping is available for a NULL-`project_id` row, **When** resolving, **Then** the row is deleted (orphaned, table unused) rather than assigned a guessed project.

### Scenario 3 — Future rows cannot become inaccessible (Priority: P2)

As a maintainer, after legacy NULL rows are resolved I want the schema to reject any new `shared_documents` row without a `project_id`, so this class of bug cannot recur.

**Why this priority**: Prevents regression, but is only safe to apply once Scenario 1/2 confirm no NULL rows remain in any environment; hence P2 behind the audit and resolution.

**Acceptance Scenarios**:
1. **Given** an environment verified to have zero NULL-`project_id` rows, **When** the `project_id NOT NULL` constraint migration is applied, **Then** it succeeds and subsequent inserts without `project_id` are rejected.
2. **Given** an environment that still has NULL rows, **When** the constraint migration would run, **Then** it MUST NOT be applied (the audit gate blocks it) so it cannot fail mid-deploy or silently drop data.

### Edge Cases

- **Realtime subscribers**: `shared_documents` is in the `supabase_realtime` publication. After resolution, RLS still governs which rows a subscriber receives; deleting NULL rows removes any change events for them — acceptable since they are orphaned.
- **Migration already applied vs. fresh DB**: On a fresh database the table starts empty, so there are no NULL rows and only the `NOT NULL` guarantee (Scenario 3) is relevant. The forward migration must behave correctly in both cases.
- **`NOT NULL` migration encountering unexpected NULL rows**: If, despite the audit, a NULL row exists when the constraint is applied, the migration MUST fail loudly (constraint violation) rather than delete or coerce data.
- **Service-role writes**: Service-role/bypass-RLS paths (e.g. seed, admin tooling) can still see NULL rows; the audit relies on this to enumerate them.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The resolution MUST begin with an auditable read-only query that enumerates all `shared_documents` rows where `project_id IS NULL` (count plus `id`, `doc_id`, `owner_id`, `created_at`), runnable per environment with the service role.
- **FR-002**: The resolution MUST NOT perform any unconditional automatic backfill that infers `project_id` from `doc_id`, `owner_id`, or any non-authoritative source, because no reliable mapping exists and a wrong guess causes cross-tenant exposure.
- **FR-003**: Any change to `shared_documents` MUST ship as a new forward migration; `20260707000000_scope_shared_documents_rls.sql` and `20251211124409_create_shared_documents.sql` MUST remain unedited (filenames are recorded in migration history).
- **FR-004**: NULL-`project_id` rows MUST remain unreadable and unwritable by non-members throughout — the resolution MUST NOT reintroduce any `auth.role() = 'authenticated'`-style blanket grant (no regression of #152).
- **FR-005**: For environments confirmed to have zero NULL-`project_id` rows, the resolution MUST record that outcome (in the migration/PR notes) and MAY add a `project_id NOT NULL` constraint via forward migration to prevent recurrence.
- **FR-006**: For environments with NULL rows and no trustworthy mapping, the resolution MUST delete those orphaned rows (documented, reversible-by-restore-from-backup where required) rather than assign a guessed project.
- **FR-007**: For NULL rows where an operator can supply an authoritative `project_id`, the correction MUST set exactly that value, and post-condition MUST be verified: owner/collaborators can access, non-members cannot.
- **FR-008**: A `project_id NOT NULL` constraint migration (if adopted) MUST be gated so it only runs against an environment already confirmed free of NULL rows, and MUST fail (not mutate data) if a NULL row is unexpectedly present.

### Non-Functional Requirements

- **NFR-001**: Reuse the existing SECURITY DEFINER helpers `is_project_owner` / `is_accepted_collaborator`; the resolution does not change the membership predicate, only the presence of `project_id` values and (optionally) its nullability.
- **NFR-002**: Confirm no application runtime path depends on NULL-`project_id` rows before deletion (the service in `sharedDocumentService.ts` has no callers as of 2026-07-09; re-verify at implementation time).
- **NFR-003**: The audit query and any correction script MUST be safe to run against production (read-only audit first; destructive/constraint steps only after explicit owner sign-off per environment).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For each environment, an executed audit records the exact count of `project_id IS NULL` rows in the PR/migration notes (expected 0 given the table is unused).
- **SC-002**: A DB-backed RLS behavior test (RLS_DB_TESTS harness) proves that after resolution: a row with a valid `project_id` is readable by owner/accepted collaborators and denied to non-members, and — where the `NOT NULL` guarantee is adopted — an insert omitting `project_id` is rejected.
- **SC-003**: No legacy shared document remains permanently inaccessible with no recorded disposition: every NULL row is either confirmed nonexistent, deleted with a documented reason, or backfilled with an authoritative `project_id`.
- **SC-004**: CI (lint + unit incl. RLS behavior tests + build) is green and Playwright shows no regression.

## Out of Scope

- Rewiring Yjs collaboration to persist through `shared_documents` (tracked separately, see #160-class work).
- Deleting the dead `sharedDocumentService.ts` / the `shared_documents` table entirely (a separate cleanup decision; this spec resolves the access/backfill question for the table in place).
- Changing the membership model or the `is_project_owner` / `is_accepted_collaborator` helpers.
- Any UI to let end users self-assign a project to an orphaned legacy document.

## Open Questions

- **Q1**: Do any real environments (prod, staging) actually contain `shared_documents` rows at all? The audit (FR-001) answers this; the expected answer is none, which reduces this issue to FR-005 (record + optionally add `NOT NULL`).
- **Q2**: If NULL rows exist, does an operator have any authoritative source (backup, external record) mapping `doc_id`/`owner_id` to a project, or should all such rows be deleted as orphaned (FR-006)?
