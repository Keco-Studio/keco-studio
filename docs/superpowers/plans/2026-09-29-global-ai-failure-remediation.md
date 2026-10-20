# Global AI Failure Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make targeted Script, Map, and GDS Agent requests complete within budget while preserving Map dimension and generated-asset invariants.

**Architecture:** Filter the model's tool schema and execution by the frozen workspace. Script uses exact UUID-targeted reads and writes. Map and GDS use bounded read/confirm/write adapters over existing server services with revision or version CAS checks. Generation inputs remain bounded and asynchronous.

**Tech Stack:** Next.js App Router, TypeScript, Zod, Supabase services, Jest.

## Global Constraints

- Script targeted edits must not enumerate the whole project or call semantic search when an active Script library is bound.
- Map `name`, `summary`, `description`, and generation `seed` are editable; dimensions require a new draft.
- Generated images, references, and collision grids are edited only by dedicated workflows.
- GDS metadata edits and version content edits are separate confirmed operations.
- Every write keeps role checks, confirmation, and stale-state rejection.

### Task 1: Script workspace targeting

**Files:**
- Create: `src/lib/agent/tools/workspace-policy.ts`
- Modify: `src/lib/agent/tools/index.ts`, `src/lib/agent/core.ts`, `src/lib/agent/prompts.ts`
- Test: `tests/unit/agent/workspace-tool-policy.test.ts`, `tests/unit/agent/script-targeting.test.ts`

- [ ] Add a literal Script allowlist that excludes `list_project_structure`, `query_assets`, and `semantic_search` for targeted Script turns.
- [ ] Filter both advertised and executed tools using the workspace allowlist, including confirmation resume.
- [ ] Add a prompt rule requiring `read_story_graph` or `query_script_lines` first and using returned `nodeId` for dialogue edits.
- [ ] Assert the active Script read returns UUIDs and the model schema omits broad discovery tools.
- [ ] Run the focused tests and typecheck.

### Task 2: Map draft Agent adapters

**Files:**
- Create: `src/lib/agent/tools/read-map-detail.ts`, `src/lib/agent/tools/update-map-draft.ts`, `src/lib/agent/tools/map-tool-support.ts`
- Modify: `src/lib/agent/tools/index.ts`, `src/lib/agent/tools/workspace-policy.ts`
- Test: `tests/unit/agent/map-workspace-action-tools.test.ts`

- [ ] Read one exact map and return bounded plan, scene summary, identity, and content fingerprint.
- [ ] Merge only editable plan fields, validate with `validateMapPlanV3`/`validateMapSceneV3`, and confirm before saving.
- [ ] Recheck revision, save version, fingerprint, and project authorization immediately before `updateDraft`.
- [ ] Return `MAP_RESIZE_REQUIRES_NEW_DRAFT` for dimension changes without writing.
- [ ] Run Map tests and API/service tests.

### Task 3: GDS bounded editing and generation

**Files:**
- Create: `src/lib/agent/tools/read-game-design-system.ts`, `src/lib/agent/tools/update-game-design-system.ts`, `src/lib/agent/tools/create-game-design-system-version.ts`
- Modify: `src/lib/agent/tools/index.ts`, `src/lib/agent/tools/workspace-policy.ts`, `src/lib/gameDesignSystemGeneration.ts`
- Test: `tests/unit/agent/game-design-system-tools.test.ts`, `src/lib/gameDesignSystemGeneration.test.ts`

- [ ] Read one exact system/version with bounded source data.
- [ ] Confirm and CAS-update title, summary, and status through the existing service.
- [ ] Create a new version for document/rule edits with `expectedCurrentVersionId`; never overwrite a version in place.
- [ ] Keep generation source excerpts, pasted Markdown, and completion tokens bounded and verify prompt size.
- [ ] Run GDS tests and typechecks.

### Task 4: Verification

- [ ] Run all focused Agent, Map, and GDS Jest suites.
- [ ] Run `npm run typecheck` and `npm run typecheck:api`.
- [ ] Run `git diff --check` and inspect the final diff for unrelated changes.
