# Global Assistant Action Parity Implementation Plan

> **For agentic workers:** Work in `codex/ai-map-ui-parity`. The user explicitly requested no TDD: implement, add focused tests, then perform one unified final review.

**Goal:** Bring the in-app assistant's write capabilities to the human task inventory in `docs/superpowers/specs/2026-09-28-agent-action-parity-design.md`.

**Architecture:** Thin, typed Tool adapters call the same service/RPC path as each workspace UI. Register each in `src/lib/agent/tools/index.ts`, allow it only in `workspace-policy.ts`, and reuse the existing confirmation suspend/resume flow. Keep account scope, project membership, role checks, idempotency, and revision checks server-enforced.

**Tech Stack:** Next.js 16, TypeScript, Supabase/RLS, Jest, Playwright.

## Global Constraints

- Cover Projects, all Studio project pages, Script, Create Map, and Game Design Systems; exclude Simulation.
- Deletion, overwriting existing content, and paid generation always require explicit confirmation, including Auto mode.
- Ambiguous target names must return candidates instead of selecting one.
- No cross-project write from an unbound conversation without an explicit, authorized project target.
- Keep list results bounded to 20 by default and 50 maximum; never poll generation inside the ReAct loop.
- Do not use TDD. Add tests after implementation and run one unified review after all domains.

---

### Task 1: Existing destructive confirmation

**Files:** `src/lib/agent/tools/delete-asset.ts`, `delete-library.ts`; `tests/unit/agent/conversation-meta.test.ts`.

- [x] Set `confirmationPolicy: 'always'` on both destructive Tools.
- [x] Test `needsConfirmation` with `autoExecute` and legacy `skipConfirmation` enabled.
- [x] Run focused Jest and TypeScript checks.

### Task 2: Projects and Studio structure

**Files:** New Tools under `src/lib/agent/tools/`; existing `src/lib/services/projectService.ts`, `folderService.ts`, `libraryService.ts`, `src/app/api/projects/[projectId]/delete/route.ts`, `src/app/(dashboard)/[projectId]/[libraryId]/predefine/hooks/useSchemaSave.ts` as source behavior; tool registry/policy; `tests/unit/agent/project-tools.test.ts`, `workspace-tool-policy.test.ts`, new focused Tool tests.

- [ ] Add project metadata update (admin) and project deletion (always confirm; explicit project ID; recheck owner/admin and target after resume).
- [ ] Add folder rename/move/duplicate/delete and library metadata/move/duplicate operations through existing services; cascade delete always confirms.
- [ ] Add table field edit/delete/reorder. A type change that clears values and field deletion always confirm, with affected values/rows in the preview. Use the UI's schema-save transaction boundary.
- [ ] Register Tools only for Projects or Studio as appropriate; test access, same-project binding, ambiguous names, deletion confirmation, and invalidation.
- [ ] Run focused Jest, typecheck, and a browser mutation/refresh check.

### Task 3: Script workspace and dialogue

**Files:** New Tools under `src/lib/agent/tools/`; `src/lib/script-system/scriptDialogueMutations.ts`, `src/components/script-system/useScriptDialogueEditor.ts`, `src/app/api/script-workspace/[projectId]/...` as source behavior; registry/policy; Script Tool tests.

- [ ] Add project Script document membership, rename/delete operations. Delete always confirms.
- [ ] Add dialogue insert/edit/delete/speaker/reorder/undo through the same atomic document/table/plot service path the UI uses. Never approximate these with generic cell edits.
- [ ] Add focused tests for synchronization, permissions, stale revisions, and confirmations; run typecheck and Script browser smoke test.

### Task 4: Create Map saved work

**Files:** New Tools under `src/lib/agent/tools/`; `src/features/create-map/services/createMapService.ts`, `src/app/api/create-map/collision-grid/route.ts`, `src/app/api/create-map/references/route.ts` as source behavior; registry/policy; Map Tool tests.

- [ ] Expand detail reads to full bounded plan/scene/collision/history views with stable IDs.
- [ ] Add saved plan/scene edits using `saveDraftV3` CAS. Replacing existing content always confirms with expected revision/fingerprint.
- [ ] Add collision paint/clear and analysis, reference list/add/remove using validated project assets, and generation revision selection.
- [ ] Test project ownership, stale CAS, confirmation, retries, refresh invalidations, and bounded responses; run browser Map smoke test.

### Task 5: Game Design System lifecycle

**Files:** New Tools under `src/lib/agent/tools/`; `src/app/api/game-design-systems/[id]/route.ts`, GDS job routes, `src/lib/services/gameDesignSystemClient.ts` as source behavior; registry/policy; GDS Tool tests.

- [ ] Add structured create, metadata/status edit, version creation/selection, and unbind. Existing-version overwrite and unbind always confirm.
- [ ] Add delete (always confirm), generation retry/cancel, and GDD retry/cancel through existing domain services and permission rules.
- [ ] Test owner/admin/editor boundaries, target-version binding, stale approval, paid-generation confirmation, and job idempotency; run browser GDS smoke test.

### Task 6: Attachments, collaboration, and versions

**Files:** New Tools under `src/lib/agent/tools/`; existing project game-asset, collaborator/invitation, and document-version services/routes as source behavior; registry/policy; focused Tool tests.

- [ ] Add collaborator discovery/invite/role/remove, respecting invitation identity and admin permissions. Remove always confirms.
- [ ] Add document version list/create/restore/delete. Restore and delete always confirm against the current version.
- [ ] Add game media list/upload from a user-provided assistant attachment through the existing storage validation and accounting flow; no arbitrary local paths or fabricated bytes.
- [ ] Run unit, type, browser, and account-storage checks.

### Task 7: Unified verification and review

- [ ] Compare each design inventory entry with registered/allowed Tools and a passing behavioral test.
- [ ] Run relevant Jest suites, Playwright for all five workspaces, lint, TypeScript, storage check, and production build.
- [ ] Review the entire branch once for scope, authorization, confirmation, stale approvals, idempotency, performance, UI refresh, and regressions. Resolve Critical/Important findings and rerun affected checks.
- [ ] Commit the verified implementation. Do not push or merge without a new user request.
