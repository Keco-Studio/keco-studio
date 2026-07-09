# Feature Specification: Remove unused npm dependencies (issue #177)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #177 — remove deps with no imports in src/scripts/tests: `axios`, `nodemailer`, `echarts`, `recharts`, `word-extractor`, `@supabase/auth-helpers-nextjs`.

## Overview

Six dependencies are candidates for removal. Each was grepped across `src/`, `scripts/`, and `tests/` for `import`/`require`/dynamic-import/string usage.

### Investigation findings (verified 2026-07-09)

| Dependency | package.json version | References in src/scripts/tests | Safe to remove? |
|---|---|---|---|
| `axios` | ^1.18.1 | 0 | Yes |
| `nodemailer` | ^9.0.3 | 0 | Yes |
| `echarts` | ^6.1.0 | 0 | Yes |
| `recharts` | ^3.8.1 | 0 | Yes |
| `word-extractor` | ^1.0.4 | 0 | Yes |
| `@supabase/auth-helpers-nextjs` | ^0.15.0 | 0 | Yes — see note |

Notes:
- `@supabase/auth-helpers-nextjs` has **zero** references. The codebase's auth uses `@supabase/ssr` (^0.8.0, present). Memory records that a prod auth lockout was fixed by moving to `createBrowserClient` (from `@supabase/ssr`) — consistent with `auth-helpers-nextjs` being fully superseded. Re-confirm no auth file imports `auth-helpers-nextjs` at implementation time before removing.
- Grep only counts direct textual references; the implementer MUST also confirm none are used transitively as a required peer of code we call directly (these six are not expected to be, but verify no runtime import breaks after removal via build + tests).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Dependency list matches actual usage (Priority: P2)

As a maintainer, `package.json` lists only dependencies the code uses, so install size, audit surface, and confusion are reduced.

**Why this priority**: Hygiene and supply-chain surface reduction; must be verified not to break build/runtime.

**Independent Test**: Remove the six deps, run `npm install`, then `npm run build`, `npm run typecheck`, `npm run test:unit` — all green with no missing-module errors.

**Acceptance Scenarios**:
1. **Given** the six deps removed from `package.json`, **When** `npm install` runs, **Then** the lockfile updates and install succeeds.
2. **Given** the removal, **When** `npm run build` and `npm run test:unit` run, **Then** no "Cannot find module" errors for any removed package.
3. **Given** a dep that turns out to be referenced after all, **When** verifying, **Then** it is kept and the finding recorded.

### Edge Cases

- A dep imported only in a config file (e.g. `next.config`, `tailwind`, `postcss`) outside src/scripts/tests → widen the grep to config files before removing (none expected among these six, but check).
- Removing `@supabase/auth-helpers-nextjs` MUST be validated against auth E2E/unit paths given the prior lockout history.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each of the six dependencies MUST be re-verified unreferenced (imports, requires, dynamic imports, string usage) across `src/`, `scripts/`, `tests/`, and config files before removal.
- **FR-002**: Confirmed-unused dependencies MUST be removed from `package.json` and the lockfile updated via `npm install`.
- **FR-003**: `@supabase/auth-helpers-nextjs` removal MUST be validated by running the auth-related tests/build, given the documented prior auth lockout.
- **FR-004**: Any documentation referencing a removed dependency MUST be updated.
- **FR-005**: Any dependency found to be referenced MUST be retained with the finding recorded.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A per-dependency verification table (name, refs, removed/kept) is in the PR.
- **SC-002**: `npm run build`, `npm run typecheck`, `npm run test:unit` are green after removal, with the lockfile updated.
- **SC-003**: Auth flows (unit and, if run, E2E) pass after `@supabase/auth-helpers-nextjs` removal.

## Out of Scope

- Removing unused source files (issue #178, spec 020) or dead scripts (issue #180, spec 022).
- Upgrading remaining dependency versions.
