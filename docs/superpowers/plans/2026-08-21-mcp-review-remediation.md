# MCP Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all nine MCP and nested-folder review findings with test-first changes.

**Architecture:** Paid provider submissions are centralized behind prepare plus confirmation, while read-only status and writer state advancement are separated. PostgreSQL RPCs own idempotency claims and atomic map preparation; App APIs own stable GDS codes and bounded pagination before the MCP bridge.

**Tech Stack:** Next.js 15 route handlers, TypeScript, Supabase/PostgreSQL RPCs, Deno MCP server, Jest, Playwright.

## Global Constraints

- Never submit a paid provider operation without a fresh purpose-bound confirmation.
- Do not run a real paid PixelLab acceptance request.
- Preserve account endpoint `projectId` and legacy bound-project schemas.
- Preserve the user's untracked `.superpowers/` directory.

---

### Task 1: Paid retry and generation advancement

**Files:**
- Modify: `tests/unit/create-map/create-map-mcp-service.test.ts`
- Modify: `tests/unit/create-map/create-map-mcp-route.test.ts`
- Modify: `supabase/functions/mcp/map-tools.test.ts`
- Modify: `src/lib/server/createMapMcpService.ts`
- Modify: `src/app/api/mcp/create-map/route.ts`
- Modify: `supabase/functions/mcp/map-tools.ts`

**Interfaces:**
- Produces: `advanceGeneration(identity)` as a writer-only, non-submit operation.
- Produces: prepare purposes `submit`, `retry`, and `replace-unknown`.

- [ ] Write tests proving failed/rate-limit/quota states cannot invoke provider submission without prepare and confirmation.
- [ ] Run focused Jest and Deno tests and verify the new assertions fail on the current retry path.
- [ ] Remove `retry_map_generation`; add `advance_map_generation`; make `getGeneration` database-only.
- [ ] Extend prepare/start to issue and verify fresh `retry` confirmation tokens.
- [ ] Make advance resolve old queued submissions and poll/validate existing jobs only.
- [ ] Re-run focused tests and verify they pass.

### Task 2: Intent-first draft idempotency

**Files:**
- Create: `supabase/migrations/20260821130000_map_mcp_review_remediation.sql`
- Modify: `tests/unit/database/map-mcp-idempotency-migration.test.ts`
- Modify: `tests/unit/create-map/create-map-mcp-service.test.ts`
- Modify: `src/lib/server/createMapMcpService.ts`

**Interfaces:**
- Produces RPCs: `claim_map_project_v3_creation`,
  `complete_map_project_v3_creation`, and `release_map_project_v3_creation`.
- The claim hashes normalized user intent, resolved source token, and reference
  identities before planner execution.

- [ ] Write migration contract and service tests proving replay bypasses the planner and conflicts fail before it.
- [ ] Run the tests and verify RED failures identify the old post-planning hash flow.
- [ ] Add private claim state and claim/complete/release RPCs with actor-bound advisory locking.
- [ ] Refactor draft creation to resolve inputs, claim, replay or plan, then complete; release a live claim on failure.
- [ ] Re-run focused tests and verify GREEN.

### Task 3: Atomic generation preparation and recovery

**Files:**
- Modify: `supabase/migrations/20260821130000_map_mcp_review_remediation.sql`
- Create: `tests/unit/database/map-mcp-review-remediation-migration.test.ts`
- Modify: `src/features/create-map/services/createMapService.ts`
- Modify: `src/lib/server/createMapMcpService.ts`
- Modify: `tests/unit/create-map/create-map-mcp-service.test.ts`

**Interfaces:**
- Produces RPC: `prepare_map_generation_v3(map, revision, saveVersion,
  generationId, fingerprint)` returning published revision, next draft, asset,
  and status atomically.

- [ ] Write tests requiring one backend prepare call and SQL recovery for a frozen revision without an asset.
- [ ] Run focused tests and verify RED against separate freeze/create calls.
- [ ] Implement the transactional RPC and service wrapper.
- [ ] Replace separate backend calls with the atomic operation and fresh identity validation.
- [ ] Re-run focused tests and verify GREEN.

### Task 4: Viewer-safe reads and unknown outcome recovery

**Files:**
- Modify: `tests/unit/create-map/create-map-mcp-service.test.ts`
- Modify: `supabase/functions/mcp/map-tools.test.ts`
- Modify: `src/lib/server/createMapMcpService.ts`
- Modify: `supabase/functions/mcp/map-tools.ts`

**Interfaces:**
- `get_map_generation` has `readOnlyHint: true` and performs no provider call.
- `advance_map_generation` is unavailable to viewer-only tool discovery.

- [ ] Write tests for viewer reads, writer advancement, and queued-to-unknown recovery.
- [ ] Verify RED.
- [ ] Implement role-gated advancement and pure reads.
- [ ] Verify GREEN.

### Task 5: GDS codes, error redaction, and bounded pagination

**Files:**
- Modify: `supabase/functions/mcp/errors.ts`
- Modify: `supabase/functions/mcp/app-bridge.test.ts`
- Modify: `supabase/functions/mcp/gds-tools.ts`
- Modify: `supabase/functions/mcp/gds-tools.test.ts`
- Modify: `src/app/api/game-design-systems/route.ts`
- Modify: `src/app/api/game-design-systems/[id]/route.ts`
- Modify: `src/app/api/game-design-systems/[id]/versions/route.ts`
- Modify: `src/app/api/game-design-systems/generation-jobs/[id]/route.ts`
- Modify: `src/lib/services/gameDesignSystemService.ts`

**Interfaces:**
- App list query accepts bounded `limit` and nonnegative `offset` and returns
  `systems`, `hasMore`, and `nextOffset`.
- Missing GDS returns `GDS_NOT_FOUND`; stale version returns `VERSION_STALE`.
- Failed jobs expose `{ code: "GDS_GENERATION_FAILED", message: ... }` only.

- [ ] Add Deno and Jest tests for each code, redaction, and the paged App request.
- [ ] Verify RED.
- [ ] Add stable route codes and the MCP registry entry.
- [ ] Replace raw job errors with a fixed public error.
- [ ] Push list bounds into the database query and App route.
- [ ] Verify GREEN.

### Task 6: Folder toolbar parent state

**Files:**
- Modify: `tests/unit/layout/sidebar-child-folder.test.ts`
- Modify: `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Toolbar folder-create events write `pendingFolderParentId`.

- [ ] Add a source contract test for the toolbar event state.
- [ ] Run it and verify RED.
- [ ] Set `pendingFolderParentId` in the toolbar handler.
- [ ] Re-run and verify GREEN.

### Task 7: Contract updates and final verification

**Files:**
- Modify: `docs/mcp/README.md`
- Modify: `plugins/keco-claude/references/gds-map-mcp-contract.md`
- Modify: `plugins/keco-codex/references/gds-map-mcp-contract.md`
- Modify: `plugins/keco-claude/skills/keco-create-map/SKILL.md`
- Modify: `plugins/keco-codex/skills/keco-create-map/SKILL.md`

**Interfaces:**
- Documents match live tools and the no-unconfirmed-resubmission invariant.

- [ ] Update both byte-identical contracts and Skills for advance and retry-via-prepare.
- [ ] Run focused Jest, Deno, migration, plugin, typecheck, lint, build, and Playwright verification.
- [ ] Run full Jest and `git diff --check`.
- [ ] Review the final diff against all nine findings and commit the remediation.

### Task 8: Attempt-bound paid confirmation tokens

**Files:**
- Modify: `src/lib/server/createMapGenerationConfirmation.ts`
- Modify: `src/lib/server/createMapMcpService.ts`
- Modify: `tests/unit/create-map/create-map-mcp-confirmation.test.ts`
- Modify: `tests/unit/create-map/create-map-mcp-service.test.ts`

**Interfaces:**
- `MapGenerationConfirmationBinding` includes `attemptCount: number`.
- `PublicMapGenerationAsset` exposes the database `attempt_count` as `attemptCount`.
- Only a token prepared for the asset's current attempt may submit or resubmit.

- [ ] Add a confirmation codec test that signs and verifies `attemptCount` and rejects a mismatched attempt.
- [ ] Add a service test where retry attempt N advances to N+1, fails again, and replaying the attempt-N token is rejected before provider contact.
- [ ] Run the focused tests and verify RED because the binding does not contain `attemptCount`.
- [ ] Project `attempt_count`, include it in confirmation bindings, and stop verifying a paid token on queued/generating/ready replay paths that cannot contact the provider.
- [ ] Re-run the focused tests and verify GREEN.

### Task 9: Bounded newest-readable GDS list projection

**Files:**
- Modify: `supabase/migrations/20260821130000_map_mcp_review_remediation.sql`
- Modify: `tests/unit/database/map-mcp-review-remediation-migration.test.ts`
- Modify: `src/lib/services/gameDesignSystemService.ts`
- Modify: `src/lib/services/gameDesignSystemService.test.ts`

**Interfaces:**
- Produces RPC `list_latest_readable_game_design_system_versions(uuid[])`.
- The RPC is security-invoker, RLS-filtered, and returns at most one newest readable version for each supplied page system ID.
- System pagination orders by `source`, `updated_at`, then unique `id`.

- [ ] Add tests for a hidden current version with a readable older pinned version, a null-current legacy system, and deterministic `id` ordering.
- [ ] Run the focused tests and verify RED against the current-ID-only query.
- [ ] Add the bounded RPC and replace the current-ID query with one RPC call for the current page's system IDs.
- [ ] Re-run focused service and migration tests and verify GREEN.

### Task 10: Public GDS job projection

**Files:**
- Modify: `src/lib/services/gameDesignSystemService.ts`
- Modify: `src/app/api/game-design-systems/generation-jobs/route.ts`
- Modify: `src/app/api/game-design-systems/generation-jobs/[id]/route.ts`
- Modify: `src/app/api/game-design-systems/generation-jobs/[id]/retry/route.ts`
- Modify: `tests/unit/mcp/gds-app-route-contract.test.ts`

**Interfaces:**
- Produces `PublicGameDesignSystemGenerationJob` and `publicGameDesignSystemGenerationJob(job)`.
- Failed public jobs expose only `{ code: 'GDS_GENERATION_FAILED', message: 'Game Design System generation failed.' }`; non-failed jobs expose `error: null`.

- [ ] Add route tests proving POST, GET, and retry responses never include stored SQL/provider diagnostic text.
- [ ] Run the route tests and verify RED.
- [ ] Add one shared projection and apply it to all three App API responses.
- [ ] Re-run the route tests and verify GREEN.

### Task 11: Complete browser GDS pagination

**Files:**
- Modify: `src/lib/services/gameDesignSystemClient.ts`
- Create: `src/lib/services/gameDesignSystemClient.test.ts`

**Interfaces:**
- `fetchGameDesignSystems()` follows `hasMore` and `nextOffset` until complete.
- Each request uses a bounded `limit`; repeated/non-progressing offsets and an explicit maximum page count fail safely.

- [ ] Add client tests for multiple pages and a non-progressing server cursor.
- [ ] Run the focused test and verify RED because only the first response is used.
- [ ] Implement the bounded pagination loop with a progress guard.
- [ ] Re-run the client test and verify GREEN.

### Task 12: Stable GDS App/MCP error codes

**Files:**
- Modify: `src/app/api/game-design-systems/generation-jobs/route.ts`
- Modify: `src/app/api/game-design-systems/generation-jobs/[id]/retry/route.ts`
- Modify: `src/app/api/projects/[projectId]/game-design-system/route.ts`
- Modify: `tests/unit/mcp/gds-app-route-contract.test.ts`
- Modify: `supabase/functions/mcp/app-bridge.test.ts`

**Interfaces:**
- Missing systems, versions, and retry jobs return `GDS_NOT_FOUND`.
- Generation idempotency conflicts return `IDEMPOTENCY_CONFLICT`.
- Non-failed job retries and conflicted version bindings return `GDS_JOB_CONFLICT`.

- [ ] Add App route tests for each MCP-used 404/409 branch and verify RED.
- [ ] Add the stable public code to every response without exposing internal diagnostics.
- [ ] Re-run App route and MCP bridge tests and verify GREEN.

### Task 13: Final remediation verification and commit

**Files:**
- Modify test coverage where live PostgreSQL behavior exposes a missing assertion.

- [ ] Exercise the new migration in PostgreSQL, including authenticated grants/RLS and map claim/prepare recovery paths where the local harness permits.
- [ ] Run focused Jest, full Jest, full MCP Deno, PixelLab lifecycle, typechecks, lint, build, plugin validators, migration transaction, and `git diff --check`.
- [ ] Do not run the real paid PixelLab acceptance request.
- [ ] Request a fresh independent whole-diff review and fix all Critical/Important findings.
- [ ] Commit the task files while excluding `.superpowers/`; do not merge.

### Task 14: Close direct PixelLab paid-submit bypasses

**Files:**
- Modify: `supabase/functions/pixellab-map/auth.ts`
- Modify: `supabase/functions/pixellab-map/index.ts`
- Modify: `src/lib/server/createMapMcpService.ts`
- Modify: `src/features/create-map/services/createMapService.ts`
- Modify: `src/features/create-map/hooks/useDirectMapGeneration.ts`
- Modify: `src/features/create-map/components/DirectMapGenerationPanel.tsx`
- Test: `supabase/functions/pixellab-map/auth.test.ts`
- Test: `tests/unit/create-map/direct-map-generation-hook.test.ts`
- Test: `tests/unit/create-map/direct-map-generation-panel.test.tsx`

**Interfaces:**
- User JWTs may poll, validate, and resolve an unknown direct-map operation, but cannot submit or retry a paid `map_image` operation.
- App/MCP provider submissions use service-role authentication plus a server-bound `actorUserId` and current editor/admin authorization.
- Browser submit and retry attempts call the same prepare/confirmation/start protocol as MCP and never invoke PixelLab directly.

- [ ] Add failing Edge authorization and browser hook/panel tests for each bypass.
- [ ] Verify RED against the direct user-JWT submit/retry and one-click retry paths.
- [ ] Add generic service-role asset authorization with actor and project binding.
- [ ] Route App/MCP paid submissions through the service-role client with `expectedAttemptCount`.
- [ ] Replace browser direct submit/retry calls with prepare plus confirmed start and require a fresh fee confirmation for retry.
- [ ] Re-run focused Edge and Jest tests and verify GREEN.

### Task 15: Distinct generation-conflict SQLSTATE and public attempt DTO

**Files:**
- Modify: `supabase/migrations/20260821130000_map_mcp_review_remediation.sql`
- Modify: `src/lib/server/createMapMcpService.ts`
- Modify: `supabase/functions/mcp/map-tools.ts`
- Test: `tests/unit/database/map-mcp-review-remediation-migration.test.ts`
- Test: `tests/unit/create-map/create-map-mcp-service.test.ts`
- Test: `supabase/functions/mcp/map-tools.test.ts`

**Interfaces:**
- `KM409` remains reserved for draft idempotency conflicts.
- Atomic generation identity conflicts use `KM413` and map to `MAP_REVISION_STALE`.
- MCP generation payloads retain `attemptCount`.

- [ ] Add failing tests for the distinct SQLSTATE mapping and projected attempt count.
- [ ] Verify RED.
- [ ] Implement the migration, service mapping, and MCP projection changes.
- [ ] Re-run focused tests and verify GREEN.
