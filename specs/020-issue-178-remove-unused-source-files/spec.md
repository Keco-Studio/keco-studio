# Feature Specification: Remove unreferenced source files (issue #178)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #178 — delete source files with no import references: `imageUploadService.ts`, `sharedDocumentService.ts`, `userValidationService.ts`, `requestTimeout.ts`, `useCollaboratorPermissions.ts`, `PresenceIndicators.tsx`, `LibraryCardMenu.tsx`, etc.

## Overview

Candidate dead source files. Each was located and grepped for importers across `src/` and `tests/` (excluding the file itself).

### Investigation findings (verified 2026-07-09)

| File | Path | External importers | Safe to delete? |
|---|---|---|---|
| `imageUploadService.ts` | `src/lib/services/imageUploadService.ts` | 0 | Yes |
| `sharedDocumentService.ts` | `src/lib/services/sharedDocumentService.ts` | 0 | Yes (dead per spec 014; removal was Out of Scope there, owned here) |
| `userValidationService.ts` | `src/lib/services/userValidationService.ts` | 0 | Yes |
| `requestTimeout.ts` | `src/lib/utils/requestTimeout.ts` | 0 | Yes |
| `useCollaboratorPermissions.ts` | `src/lib/hooks/useCollaboratorPermissions.ts` | 0 | Yes |
| `PresenceIndicators.tsx` | `src/components/collaboration/PresenceIndicators.tsx` | 0 | Yes — the only match found is its own `PresenceIndicators.module.css`, not an importer; the sibling CSS module must be deleted with it |
| `LibraryCardMenu.tsx` | `src/components/folders/LibraryCardMenu.tsx` | 0 | Yes |

Notes:
- The "importer" grep excluded each file's own path. `PresenceIndicators` initially appeared to have one reference, but it resolved to `PresenceIndicators.module.css` (its own stylesheet), so the component is genuinely unimported. Its `.module.css` companion should be removed together.
- `sharedDocumentService.ts` also has an accompanying type `src/lib/types/shared-document.ts`; check whether that type is used elsewhere before deleting it (the service being dead does not automatically mean the type is).
- Grep is textual; the implementer MUST additionally rule out dynamic `import()`, Next.js file-convention routing (these live under `src/lib`/`src/components`, not `app/`, so route-convention does not apply), and string-based references before deletion.
- The issue's "etc." means the implementer should confirm the list is complete/accurate rather than assume; do not delete anything not verified zero-referenced.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — No orphaned source files (Priority: P2)

As a maintainer, the source tree contains no modules that nothing imports, reducing confusion and dead surface.

**Why this priority**: Hygiene; correctness hinges on verifying zero references (including dynamic/string references).

**Independent Test**: For each file, grep importers + dynamic imports + string refs; delete only zero-reference files (plus their companion assets like `.module.css`); then build + typecheck + unit tests green.

**Acceptance Scenarios**:
1. **Given** a zero-reference file, **When** deleted, **Then** `npm run build`, `npm run typecheck`, `npm run test:unit` remain green.
2. **Given** `PresenceIndicators.tsx` deleted, **When** verifying, **Then** its `PresenceIndicators.module.css` is also removed and no import breaks.
3. **Given** a file with any live reference, **When** verifying, **Then** it is kept and the finding recorded.

### Edge Cases

- A companion asset (`.module.css`, test file, story) of a deleted component MUST be removed too, or explicitly kept with reason.
- `shared-document.ts` type usage MUST be checked independently of the service before deleting the type.
- A file re-exported through a barrel (`index.ts`) that is itself unused → confirm the barrel path is also dead before deletion.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each candidate MUST be re-verified as having zero importers, dynamic imports, and string references before deletion; results recorded in a per-file table.
- **FR-002**: Companion assets of deleted files (e.g. `PresenceIndicators.module.css`) MUST be deleted alongside or explicitly retained with reason.
- **FR-003**: `src/lib/types/shared-document.ts` MUST be checked for independent usage before its (optional) removal.
- **FR-004**: Any file found to have a live reference MUST be retained with the finding recorded.
- **FR-005**: Deletions MUST leave `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:unit` green.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A per-file verification table (path, references found, deleted/kept, companions removed) is in the PR.
- **SC-002**: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:unit` are green after deletions.
- **SC-003**: No dangling import or broken reference remains (build proves it).

## Out of Scope

- Removing unused npm dependencies (issue #177, spec 019).
- Deleting the `shared_documents` table / securing it (spec 003/014).
