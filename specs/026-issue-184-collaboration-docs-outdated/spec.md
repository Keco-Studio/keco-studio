# Feature Specification: Rewrite/archive outdated collaboration docs (issue #184)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #184 — `COLLABORATION_OVERVIEW.md` and `collaboration-table-unified-design.md` still describe a Yjs + IndexedDB dual-track persistence architecture that no longer exists (`y-indexeddb` removed).

## Overview

Two docs under `docs/architecture/` describe a persistence model the code has abandoned. Verified drift below.

### Investigation findings (verified 2026-07-09)

1. `y-indexeddb` is **absent** from `package.json` and grep finds **zero** `IndexeddbPersistence`/`y-indexeddb` usages in `src/`. The "dual-track" (Yjs + IndexedDB) model these docs describe is gone; the current model is online Yjs sync backed by Supabase.
2. `docs/architecture/collaboration-table-unified-design.md`:
   - Line 12: section titled "Current Architecture (Dual-Track Model)" — describes the dual-track model as *current*.
   - Lines 18-19: table stating `LibraryDataContext` persists to `IndexedDB library-${libraryId}` and `YjsContext` persists rows to `IndexedDB asset-table-${libraryId}` (local-only, not cross-synced).
   - Lines 31, 92, 111: logic that hinges on an IndexedDB `synced` event and IndexedDB-restore-overwrite handling.
3. `docs/architecture/COLLABORATION_OVERVIEW.md`:
   - Line 114: "Persistence | `IndexeddbPersistence('library-${libraryId}', yDoc)` ...".
   - Lines 182, 215: describe IndexedDB persistence (`asset-table-${libraryId}`) and rendering logic that reads from IndexedDB-backed yRows.
4. These descriptions no longer match code and, worse, describe behavior (local IndexedDB restore overwriting DB) that could mislead debugging of the current online-sync flow.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Collaboration docs describe the real sync model (Priority: P2)

As a contributor working on collaboration, the docs describe the current online Yjs sync architecture (no IndexedDB dual-track), so I reason about the real system.

**Why this priority**: Docs-only, but these are the primary reference for collaboration behavior; being wrong is costly during incidents.

**Independent Test**: Cross-check each IndexedDB/dual-track claim against the code (no `y-indexeddb`, no `IndexeddbPersistence`); confirm the rewritten/archived docs contain no live IndexedDB persistence claims.

**Acceptance Scenarios**:
1. **Given** the two docs, **When** resolved, **Then** they either (a) are rewritten to the current online Yjs sync model with no IndexedDB persistence claims, or (b) are archived/marked superseded with a pointer to the current source of truth.
2. **Given** a rewrite, **When** reviewed, **Then** every persistence statement matches the code (Supabase + online Yjs, no local IndexedDB doc store).

### Edge Cases

- If any residual IndexedDB usage actually remains anywhere, the doc MUST describe it accurately rather than blanket-deleting the section — but current grep shows none.
- Cross-references from `docs/architecture/README.md` and `ARCHITECTURE.md` (issue #183) to these docs MUST stay consistent after rewrite/archive.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Both docs MUST be resolved by either rewriting to the current online Yjs sync architecture OR archiving/marking them superseded with a pointer to the authoritative doc.
- **FR-002**: If rewritten, all IndexedDB/dual-track/`IndexeddbPersistence` claims MUST be removed and replaced with the actual persistence model (Supabase + online Yjs sync).
- **FR-003**: The recommended approach (rewrite vs archive) MUST be stated; recommendation: rewrite `COLLABORATION_OVERVIEW.md` to current state and archive `collaboration-table-unified-design.md` if the "unified design" is now implemented (verify), otherwise rewrite it too.
- **FR-004**: References to these docs from `README.md`/`ARCHITECTURE.md` MUST remain valid after the change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero live claims of IndexedDB/`IndexeddbPersistence` persistence in either doc (grep clean, excluding any explicit "removed/historical" note).
- **SC-002**: Persistence statements match the code (no `y-indexeddb`).
- **SC-003**: No broken cross-references from other architecture docs.

## Out of Scope

- The top-level `ARCHITECTURE.md` rewrite (issue #183, spec 025) — coordinate but keep separate.
- Changing the collaboration code itself.
