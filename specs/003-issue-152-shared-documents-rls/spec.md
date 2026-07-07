# Feature Specification: Scope shared_documents RLS to project members (issue #152)

**Feature Branch**: `git-issues-fix`
**Created**: 2026-07-07
**Status**: Draft
**Input**: GitHub issue #152 — shared_documents RLS allows any authenticated user to read/write all documents (incl. realtime).

## Overview

`public.shared_documents` currently grants read/insert/update to every authenticated user via `auth.role() = 'authenticated'`, and the table is added to the `supabase_realtime` publication. Any logged-in user can therefore read and mutate every other tenant's document content — a cross-tenant isolation hole of the same class as the already-fixed #143/#151/#153.

Investigation finding: `sharedDocumentService.ts` (the only code touching this table) has no callers — real collaborative editing runs through Yjs + IndexedDB (`YjsContext.tsx`), not this table. There is therefore no active read/write path to break, making the tightening low-risk.

Decision (owner): documents follow the project-sharing model — a user may access a document iff they own or are an accepted collaborator on the document's project. This requires associating each document with a project, which the table does not currently do.

## User Scenarios & Testing *(mandatory)*

### Scenario 1 — Non-member cannot read another project's document (Priority: P1)

As a signed-in user who is NOT a member of project P, when I query `shared_documents` for a document belonging to P, I receive no rows.

**Root cause**: `shared_documents_select_all` uses `using (auth.role() = 'authenticated')`, which is true for every logged-in user regardless of project membership.

**Acceptance Scenarios**:
1. **Given** a document owned by project P and a user who is neither owner nor accepted collaborator of P, **When** they SELECT that document, **Then** 0 rows return.
2. **Given** the same user, **When** they attempt INSERT/UPDATE against P's document, **Then** RLS denies the write.

### Scenario 2 — Owner and accepted collaborators retain access (Priority: P1)

As the project owner or an accepted collaborator, when I read or update a document belonging to my project, the operation succeeds.

**Acceptance Scenarios**:
1. **Given** project P's owner, **When** they SELECT/UPDATE a document of P, **Then** it succeeds.
2. **Given** an accepted admin/editor collaborator of P, **When** they read/update, **Then** it succeeds.
3. **Given** an accepted viewer of P, **When** they SELECT, **Then** it succeeds (read); write policy MAY remain owner/collaborator-scoped consistent with existing tables.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `shared_documents` MUST carry a `project_id uuid` column referencing `public.projects(id) on delete cascade`, so RLS can evaluate membership.
- **FR-002**: The `select` policy MUST be replaced so a row is visible only when `public.is_project_owner(project_id, auth.uid())` OR `public.is_accepted_collaborator(project_id, auth.uid())`.
- **FR-003**: The `insert`/`update` policies MUST be replaced with the same membership predicate (WITH CHECK on both), removing the blanket `authenticated` grants.
- **FR-004**: The migration MUST be additive (new forward migration; existing 20251211124409 left unedited) so it applies cleanly on fresh and migrated databases.
- **FR-005**: Existing rows with a null `project_id` (should be none in practice, table unused) MUST NOT be readable by non-members; a null `project_id` yields no membership match, i.e. denied by default.
- **FR-006**: Realtime publication membership MAY remain, but RLS now governs which rows a subscriber receives.

### Non-Functional Requirements

- **NFR-001**: Reuse the existing SECURITY DEFINER helpers `is_project_owner` / `is_accepted_collaborator`; do not inline new predicates (consistent with the #5 refactor).
- **NFR-002**: No application code depends on the current permissive behavior (service is dead code); verify no runtime path breaks.

## Success Criteria *(mandatory)*

- **SC-001**: A DB-backed RLS behavior test (RLS_DB_TESTS harness) proves a non-member gets 0 rows and is denied writes, while owner/collaborator succeed.
- **SC-002**: CI (lint + unit incl. RLS behavior tests + build) is green, and Playwright shows no regression.

## Out of Scope

- Rewiring Yjs collaboration to persist through `shared_documents` (that is #160).
- Deleting the dead `sharedDocumentService.ts` / table (a separate cleanup decision; this spec only secures the table in place).
- Backfilling `project_id` for legacy rows beyond safe-by-default denial.
