# Create Map Native Size Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Create Map V3 to 17 curated PixelLab-native output presets while preserving exact dimensions through planning, persistence, generation, and collision-grid validation.

**Architecture:** Keep the existing TypeScript profile catalog as the application authority and mirror the exact pairs at the isolated GDD, Edge Function, and PostgreSQL boundaries. The UI continues to derive options from the catalog. A forward-only migration replaces both layers of the V3 database validator so new map sizes and their 8-pixel collision grids are accepted together.

**Tech Stack:** TypeScript, React, Zod, Jest, Deno, PostgreSQL/Supabase migrations.

## Global Constraints

- Do not use TDD; implement each bounded change first, then add or update focused regression tests.
- Do not resize, crop, pad, upscale, or substitute another profile.
- Do not change paid-generation confirmation or retry behavior.
- Accept only these exact pairs: `256x256`, `384x384`, `512x512`, `512x288`, `512x320`, `512x384`, `576x384`, `624x416`, `640x320`, `688x384`, `288x512`, `320x512`, `384x512`, `384x576`, `416x624`, `320x640`, `384x688`.
- Every accepted width and height is divisible by the collision-grid cell size of 8.
- Preserve existing unrelated worktree changes.

---

### Task 1: Expand Application And GDD Profile Catalogs

**Files:**
- Modify: `src/features/create-map/model/directMapSchema.ts`
- Modify: `src/lib/server/createMapPlanner.ts`
- Modify: `src/lib/gdd-generation/maps/contracts.ts`
- Modify: `src/lib/gdd-generation/maps/compiler.ts`
- Modify: `tests/unit/create-map/direct-map-schema.test.ts`
- Modify: `tests/unit/create-map/direct-map-plan-inspector.test.tsx`
- Modify: `tests/unit/create-map/create-map-planner.test.ts`
- Modify: `src/lib/gdd-generation/maps/compiler.test.ts`
- Modify: `src/lib/gdd-generation/maps/plan.test.ts`

**Interfaces:**
- Consumes: existing `DIRECT_MAP_PROFILES`, `validateMapPlanV3`, `rawMapBriefSchema`, and `outputSize` contracts.
- Produces: one ordered 17-pair UI/planner catalog and an equivalent GDD `outputSize` enum.

- [x] **Step 1: Replace the three-entry application catalog**

Set `DIRECT_MAP_PROFILE_VALUES` to the exact ordered string list in Global Constraints and derive `DIRECT_MAP_PROFILES` from it so `DirectMapPlanInspector` renders all options without component changes.

- [x] **Step 2: Expand planner structured-output constraints**

Update the V3 planner's width/height schema hints and system prompt to expose the expanded catalog. Exact pair validity remains enforced by `validateMapPlanV3`; independent width and height schema enums must contain every axis value used by the catalog.

- [x] **Step 3: Expand GDD map contracts and prompt**

Replace the three-value `outputSize` Zod enum and both compiler prompt strings with the same 17 serialized `WIDTHxHEIGHT` values. `mapPlanFromGddBrief` continues splitting the selected string without transformation.

- [x] **Step 4: Update focused application tests after implementation**

Use `it.each(DIRECT_MAP_PROFILES)` for acceptance coverage, keep representative rejection cases, assert that the inspector renders 17 options, and assert a newly added landscape and portrait size flow through planner normalization and GDD plan creation unchanged.

- [x] **Step 5: Run application and GDD tests**

Run:

```bash
npx jest --runInBand tests/unit/create-map/direct-map-schema.test.ts tests/unit/create-map/direct-map-plan-inspector.test.tsx tests/unit/create-map/create-map-planner.test.ts src/lib/gdd-generation/maps/compiler.test.ts src/lib/gdd-generation/maps/plan.test.ts
```

Expected: all selected suites pass.

### Task 2: Expand Provider And Database Guards

**Files:**
- Modify: `supabase/functions/pixellab-map/direct-map.ts`
- Modify: `supabase/functions/pixellab-map/direct-map.test.ts`
- Create: `supabase/migrations/20260829010000_expand_create_map_v3_native_sizes.sql`
- Modify: `tests/unit/database/create-map-v3-migration.test.ts`

**Interfaces:**
- Consumes: exact plan dimensions from Task 1 and the existing `map_validate_v3_payload_without_collision_grid(jsonb,jsonb)` / `map_validate_v3_payload(jsonb,jsonb)` function layering.
- Produces: provider submission and persisted V3 payload acceptance for the same 17 pairs.

- [x] **Step 1: Expand the Edge Function profile set**

Replace `PROFILES` with the same 17 `WIDTHxHEIGHT` strings. Preserve the current `pixellab_capability_missing` failure before provider submission for any other pair.

- [x] **Step 2: Add a forward-only database migration**

Create `20260829010000_expand_create_map_v3_native_sizes.sql`. Replace the public collision wrapper without editing historical migrations. Check the original pair against all 17 presets, normalize only the legacy base validator's temporary Plan/Scene size fields to `512x512`, reuse that retained validator for every non-size rule, then validate the original Scene/image dimensions. Generalize collision validation to positive integer `columns` and `rows`, exact `columns * 8` / `rows * 8` agreement with the Scene, binary cells, exact cell count, and image hash. Preserve function signatures, `search_path = ''`, revokes, and `notify pgrst, 'reload schema'`.

- [x] **Step 3: Update provider and migration regression tests after implementation**

Assert every catalog pair is accepted by `directMapProviderArguments`, representative non-catalog pairs are rejected, the new migration contains all 17 exact dimension pairs, the collision wrapper no longer contains the three-grid-only predicate, and no destructive table operation appears.

- [x] **Step 4: Run provider and migration tests**

Run:

```bash
npx deno test --config supabase/functions/mcp/deno.json supabase/functions/pixellab-map/direct-map.test.ts
npx jest --runInBand tests/unit/database/create-map-v3-migration.test.ts
```

Expected: both commands pass.

### Task 3: Consolidated Verification

**Files:**
- Verify only; no new production files.

**Interfaces:**
- Consumes: completed application, GDD, provider, and database updates.
- Produces: evidence that all Create Map profile consumers agree and existing flows remain valid.

- [x] **Step 1: Scan for stale three-profile lists**

Run:

```bash
rg -n "512x512.*688x384.*384x688|\(512, 512\).*\(688, 384\).*\(384, 688\)" src supabase/functions supabase/migrations tests/unit/create-map src/lib/gdd-generation/maps
```

Expected: historical migrations may retain old evidence; active runtime code and current tests must not retain a three-profile-only authority.

- [x] **Step 2: Run the focused Create Map suite**

Run:

```bash
npm run test:create-map-v3
```

Expected: PASS.

- [x] **Step 3: Run static verification**

Run:

```bash
npm run typecheck
git diff --check
```

Expected: both commands pass.

- [x] **Step 4: Review final scope**

Confirm that no paid PixelLab call ran, no image transformation was introduced, historical migrations were not edited, and the unrelated `plugins/keco-codex/.codex-plugin/plugin.json` worktree change remains untouched.
