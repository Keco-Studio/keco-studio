# Feature Specification: Update outdated ARCHITECTURE.md (issue #183)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #183 — `docs/architecture/ARCHITECTURE.md` has wrong versions, dependencies, directory structure, and persistence-layer description (says React 18, Next 16.0, y-indexeddb, old storage adapters).

## Overview

`docs/architecture/ARCHITECTURE.md` documents an architecture the code no longer matches. Concrete drift verified against `package.json` and the current source tree.

### Investigation findings — drift table (verified 2026-07-09)

| Claim in ARCHITECTURE.md | Location | Actual state |
|---|---|---|
| "React 18" | line 6, 64 | `react`/`react-dom` are `^19.2.7` |
| Persistence "IndexedDB" for Yjs docs | lines 101-103, 131-132, 501, 508, 1000-1034 | `y-indexeddb` is **absent** from `package.json`; grep finds **zero** `IndexeddbPersistence`/`y-indexeddb` usages in `src/`. Persistence is online Yjs sync + Supabase, not IndexedDB. |
| Dependency table lists `y-indexeddb` `9.0.12` | line 150 | Not a dependency at all. |
| "离线支持: IndexedDB持久化，离线也可编辑" (offline via IndexedDB) | line 1034 | No IndexedDB layer; offline-edit claim is false. |
| Storage adapter files: `cookieStorageAdapter.ts`, `hybridStorageAdapter.ts`, `sessionStorageAdapter.ts`, `tabIsolatedStorageAdapter.ts` | lines 406-416 | Verify each still exists; auth moved to `@supabase/ssr` `createBrowserClient` (see memory), so these adapter references are likely stale. |
| Data-flow diagram `... → Yjs Doc → IndexedDB` | line 508, 1000-1025 | Terminal IndexedDB stage does not exist. |

Note: `next` is `^16.2.10`; the doc's "Next.js 16" is roughly right on major version but the implementer should state the exact current version. React major is the biggest hard error (18 → 19).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Architecture doc matches reality (Priority: P2)

As a new contributor, ARCHITECTURE.md reflects the actual stack (React 19, current Next, online Yjs sync, no IndexedDB), so I don't build a wrong mental model.

**Why this priority**: Docs-only; no runtime impact, but actively misleading as-is.

**Independent Test**: Cross-check each version/dependency claim against `package.json` and each file/persistence claim against the source tree; every corrected statement is verifiable.

**Acceptance Scenarios**:
1. **Given** the version claims, **When** updated, **Then** they match `package.json` (React 19.2.7, Next 16.2.10, Yjs 13.6.29, no y-indexeddb).
2. **Given** the persistence section, **When** rewritten, **Then** it describes online Yjs sync + Supabase with no IndexedDB/offline-edit claim.
3. **Given** the file/adapter references, **When** updated, **Then** every named file that no longer exists is removed or corrected.

### Edge Cases

- Any diagram embedding IndexedDB as a stage MUST be redrawn to remove it.
- If some storage-adapter files still exist, keep only the accurate ones and describe their real current role.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All version/dependency statements MUST be corrected to match `package.json` (notably React 18 → 19, and remove `y-indexeddb`).
- **FR-002**: The persistence-layer section (and data-flow diagrams) MUST be rewritten to describe online Yjs sync + Supabase, removing IndexedDB and the offline-editing claim.
- **FR-003**: Every referenced file/path MUST be verified to exist; stale references (old storage adapters, IndexedDB modules) MUST be removed or corrected.
- **FR-004**: The directory-structure section MUST reflect the current tree for the areas it documents.
- **FR-005**: No fabricated version numbers — each cited version MUST be copied from `package.json`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero remaining references to `y-indexeddb`/IndexedDB persistence in ARCHITECTURE.md.
- **SC-002**: Every version number in the doc matches `package.json`.
- **SC-003**: Every file path named in the doc exists in the repo (spot-check/grep).

## Out of Scope

- The collaboration-specific docs `COLLABORATION_OVERVIEW.md` / `collaboration-table-unified-design.md` (issue #184, spec 026).
- Rewriting `OPTIMIZATION_RECOMMENDATIONS.md` or `FILE_CLEANUP_LIST.md`.
