# Game Design Rule System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unsafe Markdown-first Game Design System MVP with versioned structured rules, real source snapshots, a recoverable leased worker, and bounded Agent policy injection.

**Status:** Complete.

**Architecture:** PostgreSQL owns immutable versions, pinned project bindings, idempotent jobs, and atomic leases. Next.js resolves authorized source snapshots, runs an opportunistic worker plus a Cron recovery worker, and exposes typed APIs. React renders and edits structured rules; Markdown is generated deterministically.

**Tech Stack:** Next.js 16, React 19, Supabase PostgreSQL/RLS, Zod, `mdast-util-from-markdown`, Jest, Playwright, existing OpenAI-compatible DeepSeek client.

## Global Constraints

- Canonical serialized rule JSON is at most 64 KiB with no unknown properties.
- A rule version has at most 80 rules and 20 table-guidance entries.
- Source excerpts total at most 60,000 characters.
- Agent policy injection is at most 12,000 characters.
- Project bindings pin an immutable version and require owner/admin permission.
- Jobs use a 90-second lease and at most 3 attempts.
- Existing user changes and unrelated files must not be reverted.

---

### Task 1: Structured rule contract

**Files:**
- Create: `src/lib/game-design-system/ruleSchema.ts`
- Create: `src/lib/game-design-system/ruleMarkdown.ts`
- Create: `src/lib/game-design-system/ruleDiff.ts`
- Test: `src/lib/game-design-system/ruleSchema.test.ts`

**Interfaces:**
- Produces: `parseRuleSet`, `renderRuleSetMarkdown`, `diffRuleSets`, `buildLegacyRuleSet`.

- [x] Write failing tests that reject unknown fields, duplicate IDs, empty rules, oversized JSON, and invalid limits; assert deterministic Markdown and add/change/remove/kind-conflict diffs.
- [x] Run `npx jest --runInBand src/lib/game-design-system/ruleSchema.test.ts` and confirm the missing-module failure.
- [x] Implement strict Zod schemas, deterministic rendering, compatibility conversion, and stable diffing.
- [x] Re-run the focused test and confirm all cases pass.

### Task 2: Versioned database and durable jobs

**Files:**
- Create: `supabase/migrations/20260814020000_game_design_rule_system.sql`
- Create: `tests/unit/database/game-design-rule-system-migration.test.ts`

**Interfaces:**
- Produces tables `game_design_system_versions`, upgraded jobs/bindings, and RPCs `claim_game_design_system_generation_job`, `heartbeat_game_design_system_generation_job`, `retry_game_design_system_generation_job`.

- [x] Write migration contract tests for version immutability, pinned bindings, owner/admin policies, idempotency uniqueness, claim SQL locking, lease recovery, and service-role grants.
- [x] Run the migration test and confirm it fails because the migration is absent.
- [x] Add the additive/backfill migration. Convert existing rows to version 1 with `build_legacy`-compatible JSON and pin existing bindings.
- [x] Apply the migration to local Supabase and run SQL probes for concurrent claim exclusion and lease recovery.
- [x] Re-run the migration contract tests.

### Task 3: Version and job data services

**Files:**
- Replace: `src/lib/services/gameDesignSystemService.ts`
- Create: `src/lib/services/gameDesignSystemService.test.ts`

**Interfaces:**
- Produces: `listGameDesignSystems`, `getGameDesignSystemDetail`, `createGameDesignSystemVersion`, `claimGenerationJob`, `heartbeatGenerationJob`, `completeGenerationJob`, `retryGenerationJob`, and pinned binding helpers.

- [x] Write failing service tests against a behavioral Supabase harness for immutable version creation, conflict rejection, idempotent job reuse/conflict, lease ownership, and pinned binding reads.
- [x] Implement typed service operations with explicit selected columns and bounded patches.
- [x] Run focused service tests and typecheck.

### Task 4: Real resource options and snapshots

**Files:**
- Create: `src/lib/game-design-system/sourceSnapshots.ts`
- Create: `src/lib/game-design-system/sourceSnapshots.test.ts`
- Create: `src/app/api/game-design-systems/reference-options/route.ts`

**Interfaces:**
- Produces: `listGameDesignReferenceOptions(supabase, projectId)` and `resolveGameDesignSourceSnapshots(supabase, refs)`.

- [x] Write failing tests proving Document content and Table field/value content enter snapshots, cross-project IDs fail, hashes change with content, and total overflow is rejected.
- [x] Implement authorized Document and Table reads using existing project access and RLS, deterministic normalization, SHA-256 hashing, and exact caps.
- [x] Add the authenticated resource-options route.
- [x] Run focused tests and route-auth static checks.

### Task 5: DeepSeek structured generation and leased worker

**Files:**
- Replace: `src/lib/gameDesignSystemGeneration.ts`
- Create: `src/lib/game-design-system/worker.ts`
- Create: `src/lib/game-design-system/worker.test.ts`
- Modify: `src/app/api/game-design-systems/generation-jobs/route.ts`
- Create: `src/app/api/game-design-systems/generation-jobs/[id]/retry/route.ts`
- Create: `src/app/api/internal/game-design-system-worker/route.ts`
- Create: `vercel.json`

**Interfaces:**
- Produces: `processNextGameDesignSystemJob({ workerId, serviceClient })` and protected Cron GET.

- [x] Write failing tests for JSON-only prompts containing real snapshots, one repair pass, lease heartbeat, retry delays, permanent validation failure, and idempotency header behavior.
- [x] Implement JSON generation and strict `parseRuleSet`; render Markdown only after validation.
- [x] Implement service-role leased processing. The accepting request uses `after()` only as an optimization.
- [x] Add retry and Cron routes plus one-minute schedule.
- [x] Run worker, route, type and build tests.

### Task 6: Secure Agent policy injection

**Files:**
- Create: `src/lib/game-design-system/agentPolicy.ts`
- Create: `src/lib/game-design-system/agentPolicy.test.ts`
- Modify: `src/lib/agent/core.ts`
- Modify: `src/lib/agent/prompts.ts`
- Modify: `tests/unit/agent/system-prompt.test.ts`

**Interfaces:**
- Produces: `buildAgentRulePolicy(ruleSet): { text: string; appliedRuleIds: string[]; omittedRuleIds: string[] }` and persisted model-declared rule evidence.

- [x] Write failing tests proving raw Markdown, rationale, provenance, control characters, fake system instructions, and text after 12,000 characters are excluded.
- [x] Implement normalized allow-listed serialization and explicit untrusted-data boundaries.
- [x] Load the pinned version in Agent context, budget required rules first, record omissions, and parse/validate/persist/stream compact applied-rule evidence for relevant design tasks.
- [x] Run prompt and policy tests.

### Task 7: Versioned API surface

**Files:**
- Modify: `src/app/api/game-design-systems/route.ts`
- Modify: `src/app/api/game-design-systems/[id]/route.ts`
- Modify: `src/app/api/game-design-systems/[id]/copy/route.ts`
- Create: `src/app/api/game-design-systems/[id]/versions/route.ts`
- Modify: `src/app/api/projects/[projectId]/game-design-system/route.ts`
- Replace: `src/lib/services/gameDesignSystemClient.ts`
- Replace: `tests/unit/game-design-system-routes.test.ts`

**Interfaces:**
- Consumes all Tasks 1-6 service interfaces.
- Produces the API contract in `specs/032-game-design-rule-system/spec.md`.

- [x] Replace mock-everything route tests with handler tests that keep validation and authorization behavior real while mocking only Supabase transport.
- [x] Implement version detail/create, metadata editing, explicit version binding, owner/admin enforcement, and retry routes.
- [x] Run route tests and `tests/unit/auth/api-auth-static.test.ts`.

### Task 8: Resource picker and version UI

**Files:**
- Replace: `src/components/game-design-system/GameDesignSystemCreatePage.tsx`
- Replace: `src/components/game-design-system/GameDesignSystemsPage.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.module.css`
- Create: `src/components/game-design-system/GameDesignSystemCreatePage.test.tsx`
- Create: `src/components/game-design-system/GameDesignSystemsPage.test.tsx`
- Delete: `tests/unit/game-design-system-ui.test.ts`

**Interfaces:**
- Consumes the versioned browser client and reference-options API.

- [x] Add a jsdom testing setup if needed and write rendered interaction tests for project/resource selection, validation, progress/retry, metadata editing, version diff, and concrete-version binding.
- [x] Implement the real resource picker, restrict generation bases to official/owned systems, and render structured rule/version detail.
- [x] Remove manual project-ID inputs and raw Markdown editing.
- [x] Run component tests at desktop and mobile-relevant states.

### Task 9: Real database and browser acceptance

**Files:**
- Replace: `tests/e2e/specs/game-design-system.spec.ts`
- Create: `scripts/verify-game-design-system-jobs.ts`

**Interfaces:**
- Verifies all acceptance criteria against local Supabase and real DeepSeek.

- [x] Add database verification for worker claim/recovery and a regular Jest RLS behavior test proving non-owners can read only a project-pinned personal-system version.
- [x] Update Playwright to create real Document/Table source content, select both through UI, generate, inspect snapshot/version/diff, bind, read Agent policy, and clean up.
- [x] Run focused Jest, database verifier, Playwright, lint, typecheck, and production build.
- [x] Confirm no test systems, bindings, or leased jobs remain.
