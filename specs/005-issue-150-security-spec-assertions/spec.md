# Feature Specification: Re-enable IDOR/XSS/SQLi security tests (issue #150)

**Feature Branch**: `git-issues-fix`
**Created**: 2026-07-07
**Status**: Draft
**Input**: GitHub issue #150 — IDOR/XSS/SQLi assertions in security.spec.ts are commented out.

## Overview

`tests/e2e/specs/security.spec.ts` lines 219–383 hold the suite's only IDOR/XSS/SQLi coverage across three `test.describe` blocks — **API Endpoint Security** (219–261), **Data Isolation & Access Control** (263–300), and **Input Validation & Security** (302–383). All three are entirely commented out, so the file looks comprehensive while asserting nothing. This creates a false sense of security coverage: a regression that exposed an unprotected API route, cross-tenant project access, or an XSS/SQLi hole would not be caught.

Each block was originally guarded by `test.skip(!isRealSupabase, …)`, indicating they need a real Supabase instance. The Playwright CI workflow (`.github/workflows/playwright.yml`) runs against a local Supabase at `127.0.0.1:54321`, so `isRealSupabase` can be satisfied there. This spec re-enables the blocks, repairs the assertions to be deterministic, and ensures they actually gate regressions.

## User Scenarios & Testing *(mandatory)*

### Scenario 1 — Unauthenticated API access is gated (Priority: P1)

**Root cause**: The "API Endpoint Security" describe (security.spec.ts:219–261) that asserts protected endpoints return 401/403 is fully commented out.

**Acceptance Scenarios**:
1. **Given** no authenticated session, **When** each critical endpoint (GET/POST/DELETE `/api/projects`, etc.) is called, **Then** the response status is 401 or 403; the test fails if any returns 2xx.

### Scenario 2 — Cross-tenant project access is denied (IDOR) (Priority: P1)

**Root cause**: "Data Isolation & Access Control" describe (263–300) is commented out; it must create a project as user A and confirm user B cannot read it.

**Acceptance Scenarios**:
1. **Given** a project owned by user A, **When** user B navigates to `/${projectAId}`, **Then** they see forbidden/not-found or are redirected — never A's data.

### Scenario 3 — XSS/SQLi payloads are neutralized (Priority: P2)

**Root cause**: "Input Validation & Security" describe (302–383) is commented out; XSS-in-project-name and SQLi-in-search assertions never run.

**Acceptance Scenarios**:
1. **Given** a project created with name `<script>alert("XSS")</script>`, **When** the page renders it, **Then** no dialog fires and the payload shows as text.
2. **Given** SQLi payloads typed into search, **When** submitted, **Then** no DB/syntax error surfaces and the app stays functional.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Uncomment and re-enable all three describe blocks (219–383).
- **FR-002**: Each block MUST keep a real-Supabase guard, but the guard MUST resolve true in the Playwright CI env (local Supabase). Fix `isRealSupabase` detection if it wrongly skips against the local instance.
- **FR-003**: The IDOR test MUST create user A's project at runtime and derive its real id (no placeholder `'other-users-project-id'`), then attempt access as user B, so the assertion is meaningful.
- **FR-004**: The XSS test MUST register the `page.on('dialog')` listener BEFORE triggering project creation (the current commented code registers it after), so an alert cannot be missed.
- **FR-005**: Assertions MUST be deterministic (explicit waits/expects, no bare `waitForTimeout`-only checks) to avoid the flakiness that likely caused the original disabling.

### Non-Functional Requirements

- **NFR-001**: Tests run only in the Playwright workflow; they MUST NOT be pulled into the jest unit run.
- **NFR-002**: No production code change is required unless a test reveals a real hole (then that hole is a separate issue).

## Success Criteria *(mandatory)*

- **SC-001**: The three describe blocks execute (not skipped) in the Playwright CI workflow and pass.
- **SC-002**: Temporarily introducing an unprotected route or reflected payload makes the corresponding test fail (assertions are live).
- **SC-003**: Playwright workflow is green; CI (unit/build) unaffected.

## Out of Scope

- Fixing any real vulnerability the re-enabled tests might uncover (would be filed/fixed separately).
- Adding new attack categories beyond IDOR/XSS/SQLi.
