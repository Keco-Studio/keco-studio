# Create Map V3 Real Chain Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair V3 planning and database compatibility, then leave one real generated map visible in the `test` project's Saved Maps list.

**Architecture:** Keep V3 validation strict while normalizing only provider-owned invariants before validation. Add a forward repair migration for partially installed databases and use the existing paid acceptance path to persist, generate, validate, and bind the ready image into the current draft.

**Tech Stack:** Next.js 16, TypeScript 5.9, Zod 3, Jest 30, Supabase/Postgres, Supabase Edge Functions, Deno, PixelLab MCP.

## Global Constraints

- Do not reset or delete retained local database records.
- Do not expose provider bodies, credentials, signed URLs, or API keys.
- Create at most one new PixelLab paid generation for final acceptance.
- The result must remain visible and restorable through Create Map Saved Maps.
- Do not commit or push without an explicit user request.

---

### Task 1: V3 Planner Normalization

**Files:**
- Modify: `tests/unit/create-map/create-map-planner.test.ts`
- Modify: `src/lib/server/createMapPlanner.ts`

**Interfaces:**
- Produces: `normalizeDirectMapPlanCandidate(candidate, selection)` used by `createMapPlanV3` before strict validation.

- [ ] Add a failing test for DeepSeek candidates with mismatched supported dimensions and provider-owned V3 fields.
- [ ] Run the focused planner test and confirm it fails for missing normalization.
- [ ] Implement minimal normalization for schema version, supported profile pair, authorized references, fixed provider operation, `noBackground: false`, and nullable seed.
- [ ] Run planner tests and confirm correction behavior remains strict for unsafe descriptions.

### Task 2: Forward Database Repair

**Files:**
- Create: `supabase/migrations/20260813010000_repair_create_map_v3_payload_validator.sql`
- Modify: `tests/unit/database/create-map-v3-migration.test.ts`

**Interfaces:**
- Reinstalls: `public.map_validate_v3_payload(jsonb, jsonb)` with optional strict collision-grid support.

- [ ] Add a failing migration structure test requiring safe detection of the legacy validator and dependent RPC plan invalidation.
- [ ] Run the database unit test and confirm the repair migration is missing.
- [ ] Add the forward migration without modifying or deleting retained data.
- [ ] Apply it to the local database and execute a real V3 create RPC with `collisionGrid: null`.

### Task 3: Regression Verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes the planner and migration repairs.

- [ ] Run focused planner and migration Jest suites.
- [ ] Run `npm run test:create-map-v3`.
- [ ] Run PixelLab Edge Function tests.
- [ ] Run TypeScript checks and `git diff --check`.

### Task 4: Real Project-Visible Acceptance

**Files:**
- Modify only if required: `scripts/accept-create-map-v3-paid.ts`

**Interfaces:**
- Consumes project `b8bbc964-c463-4044-93fc-6428fd37534c` and document `7ec60c55-2c6a-497f-b761-a4505c86a885`.
- Produces one ready `map_image`, one bound current V3 draft, and Saved Maps/browser evidence.

- [ ] Call the real plan route with the real document and require a valid V3 plan.
- [ ] Create and publish a named map under the `test` project.
- [ ] Submit one PixelLab generation, poll to completion, validate, and verify private storage bytes.
- [ ] Bind the ready image into the current draft and save it.
- [ ] Open the saved map in the browser and verify the generated image is visible.
