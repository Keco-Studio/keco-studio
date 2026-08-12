# Create Map V3 Vision Collision Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This plan follows the user's explicit instruction not to use TDD: implementation comes first, then focused tests and regression verification.

**Goal:** Analyze each ready PixelLab direct-map image with a multimodal model and persist an editable 8x8-pixel collision grid in the V3 Scene.

**Architecture:** Extend the strict V3 Scene with a hash-bound nullable collision grid. Add an authenticated server route that loads and verifies the private ready image, calls an OpenAI-compatible multimodal model from the Agent provider with strict tool output, and returns a validated grid. The browser automatically analyzes a newly bound image, renders the grid in an aligned canvas overlay, and lets users repaint cells before normal draft autosave.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Zod 3, Supabase/Postgres/Storage, OpenAI-compatible Chat Completions, Jest 30, Playwright.

## Global Constraints

- Use a fixed 8x8-pixel cell size for every supported V3 profile.
- Persist row-major `Array<0 | 1>` values: walkable or blocked.
- Bind every grid to the exact ready image SHA-256 and clear it when the image changes.
- Keep PixelLab image generation and DeepSeek map planning unchanged.
- Reuse Agent `LLM_*` provider configuration by default; allow `CREATE_MAP_VISION_*` overrides for a supplier-specific multimodal model.
- Never persist image data URLs, signed URLs, model response bodies, API keys, or credentials.
- Preserve legacy V3 Scenes that do not contain `collisionGrid`.
- Do not use TDD. Add tests after implementation.
- Do not commit or push without an explicit user request.

---

### Task 1: Collision Grid Domain And Scene Persistence

**Files:**
- Create: `src/features/create-map/model/directMapCollisionGrid.ts`
- Modify: `src/features/create-map/model/directMapSchema.ts`
- Create: `supabase/migrations/20260812010000_create_map_v3_collision_grid.sql`

**Interfaces:**
- Produces: `DirectMapCollisionGrid`, `createEmptyCollisionGrid(width, height, imageSha256)`, `setCollisionCell(grid, column, row, value)`, `collisionGridMatchesImage(grid, image)`.
- Extends: `MapSceneV3.collisionGrid` as nullable, with absent legacy values normalized to `null`.

- [ ] Add a strict Zod schema for version 1, cell size 8, supported derived dimensions, exact flattened cell count, values `0|1|2`, and lowercase SHA-256.
- [ ] Add immutable helpers for cell replacement, count summaries, and image binding checks.
- [ ] Include `collisionGrid: null` in newly created Scenes and clear a grid when `materializeDirectMapScene` binds a different image hash.
- [ ] Add a forward-only migration that replaces `map_validate_v3_payload` so `collisionGrid` is optional for legacy rows and strictly validated when present.
- [ ] Run `git diff --check` and inspect the migration without modifying prior migration files.

### Task 2: Multimodal Collision Analyzer

**Files:**
- Create: `src/lib/server/createMapCollisionAnalyzer.ts`
- Modify: `.env.example` if present, otherwise document variables only in the plan/spec.

**Interfaces:**
- Consumes: verified PNG bytes, image SHA-256, width, and height.
- Produces: `analyzeCreateMapCollisionGrid(input): Promise<DirectMapCollisionGrid>`.

- [ ] Resolve `CREATE_MAP_VISION_API_URL`, `CREATE_MAP_VISION_API_KEY`, and `CREATE_MAP_VISION_MODEL` as optional overrides of Agent `LLM_API_URL`, `LLM_API_KEY`, and `LLM_MODEL`.
- [ ] Build one multimodal user message containing the PNG data URL and exact grid semantics.
- [ ] Require tool `submit_collision_grid_v1` with `rows: string[]`; each string must match `/^[01]+$/` and the exact expected columns.
- [ ] Convert validated rows to the flattened numeric array and install the authoritative image SHA.
- [ ] Retry one invalid model response with concise row-count/row-width issues, then throw stable `vision_not_configured`, `vision_upstream_error`, or `collision_grid_invalid_response` errors.

### Task 3: Authenticated Analysis Route

**Files:**
- Create: `src/app/api/create-map/collision-grid/route.ts`
- Modify: `src/features/create-map/services/createMapService.ts`

**Interfaces:**
- Request: `POST { projectId, mapId, revisionId }`.
- Response: `{ collisionGrid }`.
- Client: `createMapService.analyzeCollisionGrid(projectId, mapId, revisionId)`.

- [ ] Authenticate with `withAuth`, require an admin/editor Project role, and verify that the requested revision is the map's current V3 draft.
- [ ] Parse the Scene and require a locked `mapImage` binding.
- [ ] Load exactly one ready `map-image` asset for `sourceRevisionId`; verify dimensions, opaque PNG metadata, storage-path ownership, and SHA format.
- [ ] Download the private object with the service-role client, enforce PNG type and an 8 MiB byte cap, and recompute SHA-256 before analysis.
- [ ] Map analyzer errors to stable sanitized HTTP responses and add `Cache-Control: private, no-store`.

### Task 4: Automatic Analysis And Editable Overlay

**Files:**
- Create: `src/features/create-map/hooks/useDirectMapCollisionGrid.ts`
- Create: `src/features/create-map/components/DirectMapCollisionPanel.tsx`
- Modify: `src/features/create-map/components/DirectMapCanvas.tsx`
- Modify: `src/features/create-map/DirectMapWorkbench.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.module.css`

**Interfaces:**
- Hook consumes current saved-map identity, Scene, and bound image; produces analysis phase/error/retry and edit commands.
- Canvas consumes `collisionGrid`, visibility, paint mode, and `onPaintCell(column, row, value)`.

- [ ] Trigger analysis once when a ready bound image has no matching grid; do not auto-overwrite a matching grid or loop after an error.
- [ ] Install the returned grid through `setScene`, allowing existing draft autosave to persist it.
- [ ] Render a stable absolute canvas overlay aligned with the intrinsic map image; use translucent red for blocked cells.
- [ ] Convert pointer coordinates through the rendered image rectangle into exact grid column/row and support click-drag painting.
- [ ] Add a restrained Collision section with overlay toggle, Walkable/Obstacle segmented mode, Retry analysis, Clear grid, state counts, loading, and error states.
- [ ] Keep the map usable when vision analysis is unavailable and keep existing generation controls unchanged.

### Task 5: Post-Implementation Tests

**Files:**
- Create: `tests/unit/create-map/direct-map-collision-grid.test.ts`
- Create: `tests/unit/create-map/create-map-collision-analyzer.test.ts`
- Create: `tests/unit/api-create-map-collision-grid-route.test.ts`
- Modify: `tests/unit/create-map/direct-map-schema.test.ts`
- Modify: `tests/unit/create-map/workbench-wiring.test.tsx`
- Modify: `tests/e2e/specs/create-map-v3.spec.ts`

- [ ] Test all three supported grid dimensions, exact cell counts, invalid values, row-major editing, and image-hash matching.
- [ ] Mock the LLM client and test valid rows, malformed row count/width/content, one correction attempt, configuration errors, and sanitized upstream errors.
- [ ] Mock Supabase/Storage and test auth, role, current revision, ready image identity, byte cap, hash mismatch, and successful route output.
- [ ] Test legacy Scene normalization, new Scene round-trip, regeneration invalidation, and Saved Maps restore.
- [ ] Add a Playwright mocked-response flow that materializes a ready image, auto-installs a grid, paints one cell, saves, reloads, and restores the overlay.

### Task 6: Verification

**Files:**
- Verify only; no unrelated edits.

- [ ] Run focused Jest suites for collision grid, analyzer, route, schema, workbench, draft, generation, and Saved Maps.
- [ ] Run `npm run test:create-map-v3`.
- [ ] Run `npm run typecheck` and scoped ESLint on modified TypeScript/TSX files.
- [ ] Run migration/database unit checks and `git diff --check`.
- [ ] Run the Create Map V3 Playwright test against mocked PixelLab and vision responses.
- [ ] If the effective Agent/vision model supports images, analyze an existing ready stored image without calling PixelLab; otherwise report the real-provider test as blocked by model capability while retaining complete mocked integration evidence.
