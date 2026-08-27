# Character Animation MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-only Keco MCP workflow that generates a canonical character from text and generates horizontal animation spritesheets from that character.

**Architecture:** A strict discriminated `CharacterAssetPlanV1` is persisted in project-owned character asset tables. A dedicated authenticated app service and `pixellab-character` Edge Function implement draft concurrency, two-step paid confirmation, provider submission/polling, PNG validation, and private storage; MCP tools are thin validated adapters over that service.

**Tech Stack:** Next.js 16 route handlers, TypeScript 5.9, Zod 3, Supabase/PostgreSQL/RLS, Supabase Edge Functions on Deno 2, MCP SDK 1.29, Jest 30, Deno tests.

**Spec:** `docs/superpowers/specs/2026-08-27-character-animation-mcp-design.md`

## Global Constraints

- Character generation and animation generation are separate paid provider jobs with separate confirmations.
- `character-pro` and `animate-text-pro` are typed capabilities; generic image generation is not a fallback.
- Provider credentials, confirmation tokens, raw responses, and signed URLs are never persisted or logged.
- Animations reference a same-project ready character and its exact SHA-256.
- Ready animation PNG geometry is exactly `frameWidth * frameCount` by `frameHeight`.
- Version 1 exposes MCP and server persistence only; it adds no frontend or local Godot writes.
- Normal automated tests and probes never spend provider credits.

---

### Task 1: Shared Character Asset Plan Contract

**Files:**
- Create: `src/features/character-assets/model/characterAssetSchema.ts`
- Create: `tests/unit/character-assets/character-asset-schema.test.ts`

**Interfaces:**
- Produces: `CharacterAssetPlanV1Schema`, `CharacterPlanV1Schema`, `AnimationPlanV1Schema`, `CharacterAssetPlanV1`, `validateCharacterAssetPlanV1(input)`, `fingerprintCharacterAssetPlanV1(plan)`.
- Constraints: character sizes are positive powers-of-two from 16 through 256; animation `frameCount` is 2 through 32; `fps` is 1 through 60; prompts are nonblank and at most 2,000 characters.

- [ ] **Step 1: Write schema tests for both variants and invalid source/frame inputs**

```ts
expect(validateCharacterAssetPlanV1(characterPlan).success).toBe(true);
expect(validateCharacterAssetPlanV1(animationPlan).success).toBe(true);
expect(validateCharacterAssetPlanV1({ ...animationPlan, frameCount: 0 }).success).toBe(false);
```

- [ ] **Step 2: Run the focused test and confirm it fails because the module is absent**

Run: `npx jest --runInBand tests/unit/character-assets/character-asset-schema.test.ts`

- [ ] **Step 3: Implement strict discriminated schemas, safe prompt validation, and canonical SHA-256 fingerprinting**

```ts
export const CharacterAssetPlanV1Schema = z.discriminatedUnion('kind', [
  CharacterPlanV1Schema,
  AnimationPlanV1Schema,
]);
```

- [ ] **Step 4: Run the focused test and typecheck**

Run: `npx jest --runInBand tests/unit/character-assets/character-asset-schema.test.ts && npm run typecheck`

- [ ] **Step 5: Commit the contract**

```bash
git add src/features/character-assets/model/characterAssetSchema.ts tests/unit/character-assets/character-asset-schema.test.ts
git commit -m "feat: add character asset plan contract"
```

### Task 2: Durable Database And Storage Contract

**Files:**
- Create: `supabase/migrations/20260827010000_character_animation_mcp.sql`
- Create: `tests/unit/database/character-animation-migration.test.ts`
- Modify: `src/lib/server/projectDeletion.ts`
- Modify: `tests/unit/project-delete-server-boundary.test.ts`

**Interfaces:**
- Produces tables `character_assets` and `character_generation_attempts`.
- Produces RPCs `create_character_asset_draft`, `update_character_asset_draft`, `prepare_character_asset_generation`, and `transition_character_generation`.
- Produces private bucket `character-assets` and project-scoped storage policy.

- [ ] **Step 1: Write migration contract tests for strict plan validation, RLS, RPC grants, storage paths, and cleanup**

```ts
expect(sql).toMatch(/create table public\.character_assets/i);
expect(sql).toMatch(/create function public\.prepare_character_asset_generation/i);
expect(sql).toMatch(/bucket_id = 'character-assets'/i);
```

- [ ] **Step 2: Run migration and project deletion tests to verify failure**

Run: `npx jest --runInBand tests/unit/database/character-animation-migration.test.ts tests/unit/project-delete-server-boundary.test.ts`

- [ ] **Step 3: Implement tables, constraints, RLS, compare-and-swap RPCs, atomic transitions, and storage bucket**

The prepare RPC creates one immutable planned attempt for the current plan
fingerprint and returns the existing matching attempt on replay. The transition
RPC locks the row, validates expected state and attempt count, and writes ready
metadata only when every required field is present.

- [ ] **Step 4: Extend project deletion cleanup to include `character-assets` paths**

Return cleanup jobs per bucket so existing map cleanup remains unchanged and
character paths are deleted from their own bucket.

- [ ] **Step 5: Run focused migration and deletion tests**

Run: `npx jest --runInBand tests/unit/database/character-animation-migration.test.ts tests/unit/project-delete-server-boundary.test.ts`

- [ ] **Step 6: Commit persistence**

```bash
git add supabase/migrations/20260827010000_character_animation_mcp.sql tests/unit/database/character-animation-migration.test.ts src/lib/server/projectDeletion.ts tests/unit/project-delete-server-boundary.test.ts
git commit -m "feat: persist character generation assets"
```

### Task 3: Confirmation Binding And Character MCP Service

**Files:**
- Create: `src/lib/server/characterAssetGenerationConfirmation.ts`
- Create: `src/lib/server/characterAssetMcpService.ts`
- Create: `tests/unit/character-assets/character-asset-mcp-service.test.ts`

**Interfaces:**
- Produces: `CharacterAssetMcpError`, `CharacterAssetMcpErrorCode`, `createCharacterAssetMcpService(context, dependencies?)`.
- Service methods: `listAssets`, `readAsset`, `createDraft`, `updateDraft`, `prepareGeneration`, `startGeneration`, `getGeneration`, `advanceGeneration`.
- Confirmation binding: `{ purpose, userId, projectId, assetId, generationId, planFingerprint, attemptCount }`.

- [ ] **Step 1: Write service tests using an injected backend**

Cover writer authorization, idempotent create result, stale update, source hash
validation, prepare without provider invocation, token mismatch, replay-safe
start, retry confirmation, provider-free get, and poll-only advance.

- [ ] **Step 2: Run the service test and verify missing-module failure**

Run: `npx jest --runInBand tests/unit/character-assets/character-asset-mcp-service.test.ts`

- [ ] **Step 3: Implement purpose-bound signing using the existing agent confirmation secret**

Use distinct purposes `character-submit`, `animation-submit`, `retry`, and
`replace-unknown`; tokens expire after ten minutes.

- [ ] **Step 4: Implement the service state machine with an injectable backend**

Map provider errors to stable public character errors and redact all unsafe
messages. `prepareGeneration` performs capability preflight but not generation;
`startGeneration` is the only submit path.

- [ ] **Step 5: Implement the Supabase backend adapter**

Read/write only through the new tables and RPCs, issue five-minute signed preview
URLs only for ready attempts, and invoke `pixellab-character` with the service
role plus `actorUserId`.

- [ ] **Step 6: Run focused tests and TypeScript checks**

Run: `npx jest --runInBand tests/unit/character-assets/character-asset-mcp-service.test.ts && npm run typecheck && npm run typecheck:api`

- [ ] **Step 7: Commit the service**

```bash
git add src/lib/server/characterAssetGenerationConfirmation.ts src/lib/server/characterAssetMcpService.ts tests/unit/character-assets/character-asset-mcp-service.test.ts
git commit -m "feat: add character asset MCP service"
```

### Task 4: Authenticated Application Route

**Files:**
- Create: `src/app/api/mcp/character-assets/route.ts`
- Create: `tests/unit/character-assets/character-asset-mcp-route.test.ts`

**Interfaces:**
- Consumes all service methods from Task 3.
- Produces `POST /api/mcp/character-assets` with a strict action-discriminated body.

- [ ] **Step 1: Write route tests for authentication, strict schemas, action dispatch, status codes, and error sanitization**

- [ ] **Step 2: Run the route test and verify missing-route failure**

Run: `npx jest --runInBand tests/unit/character-assets/character-asset-mcp-route.test.ts`

- [ ] **Step 3: Implement schemas and dispatch**

The start action requires `confirmPaidGeneration: true`, an exact generation
identity, `attemptCount`, and a bounded confirmation token. Responses use
`Cache-Control: private, no-store`.

- [ ] **Step 4: Run route, service, and type tests**

Run: `npx jest --runInBand tests/unit/character-assets/character-asset-mcp-route.test.ts tests/unit/character-assets/character-asset-mcp-service.test.ts && npm run typecheck:api`

- [ ] **Step 5: Commit the route**

```bash
git add src/app/api/mcp/character-assets/route.ts tests/unit/character-assets/character-asset-mcp-route.test.ts
git commit -m "feat: expose character asset app API"
```

### Task 5: PixelLab Character Provider Function

**Files:**
- Create: `supabase/functions/pixellab-character/deno.json`
- Create: `supabase/functions/pixellab-character/types.ts`
- Create: `supabase/functions/pixellab-character/provider-response.ts`
- Create: `supabase/functions/pixellab-character/pixellab-client.ts`
- Create: `supabase/functions/pixellab-character/png.ts`
- Create: `supabase/functions/pixellab-character/storage.ts`
- Create: `supabase/functions/pixellab-character/index.ts`
- Create: `supabase/functions/pixellab-character/pixellab-client.test.ts`
- Create: `supabase/functions/pixellab-character/lifecycle.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Accepts service-role requests `{ operation, projectId, assetId, generationId, planFingerprint, expectedAttemptCount, actorUserId }`.
- Operations: `capabilities`, `submit`, `retry`, `poll`, `validate`, `resolve_unknown`.
- Character submit prefers compatible live `create_character`/`get_character`
  typed MCP tools and otherwise uses official `POST /v2/create-character-pro`;
  animation submit uses discovered `animate_with_text` MCP.

- [ ] **Step 1: Write provider contract tests for discovery, argument mapping, status parsing, and error mapping**

- [ ] **Step 2: Write lifecycle tests for authorization, submit, poll, validation, persistence, and unknown outcomes**

- [ ] **Step 3: Run Deno tests and verify missing implementation failures**

Run: `deno test --config supabase/functions/pixellab-character/deno.json --allow-env --allow-net supabase/functions/pixellab-character`

- [ ] **Step 4: Implement bounded provider client and response parsing**

Character calls first validate live `create_character` and `get_character`
schemas, preserving `mode: pro`; if they are absent, the adapter uses
`https://api.pixellab.ai/v2/create-character-pro` and its documented retrieval
contract. Animation uses live MCP schemas; all downloads require credential-free
HTTPS or bounded PNG data URLs.

- [ ] **Step 5: Implement PNG validation and deterministic private persistence**

Reject oversized, malformed, blank, opaque character, or geometrically invalid
animation output before upload. Read stored bytes back and compare SHA-256 before
the ready transition.

- [ ] **Step 6: Implement authorized lifecycle entrypoint and configure the function**

- [ ] **Step 7: Run Deno tests and checks**

Run: `deno test --config supabase/functions/pixellab-character/deno.json --allow-env --allow-net supabase/functions/pixellab-character && deno check --config supabase/functions/pixellab-character/deno.json supabase/functions/pixellab-character/index.ts`

- [ ] **Step 8: Commit the provider function**

```bash
git add supabase/functions/pixellab-character supabase/config.toml
git commit -m "feat: generate characters and animation sheets"
```

### Task 6: Public MCP Tool Registration

**Files:**
- Create: `supabase/functions/mcp/character-tools.ts`
- Create: `supabase/functions/mcp/character-tools.test.ts`
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `supabase/functions/mcp/index.ts`
- Modify: `supabase/functions/mcp/errors.ts`
- Modify: `scripts/probe-mcp-capabilities.ts`
- Modify: `tests/unit/mcp/capabilities-probe.test.ts`

**Interfaces:**
- Consumes `POST /api/mcp/character-assets` from Task 4.
- Produces eight tools named in the design spec with account/legacy project shape and viewer filtering.

- [ ] **Step 1: Write MCP registration tests for schemas, descriptions, annotations, payload shaping, and viewer visibility**

- [ ] **Step 2: Run focused MCP tests and verify tool absence**

Run: `deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp/character-tools.test.ts`

- [ ] **Step 3: Implement the thin tool adapter and safe result shaping**

- [ ] **Step 4: Register operation classes and stable error codes**

- [ ] **Step 5: Update capability probes and their unit contract**

- [ ] **Step 6: Run MCP, probe, and type checks**

Run: `npm run check:mcp && npm run test:mcp && npx jest --runInBand tests/unit/mcp/capabilities-probe.test.ts`

- [ ] **Step 7: Commit MCP registration**

```bash
git add supabase/functions/mcp scripts/probe-mcp-capabilities.ts tests/unit/mcp/capabilities-probe.test.ts
git commit -m "feat: register character asset MCP tools"
```

### Task 7: Documentation And Opt-In Acceptance

**Files:**
- Modify: `docs/mcp/README.md`
- Modify: `plugins/keco-codex/references/pixellab-capability-registry.md`
- Modify: `plugins/keco-claude/references/pixellab-capability-registry.md`
- Create: `scripts/accept-character-animation-paid.ts`
- Modify: `package.json`
- Create: `tests/unit/character-assets/character-asset-docs.test.ts`

**Interfaces:**
- Produces documented two-stage confirmation sequence and opt-in `accept:character-animation:paid` command.

- [ ] **Step 1: Write documentation contract tests for every tool and the two separate fee confirmations**

- [ ] **Step 2: Update MCP and provider capability documentation**

- [ ] **Step 3: Add an opt-in acceptance script guarded by both `KECO_ACCEPTANCE_CHARACTER_ANIMATION=true` and `KECO_ACCEPTANCE_CONFIRM_PAID=true`**

- [ ] **Step 4: Run docs tests without making provider calls**

Run: `npx jest --runInBand tests/unit/character-assets/character-asset-docs.test.ts`

- [ ] **Step 5: Commit docs and acceptance tooling**

```bash
git add docs/mcp/README.md plugins/keco-codex/references/pixellab-capability-registry.md plugins/keco-claude/references/pixellab-capability-registry.md scripts/accept-character-animation-paid.ts package.json tests/unit/character-assets/character-asset-docs.test.ts
git commit -m "docs: document character animation MCP"
```

### Task 8: Regression Verification

**Files:**
- Modify only files required by concrete failures found in this task.

**Interfaces:**
- Produces a verified implementation with no paid provider calls.

- [ ] **Step 1: Run all character-focused tests**

Run: `npx jest --runInBand tests/unit/character-assets tests/unit/database/character-animation-migration.test.ts`

- [ ] **Step 2: Run all MCP tests and checks**

Run: `npm run check:mcp && npm run test:mcp`

- [ ] **Step 3: Run Create Map and project deletion regressions**

Run: `npm run test:create-map-v3 && npx jest --runInBand tests/unit/project-delete-server-boundary.test.ts`

- [ ] **Step 4: Run static verification**

Run: `npm run lint && npm run typecheck && npm run typecheck:api`

- [ ] **Step 5: Inspect the final diff and scan for secret or signed URL persistence**

Run: `git diff --check && rg -n "PIXELLAB_API_TOKEN|confirmationToken|signedUrl" src/features/character-assets src/lib/server/characterAsset* supabase/functions/pixellab-character supabase/migrations/20260827010000_character_animation_mcp.sql`

- [ ] **Step 6: Commit only concrete verification repairs, if any**

Stage each file named by `git diff --name-only`, review the staged diff, and use
the commit message `fix: harden character animation MCP`. Skip this step when
verification required no repair.
