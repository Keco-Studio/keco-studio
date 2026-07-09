# Feature Specification: Remove dead scripts, SQL, and legacy ESLint config (issue #180)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #180 — delete unreferenced/superseded files: `supabase-enable-realtime.sql`, `check-env.ts`, `test-resend-api.ts`, old shell cleanup scripts, `WSL-LAN-ACCESS.md`, `.eslintrc.json`, etc.

## Overview

Candidate cleanup of stale infrastructure files. Actual locations differ from the issue's shorthand; verified paths below.

### Investigation findings (verified 2026-07-09)

| File (issue name) | Actual path | Exists? | Notes |
|---|---|---|---|
| `supabase-enable-realtime.sql` | `supabase/supabase-enable-realtime.sql` | Yes | Ad-hoc SQL; realtime now enabled via migrations (e.g. `20260129000001/002_enable_realtime_*`). |
| `check-env.ts` | `scripts/check-env.ts` | Yes | Verify no npm script/CI references before deleting. |
| `test-resend-api.ts` | `scripts/test-resend-api.ts` | Yes | One-off Resend API probe; verify unreferenced. |
| `WSL-LAN-ACCESS.md` | `scripts/WSL-LAN-ACCESS.md` | Yes | Dev note; `dev:lan` script uses `scripts/dev-lan.sh`, not this doc. |
| `.eslintrc.json` | `.eslintrc.json` (repo root) | Yes | Legacy config; project migrated to flat config `eslint.config.mjs` (confirmed present and active). |

Notes:
- `.eslintrc.json` and `eslint.config.mjs` both exist. Flat config (`eslint.config.mjs`) is the active one referenced by `lint`. The legacy `.eslintrc.json` should be confirmed unused by the current ESLint invocation before removal (ESLint 9 flat config ignores `.eslintrc.json` when `eslint.config.*` is present, but confirm the installed ESLint version/flag to be safe).
- The issue says "old shell cleanup scripts, ... etc." — the implementer MUST enumerate every candidate under `scripts/` and confirm each is unreferenced rather than deleting by name-guess.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Repo carries no dead infra files (Priority: P2)

As a maintainer, the repo does not contain scripts/SQL/config that nothing runs, so contributors are not misled and search noise is reduced.

**Why this priority**: Pure hygiene; no runtime behavior depends on these files (that is exactly what must be verified).

**Independent Test**: For each candidate, grep the whole repo (package.json, `.github/`, imports, docs) for references; delete only those with zero references; then run lint + build + unit tests green.

**Acceptance Scenarios**:
1. **Given** a candidate file with zero references, **When** deleted, **Then** `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:unit` remain green.
2. **Given** `.eslintrc.json` removed, **When** `npm run lint` runs, **Then** it still uses `eslint.config.mjs` and produces the same result as before.
3. **Given** a candidate that IS referenced, **When** verifying, **Then** it is retained and the finding recorded (do not delete).

### Edge Cases

- A file referenced only in documentation (not code) → update/remove the doc reference in the same change.
- `supabase-enable-realtime.sql` must be confirmed superseded by realtime migrations before deletion so realtime is not accidentally left disabled on a manual-setup path.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each candidate MUST be verified unreferenced (no npm script, CI step, import, dynamic import, or doc link) before deletion; results recorded in a per-file table.
- **FR-002**: `.eslintrc.json` MUST only be removed after confirming the active ESLint run uses `eslint.config.mjs` and produces unchanged results.
- **FR-003**: `supabase-enable-realtime.sql` MUST only be removed after confirming realtime is enabled via migrations for the relevant tables.
- **FR-004**: Any documentation referencing a deleted file MUST be updated in the same change.
- **FR-005**: No file with any live reference may be deleted; such files MUST be retained with the finding noted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A per-file verification table (path, references found, deleted/kept) is included in the PR.
- **SC-002**: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:unit` are green after deletions.
- **SC-003**: ESLint output before vs after `.eslintrc.json` removal is equivalent.

## Out of Scope

- Removing unused npm dependencies (issue #177, spec 019).
- Removing unused source files (issue #178, spec 020).
- The `check-no-explicit-any.ts` / `FILE_CLEANUP_LIST.md` decisions (issue #182, spec 024).
