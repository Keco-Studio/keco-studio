# Create Map V2 Layered Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Create Map V2 workflow that turns a description into a locked composed background plus independently editable visual-and-collision obstacle entities, including selected-region obstacle generation through PixelLab.

**Architecture:** `MapPlanV2` owns the editable pre-generation structure and `MapSceneV2` owns the post-generation editor state. PixelLab produces normalized terrain, path, and transparent obstacle resources through the existing Edge Function; Keco composes a deterministic background server-side, persists immutable generation revisions, and keeps obstacle visuals bound to local collision geometry.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Zod 3, Supabase Postgres/RLS/Storage/Edge Functions, Deno 2.9, `fast-png`, Canvas 2D, Jest 30, Playwright 1.57.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-10-create-map-v2-layered-generation-design.md` as the authoritative product contract.
- Schema version 2 is the only writable and reopenable Create Map format; do not migrate or list V1 maps.
- Do not use TDD. Implement each task first, then add or update tests and run them before committing the task.
- Preserve unrelated dirty-worktree changes and stage only files named by the active task.
- Do not expose PixelLab credentials, provider response bodies, signed URLs, or temporary provider URLs in browser state or durable metadata.
- Keep the browser independent of provider-specific schemas; only the Edge Function may normalize PixelLab payloads.
- Keep the background locked and preserve obstacle entities when regenerating it.
- Keep visual resource, transform, and local collision geometry in one `ObstacleEntity`.
- Use the existing Ant Design icon family and Create Map CSS module; do not add a second design system or new UI dependency.
- Every task must leave `npm run typecheck` and its focused tests passing before its commit.

---

## File Responsibility Map

### Domain And Browser

- `src/features/create-map/model/mapPlanSchema.ts`: V2 Plan schemas, semantic validation, and exported Plan types.
- `src/features/create-map/model/mapSceneSchema.ts`: V2 Scene, obstacle entity, transform, and local collision schemas.
- `src/features/create-map/model/backgroundGeometry.ts`: provider-independent region/path rasterization and connectivity masks.
- `src/features/create-map/model/obstacleCollision.ts`: local/world collision transforms and deterministic initial collision selection.
- `src/features/create-map/model/mapPlanReducer.ts`: Plan Review commands and undo/redo state.
- `src/features/create-map/model/mapSceneReducer.ts`: Scene V2 commands and undo/redo state.
- `src/features/create-map/services/createMapService.ts`: browser API/RPC/Storage facade and V2 response parsing.
- `src/features/create-map/hooks/useMapDraft.ts`: serialized V2 autosave and installed-draft lifecycle.
- `src/features/create-map/hooks/useMapGeneration.ts`: immutable resource generation, background composition, restore, and stale-target guards.
- `src/features/create-map/hooks/useRegionObstacleGeneration.ts`: selected-region obstacle asset lifecycle and entity materialization.

### Planner And API

- `src/lib/server/createMapPlanner.ts`: description-first V2 structured LLM call and correction.
- `src/lib/server/createMapDocumentSource.ts`: optional authorized Document context.
- `src/app/api/create-map/plan/route.ts`: authenticated local-or-project Plan request contract.

### Editor UI

- `src/features/create-map/CreateMapWorkbench.tsx`: top-level mode and installed workspace coordination.
- `src/features/create-map/components/MapSourcePanel.tsx`: description, Project, optional Document, and create command.
- `src/features/create-map/components/PlanReviewCanvas.tsx`: schematic regions, paths, placements, and geometry handles.
- `src/features/create-map/components/MapPlanInspector.tsx`: selected Plan resource fields and validation.
- `src/features/create-map/components/MapCanvas.tsx`: locked background, obstacle entities, collision overlay, and pointer tools.
- `src/features/create-map/components/MapLayerList.tsx`: fixed background/obstacle/collision concerns and entity selection.
- `src/features/create-map/components/ObstacleEntityInspector.tsx`: transform, z-order, collision, regenerate, duplicate, and delete controls.
- `src/features/create-map/components/RegionGenerationPanel.tsx`: selected region prompt, submit, pending, error, and retry UI.
- `src/features/create-map/components/MapToolbar.tsx`: Plan and Scene mode tool sets.

### Supabase And PixelLab

- `supabase/migrations/20260810020500_create_map_v2.sql`: V2 asset kinds, generation identity, V2 RPCs, summary maintenance, and grants.
- `supabase/functions/pixellab-map/types.ts`: V2 Edge request and normalized atlas contracts.
- `supabase/functions/pixellab-map/atlas.ts`: provider result normalization and atlas manifest validation.
- `supabase/functions/pixellab-map/background-compositor.ts`: deterministic RGBA composition.
- `supabase/functions/pixellab-map/background-storage.ts`: source binding, compose transition, upload, read-back, and ready binding.
- `supabase/functions/pixellab-map/pixellab-client.ts`: live capability discovery and complete terrain/path/object result download.
- `supabase/functions/pixellab-map/provider-response.ts`: job IDs, status, and complete tile-result extraction.
- `supabase/functions/pixellab-map/png.ts`: decoded alpha bounds and normalized PNG metadata.
- `supabase/functions/pixellab-map/index.ts`: submit, poll, retry, and `compose_background` routing.

---

### Task 1: Replace V1 Domain Models With V2

**Files:**
- Modify: `src/features/create-map/model/mapPlanSchema.ts`
- Modify: `src/features/create-map/model/mapSceneSchema.ts`
- Create: `src/features/create-map/model/backgroundGeometry.ts`
- Create: `src/features/create-map/model/obstacleCollision.ts`
- Modify: `src/features/create-map/model/mapSceneReducer.ts`
- Create: `src/features/create-map/model/mapPlanReducer.ts`
- Modify: `tests/unit/create-map/fixtures.ts`
- Modify: `tests/unit/create-map/map-plan-schema.test.ts`
- Modify: `tests/unit/create-map/map-scene-schema.test.ts`
- Modify: `tests/unit/create-map/map-scene-reducer.test.ts`
- Create: `tests/unit/create-map/map-plan-reducer.test.ts`
- Create: `tests/unit/create-map/background-geometry.test.ts`
- Create: `tests/unit/create-map/obstacle-collision.test.ts`

**Interfaces:**
- Produces: `MapPlanV2Schema`, `validateMapPlanV2(input)`, `MapSceneV2Schema`, `validateMapSceneV2(plan, scene)`, `rasterizeBackgroundLayout(plan)`, `connectivityMask(cells, x, y, key)`, `deriveInitialLocalCollision(metrics, groundAnchor)`, `transformLocalCollision(entity)`.
- Produces: `reduceMapPlanCommand`, `reduceEditorCommand`, `undo`, and `redo` state containers that do not share writers.

- [ ] **Step 1: Implement exact V2 Plan and Scene schemas**

Use these exported contracts and keep all objects strict:

```ts
export type TerrainRegion = {
  id: string;
  terrainKey: string;
  points: Point[];
};

export type BackgroundPath = {
  id: string;
  name: string;
  prompt: string;
  kind: 'road' | 'river';
  assetKey: string;
  terrainKey: string;
  width: number;
  zIndex: number;
  points: Point[];
};

export type LocalCollisionShape =
  | { shape: 'rectangle'; x: number; y: number; width: number; height: number }
  | { shape: 'circle'; cx: number; cy: number; radius: number }
  | { shape: 'polygon'; points: Point[] };

export type ObstacleEntity = {
  id: string;
  layerId: 'obstacles';
  assetKey: string;
  position: Point;
  scale: number;
  rotation: number;
  zIndex: number;
  groundAnchor: Point;
  collision: LocalCollisionShape;
  source: 'plan' | 'region-generation' | 'manual';
};

export type LockedBackgroundBinding = {
  layerId: 'background';
  assetKey: string;
  sourceRevisionId: string;
  width: number;
  height: number;
  locked: true;
};

export type MapSceneV2 = {
  schemaVersion: 2;
  size: { width: number; height: number; tileSize: number };
  background: LockedBackgroundBinding | null;
  layers: SceneLayerV2[];
  obstacleEntities: ObstacleEntity[];
  canvas: CanvasState;
};
```

`validateMapPlanV2` must enforce divisibility by tile size, bounds, unique IDs/keys, valid references, polygon area, and positive dimensions. `validateMapSceneV2` must validate Plan/Scene dimensions, fixed layer IDs, obstacle asset references, and positive finite transforms. It accepts `background: null` only when `obstacleEntities` is empty for a pre-generation Scene; every materialized or obstacle-bearing Scene requires a complete locked background binding with matching dimensions and asset identity.

- [ ] **Step 2: Implement provider-independent geometry and editor reducers**

`rasterizeBackgroundLayout` must return one cell per map tile after applying base terrain, ordered regions, and z-ordered paths. `connectivityMask` uses north `1`, east `2`, south `4`, west `8`. Local collision transforms rotate and scale every point around the entity position.

Plan commands must include:

```ts
type MapPlanCommand =
  | { type: 'region/add'; region: TerrainRegion }
  | { type: 'region/update'; region: TerrainRegion }
  | { type: 'region/delete'; id: string }
  | { type: 'path/add'; path: BackgroundPath }
  | { type: 'path/update'; path: BackgroundPath }
  | { type: 'path/delete'; id: string }
  | { type: 'placement/move'; id: string; position: Point };
```

Scene commands must operate on complete obstacle entities and include move, transform, collision update, duplicate, delete, and z-order changes.

- [ ] **Step 3: Add post-implementation domain verification**

Add fixtures that use only `schemaVersion: 2`. Tests must cover the schema rules, a region-over-base raster result, a turning path connectivity mask, rotated local collision points, entity duplication with a new ID, and independent Plan/Scene undo histories.

```ts
expect(connectivityMask([
  ['road', 'road'],
  ['base', 'road'],
], 1, 0, 'road')).toBe(12);
```

- [ ] **Step 4: Run focused verification**

Run:

```bash
npx jest --runInBand \
  tests/unit/create-map/map-plan-schema.test.ts \
  tests/unit/create-map/map-scene-schema.test.ts \
  tests/unit/create-map/map-plan-reducer.test.ts \
  tests/unit/create-map/map-scene-reducer.test.ts \
  tests/unit/create-map/background-geometry.test.ts \
  tests/unit/create-map/obstacle-collision.test.ts
npm run typecheck
```

Expected: all named suites pass and TypeScript exits 0.

- [ ] **Step 5: Commit the V2 domain**

```bash
git add src/features/create-map/model tests/unit/create-map/fixtures.ts \
  tests/unit/create-map/map-plan-schema.test.ts \
  tests/unit/create-map/map-scene-schema.test.ts \
  tests/unit/create-map/map-plan-reducer.test.ts \
  tests/unit/create-map/map-scene-reducer.test.ts \
  tests/unit/create-map/background-geometry.test.ts \
  tests/unit/create-map/obstacle-collision.test.ts
git commit -m "feat: define create map v2 domain"
```

### Task 2: Add V2 Persistence And Browser Service Contracts

**Files:**
- Create: `supabase/migrations/20260808020000_create_map_workbench.sql` (track the existing V1 foundation unchanged except for reviewed dependency fixes)
- Create: `supabase/migrations/20260810020500_create_map_v2.sql`
- Modify: `src/features/create-map/services/createMapService.ts`
- Modify: `tests/unit/database/create-map-workbench-migration.test.ts`
- Create: `tests/unit/database/create-map-v2-migration.test.ts`
- Modify: `tests/unit/database/create-map-workbench.rls.behavior.test.ts`
- Modify: `tests/unit/create-map/create-map-service.test.ts`

**Interfaces:**
- Consumes: `MapPlanV2`, `MapSceneV2`, and `MapAssetKind` from Task 1.
- Produces RPCs: `create_map_project_v2`, `save_map_draft_v2`, `publish_map_revision_v2`, `create_map_asset_plan_v2`.
- Produces service methods: `createProjectV2`, `saveDraftV2`, `publishV2`, `createAssetPlanV2`, `listSavedMapsV2`, `loadSavedMapV2`, `listAssets`, `createSignedAssetUrl`, `invokePixelLab`.

- [ ] **Step 1: Implement the additive V2 migration**

The migration must:

```sql
alter table public.map_assets
  drop constraint map_assets_kind_check;
alter table public.map_assets
  add constraint map_assets_kind_check
  check (kind in (
    'terrain', 'road', 'object', 'inpaint',
    'path', 'obstacle', 'background'
  ));

alter table public.map_assets
  add column generation_id uuid,
  add column plan_fingerprint text;
```

Alter the revision schema-version constraint to accept only `1` or `2`. Make `source_document_id`, `source_document_updated_at`, `source_epoch`, and `source_revision` nullable, then add one source-tuple check: V1 rows require all four fields and V2 rows allow either all four null or all four non-null. This preserves legacy rows while allowing description-only V2 drafts without a Document.

Add V2 RPCs with the same writer authorization and immutable revision semantics as V1. Every V2 RPC must reject payloads whose JSON `schemaVersion` is not `2`. Asset plans require generation ID, revision ID, a V2-only kind (`terrain`, `path`, `obstacle`, or `background`), immutable prompt/params/metadata, and a 64-character lowercase plan fingerprint. Updating a V2 draft must also synchronize `map_projects.name`; a successful save must touch `map_projects.updated_at`.

Grant only the V2 create/save/publish/asset-plan RPCs to `authenticated`; keep transition RPC service-role-only.

- [ ] **Step 2: Replace browser service casts with V2 parsing**

Every Plan and Scene response must pass `safeParse`. Export snake-case durable rows separately from camel-case editor types. `listSavedMapsV2` must join `current_revision_id`, filter `map_revisions.schema_version = 2`, order by map summary `updated_at`, and limit 50.

```ts
async createProjectV2(
  projectId: string,
  plan: MapPlanV2,
  scene: MapSceneV2,
  source: MapSourceToken | null,
): Promise<MapDraftIdentity>
```

- [ ] **Step 3: Add post-implementation persistence verification**

Static migration tests assert exact V2 signatures, grants, schema guards, nullable/all-or-complete source tuples, legacy-compatible database asset kinds, V2-only RPC asset kinds, generation identity, name synchronization, and timestamp updates. Behavior tests verify owner/editor writes, viewer/outsider denial, description-only V2 creation, V1 exclusion from V2 lists, CAS conflict, and published payload immutability.

- [ ] **Step 4: Run focused verification**

```bash
npx jest --runInBand \
  tests/unit/database/create-map-workbench-migration.test.ts \
  tests/unit/database/create-map-v2-migration.test.ts \
  tests/unit/create-map/create-map-service.test.ts
npm run typecheck
```

Expected: all named suites pass; the optional RLS behavior suite is run when local Supabase test credentials are configured.

- [ ] **Step 5: Commit persistence**

```bash
git add supabase/migrations/20260808020000_create_map_workbench.sql \
  supabase/migrations/20260810020500_create_map_v2.sql \
  src/features/create-map/services/createMapService.ts \
  tests/unit/database/create-map-workbench-migration.test.ts \
  tests/unit/database/create-map-v2-migration.test.ts \
  tests/unit/database/create-map-workbench.rls.behavior.test.ts \
  tests/unit/create-map/create-map-service.test.ts
git commit -m "feat: persist create map v2 projects"
```

### Task 3: Make Plan Generation Description-First

**Files:**
- Modify: `src/lib/server/createMapPlanner.ts`
- Modify: `src/lib/server/createMapDocumentSource.ts`
- Modify: `src/app/api/create-map/plan/route.ts`
- Modify: `tests/unit/create-map/create-map-planner.test.ts`
- Modify: `tests/unit/create-map/create-map-plan-route.test.ts`

**Interfaces:**
- Produces: `createMapPlanV2(description, source?: CreateMapDocumentSource): Promise<MapPlanV2>`.
- Produces request: `{ description: string; projectId?: string; documentId?: string }` with `documentId` requiring `projectId`.
- Produces response: `{ plan: MapPlanV2; sourceToken: MapSourceToken | null }`.

- [ ] **Step 1: Implement the V2 structured planner**

Replace the tool schema with exact MapPlan V2 fields. The system prompt must state that the description is authoritative, optional Document text is supporting context, coordinates are map-space pixels, dimensions divide by tile size, terrain polygons stay inside bounds, and paths reference declared terrain/path assets.

```ts
export async function createMapPlanV2(
  description: string,
  source?: CreateMapDocumentSource,
): Promise<MapPlanV2>
```

Retain bounded structured-output correction. Include the normalized prior candidate plus exact semantic issues on retry. Reject an empty description before calling the LLM.

- [ ] **Step 2: Implement optional source authorization in the route**

The route always requires an authenticated user. With `documentId`, verify editor/admin access and matching Project before reading the Document. Without `documentId`, do not query document state. Return `sourceToken: null` for description-only plans and `Cache-Control: private, no-store` for every success.

- [ ] **Step 3: Add post-implementation planner verification**

Tests must cover description-only success, optional Document context, document/project mismatch, viewer denial for Document context, empty descriptions, geometry correction, invalid structured output exhaustion, and absence of Document markdown from browser responses.

- [ ] **Step 4: Run focused verification**

```bash
npx jest --runInBand \
  tests/unit/create-map/create-map-planner.test.ts \
  tests/unit/create-map/create-map-plan-route.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit planner and API**

```bash
git add src/lib/server/createMapPlanner.ts \
  src/lib/server/createMapDocumentSource.ts \
  src/app/api/create-map/plan/route.ts \
  tests/unit/create-map/create-map-planner.test.ts \
  tests/unit/create-map/create-map-plan-route.test.ts
git commit -m "feat: plan maps from descriptions"
```

### Task 4: Build Plan Review Editing

**Files:**
- Create: `src/app/(dashboard)/create-map/page.tsx` (track the existing route baseline)
- Modify: `src/features/create-map/components/MapSourcePanel.tsx`
- Create: `src/features/create-map/components/PlanReviewCanvas.tsx`
- Modify: `src/features/create-map/components/MapPlanInspector.tsx`
- Modify: `src/features/create-map/components/MapToolbar.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.module.css`
- Create: `src/features/create-map/hooks/useMapSources.ts` (track the existing source-loading baseline)
- Create: `src/lib/create-map/dashboardChrome.ts` (track the existing navigation baseline)
- Create: `src/lib/create-map/isCreateMapPath.ts` (track the existing navigation baseline)
- Create: `src/lib/create-map/productNavigation.ts` (track the existing navigation baseline)
- Modify: `src/components/layout/DashboardLayout.tsx`
- Modify: `src/components/layout/LeftNav.tsx`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/layout/TopBar.module.css`
- Modify: `src/lib/utils/routeParams.ts`
- Modify: `tests/unit/create-map/workbench-wiring.test.tsx`
- Create: `tests/unit/create-map/plan-review-canvas.test.tsx`
- Modify: `tests/unit/layout/leftnav-wiring.test.ts`
- Modify: `tests/unit/script-system/leftnav-script-wiring.test.ts`

**Interfaces:**
- Consumes: `MapPlanV2`, `MapPlanCommand`, `validateMapPlanV2`, and description-first API from Tasks 1 and 3.
- Produces workbench modes: `'plan-review' | 'scene'`.
- Produces transient Plan selection: region, path, placement, or null.

- [ ] **Step 1: Implement source and local-plan behavior**

Add a labeled description textarea and keep Project/Document selectors dependent. Creating without a Project installs a local Plan Review state and does not call V2 persistence. Selecting a Project while a valid local plan is installed enables `Save draft`; `Generate map` requires a saved, clean draft.

- [ ] **Step 2: Implement schematic Plan canvas and inspector commands**

`PlanReviewCanvas` must render palette fills, path widths, placement bounds, validation highlights, vertex handles, and selection without generated imagery. Pointer gestures produce one final `MapPlanCommand` on pointer-up. The inspector edits selected resource fields and dispatches commands; it never mutates Scene state.

```ts
type PlanReviewCanvasProps = {
  plan: MapPlanV2;
  selection: MapPlanSelection;
  issues: MapPlanIssue[];
  viewport: MapViewport;
  onCommand(command: MapPlanCommand): void;
  onSelectionChange(selection: MapPlanSelection): void;
};
```

- [ ] **Step 3: Add post-implementation component verification**

Use real reducer state in component tests. Verify description-only install, region/path selection, one command per drag, field-level error association, local-plan status, and `Generate map` disabled until Project persistence is clean.

- [ ] **Step 4: Run focused verification**

```bash
npx jest --runInBand \
  tests/unit/create-map/workbench-wiring.test.tsx \
  tests/unit/create-map/plan-review-canvas.test.tsx
npm run typecheck
```

- [ ] **Step 5: Commit Plan Review UI**

```bash
git add 'src/app/(dashboard)/create-map/page.tsx' \
  src/features/create-map/components/MapSourcePanel.tsx \
  src/features/create-map/components/PlanReviewCanvas.tsx \
  src/features/create-map/components/MapPlanInspector.tsx \
  src/features/create-map/components/MapToolbar.tsx \
  src/features/create-map/CreateMapWorkbench.tsx \
  src/features/create-map/CreateMapWorkbench.module.css \
  src/features/create-map/hooks/useMapSources.ts \
  src/lib/create-map/dashboardChrome.ts \
  src/lib/create-map/isCreateMapPath.ts \
  src/lib/create-map/productNavigation.ts \
  src/components/layout/DashboardLayout.tsx \
  src/components/layout/LeftNav.tsx \
  src/components/layout/TopBar.tsx \
  src/components/layout/TopBar.module.css \
  src/lib/utils/routeParams.ts \
  tests/unit/create-map/workbench-wiring.test.tsx \
  tests/unit/create-map/plan-review-canvas.test.tsx \
  tests/unit/layout/leftnav-wiring.test.ts \
  tests/unit/script-system/leftnav-script-wiring.test.ts
git commit -m "feat: edit create map structure plans"
```

### Task 5: Normalize Complete PixelLab Atlases

**Files:**
- Modify: `src/features/create-map/model/mapAssetPlan.ts`
- Modify: `supabase/functions/pixellab-map/types.ts`
- Create: `supabase/functions/pixellab-map/auth.ts` (track the existing Edge authorization baseline)
- Create: `supabase/functions/pixellab-map/http.ts` (track the existing Edge HTTP baseline)
- Create: `supabase/functions/pixellab-map/storage.ts` (track the existing Edge storage baseline)
- Create: `supabase/functions/pixellab-map/deno.json` (track the existing Edge configuration)
- Create: `supabase/functions/pixellab-map/deno.lock` (track the existing Edge dependency lock)
- Create: `supabase/functions/pixellab-map/atlas.ts`
- Modify: `supabase/functions/pixellab-map/provider-response.ts`
- Modify: `supabase/functions/pixellab-map/pixellab-client.ts`
- Modify: `supabase/functions/pixellab-map/png.ts`
- Modify: `supabase/functions/pixellab-map/index.ts`
- Modify: `supabase/functions/pixellab-map/provider-response.test.ts`
- Modify: `supabase/functions/pixellab-map/pixellab-client.test.ts`
- Modify: `supabase/functions/pixellab-map/png.test.ts`
- Create: `supabase/functions/pixellab-map/auth.test.ts` (track the existing authorization baseline)
- Create: `supabase/functions/pixellab-map/storage.test.ts` (track the existing storage baseline)
- Create: `supabase/functions/pixellab-map/atlas.test.ts`
- Modify: `tests/unit/create-map/map-asset-plan.test.ts`

**Interfaces:**
- Consumes V2 asset plans from Task 1.
- Produces `NormalizedTileAtlas`, `normalizeTileAtlas(result, capability, fetcher)`, and PNG alpha metrics.

- [ ] **Step 1: Implement V2 resource plans and normalized atlas parsing**

Terrain and path plans use semantic capabilities, never provider operation names in browser code. The Edge contract is:

```ts
export type NormalizedTileAtlas = {
  schemaVersion: 1;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  tiles: Array<{
    key: string;
    connectivityMask: number;
    sourceX: number;
    sourceY: number;
    sourceWidth: number;
    sourceHeight: number;
  }>;
};
```

Normalize all returned path tiles into one deterministic atlas ordered by connectivity mask. Normalize top-down terrain atlas metadata from the live response. Reject duplicate/missing rectangles, invalid dimensions, or missing masks needed by the Plan with `atlas_manifest_incomplete`. Remove the current `mask=15` single-tile shortcut.

- [ ] **Step 2: Extend PNG metadata for collision derivation**

`validatePng` must return `alphaBounds`, `opaquePixelCount`, `visiblePixelCount`, and `opaqueFillRatio` without weakening the existing size, corruption, alpha, and flat-color checks.

- [ ] **Step 3: Add post-implementation Edge verification**

Tests use captured-shaped MCP text/JSON fixtures to prove all tiles are extracted, packed in stable mask order, and represented by correct source rectangles. Verify incomplete manifests block instead of silently choosing a generic tile.

- [ ] **Step 4: Run focused verification**

```bash
npx deno test --config supabase/functions/pixellab-map/deno.json \
  --allow-env --allow-net supabase/functions/pixellab-map
npx jest --runInBand tests/unit/create-map/map-asset-plan.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit atlas normalization**

```bash
git add src/features/create-map/model/mapAssetPlan.ts \
  supabase/functions/pixellab-map/auth.ts \
  supabase/functions/pixellab-map/http.ts \
  supabase/functions/pixellab-map/storage.ts \
  supabase/functions/pixellab-map/deno.json \
  supabase/functions/pixellab-map/deno.lock \
  supabase/functions/pixellab-map/types.ts \
  supabase/functions/pixellab-map/atlas.ts \
  supabase/functions/pixellab-map/provider-response.ts \
  supabase/functions/pixellab-map/pixellab-client.ts \
  supabase/functions/pixellab-map/png.ts \
  supabase/functions/pixellab-map/index.ts \
  supabase/functions/pixellab-map/auth.test.ts \
  supabase/functions/pixellab-map/storage.test.ts \
  supabase/functions/pixellab-map/provider-response.test.ts \
  supabase/functions/pixellab-map/pixellab-client.test.ts \
  supabase/functions/pixellab-map/png.test.ts \
  supabase/functions/pixellab-map/atlas.test.ts \
  tests/unit/create-map/map-asset-plan.test.ts
git commit -m "feat: normalize pixellab map atlases"
```

### Task 6: Compose And Persist The Locked Background

**Files:**
- Create: `supabase/functions/pixellab-map/background-compositor.ts`
- Create: `supabase/functions/pixellab-map/background-compositor.test.ts`
- Create: `supabase/functions/pixellab-map/background-storage.ts`
- Create: `supabase/functions/pixellab-map/background-storage.test.ts`
- Modify: `supabase/functions/pixellab-map/index.ts`
- Modify: `supabase/functions/pixellab-map/storage.ts`
- Modify: `supabase/functions/pixellab-map/types.ts`

**Interfaces:**
- Consumes Plan raster cells, normalized atlas manifests, verified source hashes, and a planned background asset.
- Produces `composeBackground(input): Promise<ValidatedPng>` and Edge operation `compose_background`.

- [ ] **Step 1: Implement deterministic RGBA composition**

```ts
export type BackgroundComposeInput = {
  width: number;
  height: number;
  tileSize: number;
  cells: Array<{ x: number; y: number; assetKey: string; connectivityMask: number }>;
  atlases: Record<string, { png: ValidatedPng; manifest: NormalizedTileAtlas }>;
};
```

For each cell, resolve the exact mask, copy source RGBA pixels, and nearest-neighbor scale to `tileSize`. Encode with `fast-png`, run the normal complete-PNG validation, and ensure repeated calls with identical bytes produce the same SHA-256.

- [ ] **Step 2: Implement authorized compose and storage binding**

`compose_background` verifies user authorization, V2 map/revision/generation identity, background status, source asset readiness, ordered source IDs/hashes, and canonical Plan fingerprint. Transition background `planned -> generating -> ready`, upload privately, read back exact bytes, and persist compositor metadata. A retry starts from `failed` without generating source assets again.

- [ ] **Step 3: Add post-implementation compositor verification**

Use 2x2 and turning-path fixtures with distinct pixel colors. Assert exact output pixels, nearest-neighbor scaling, mask selection, source-hash mismatch rejection, byte determinism, and storage transition behavior.

- [ ] **Step 4: Run Edge verification**

```bash
npx deno test --config supabase/functions/pixellab-map/deno.json \
  --allow-env --allow-net supabase/functions/pixellab-map
```

- [ ] **Step 5: Commit background composition**

```bash
git add supabase/functions/pixellab-map/background-compositor.ts \
  supabase/functions/pixellab-map/background-compositor.test.ts \
  supabase/functions/pixellab-map/background-storage.ts \
  supabase/functions/pixellab-map/background-storage.test.ts \
  supabase/functions/pixellab-map/index.ts \
  supabase/functions/pixellab-map/storage.ts \
  supabase/functions/pixellab-map/types.ts
git commit -m "feat: compose locked map backgrounds"
```

### Task 7: Serialize Draft Saves And Orchestrate Complete Generation

**Files:**
- Modify: `src/features/create-map/hooks/useMapDraft.ts`
- Modify: `src/features/create-map/hooks/useMapGeneration.ts`
- Modify: `src/features/create-map/services/mapGenerationQueue.ts`
- Modify: `src/features/create-map/CreateMapWorkbench.tsx`
- Create: `tests/unit/create-map/map-draft-autosave.test.ts`
- Modify: `tests/unit/create-map/map-generation-queue.test.ts`
- Modify: `tests/unit/create-map/map-generation-monitor.test.ts`
- Modify: `tests/unit/create-map/map-generation-restore.test.ts`

**Interfaces:**
- Consumes V2 RPC/service, resource plans, and `compose_background` from Tasks 2, 5, and 6.
- Produces one serialized draft writer and generation phases `idle`, `preparing`, `awaiting-confirmation`, `generating-resources`, `composing-background`, `partial`, `ready`, `failed`.

- [ ] **Step 1: Implement serialized autosave**

Use one in-flight promise, a pending payload ref, installed-map epoch, and expected save version. A completion updates state only when its installed epoch and identity still match. Pending payloads run immediately after a successful response with the returned save version. Local validation errors never call the RPC.

- [ ] **Step 2: Implement V2 generation orchestration**

Publish one immutable revision, create terrain/path/obstacle/background plans under one generation ID, ask for confirmation, generate paid resources in bounded batches, then call `compose_background` exactly once all required atlases are ready. Materialize Scene obstacle entities only from ready resources and install the locked background in the next draft.

Background-only retry must not call PixelLab. Obstacle regeneration creates a new asset plan but preserves installed entity transform and collision.

- [ ] **Step 3: Add post-implementation lifecycle verification**

Cover two edits while one save is delayed, map replacement during save, partial resource success, background blocking, compose-only retry, stale generation result discard, and browser-refresh restoration without resubmission.

- [ ] **Step 4: Run focused verification**

```bash
npx jest --runInBand \
  tests/unit/create-map/map-draft-autosave.test.ts \
  tests/unit/create-map/map-generation-queue.test.ts \
  tests/unit/create-map/map-generation-monitor.test.ts \
  tests/unit/create-map/map-generation-restore.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit lifecycle orchestration**

```bash
git add src/features/create-map/hooks/useMapDraft.ts \
  src/features/create-map/hooks/useMapGeneration.ts \
  src/features/create-map/services/mapGenerationQueue.ts \
  src/features/create-map/CreateMapWorkbench.tsx \
  tests/unit/create-map/map-draft-autosave.test.ts \
  tests/unit/create-map/map-generation-queue.test.ts \
  tests/unit/create-map/map-generation-monitor.test.ts \
  tests/unit/create-map/map-generation-restore.test.ts
git commit -m "feat: orchestrate create map v2 generation"
```

### Task 8: Build Locked Background And Obstacle Entity Editing

**Files:**
- Modify: `src/features/create-map/components/MapCanvas.tsx`
- Modify: `src/features/create-map/components/MapLayerList.tsx`
- Create: `src/features/create-map/components/ObstacleEntityInspector.tsx`
- Delete: `src/features/create-map/components/ObjectInspector.tsx`
- Delete: `src/features/create-map/components/ObstacleInspector.tsx`
- Delete: `src/features/create-map/components/InpaintInspector.tsx`
- Modify: `src/features/create-map/components/MapToolbar.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.module.css`
- Modify: `tests/unit/create-map/canvas-renderer.test.ts`
- Modify: `tests/unit/create-map/map-interaction.test.ts`
- Create: `tests/unit/create-map/obstacle-entity-inspector.test.tsx`

**Interfaces:**
- Consumes Scene V2 commands, signed background/obstacle images, and collision transforms.
- Produces Scene tools `select`, `hand`, `generate-obstacle`, `collision-rectangle`, `collision-circle`, `collision-polygon`.

- [ ] **Step 1: Render the locked background and bound entities**

Draw the complete background image once at map dimensions. Sort obstacle entities by z-index, apply position/rotation/scale around ground anchor, then render transformed collision overlays when visible. Hit testing uses the same transformed bounds and respects layer visibility.

- [ ] **Step 2: Implement complete obstacle editing controls**

Pointer gestures commit one command on pointer-up. Inspector fields dispatch validated transform/collision commands. Duplicate creates a new stable ID and offset position; visual regeneration keeps ID, transform, and collision. Polygon collision exposes draggable local vertices. Remove dead Inpaint and split object/obstacle controls.

- [ ] **Step 3: Add post-implementation editor verification**

Verify background draw uses the complete image, locked layer cannot move, rotated visuals and collisions share transforms, duplicate/delete/z-order behavior, polygon vertex editing, pointer cancellation, and no dead Inpaint or Regenerate UI.

- [ ] **Step 4: Run focused verification**

```bash
npx jest --runInBand \
  tests/unit/create-map/canvas-renderer.test.ts \
  tests/unit/create-map/map-interaction.test.ts \
  tests/unit/create-map/obstacle-entity-inspector.test.tsx \
  tests/unit/create-map/workbench-wiring.test.tsx
npm run typecheck
```

- [ ] **Step 5: Commit Scene editing**

```bash
git add src/features/create-map/components \
  src/features/create-map/CreateMapWorkbench.tsx \
  src/features/create-map/CreateMapWorkbench.module.css \
  tests/unit/create-map/canvas-renderer.test.ts \
  tests/unit/create-map/map-interaction.test.ts \
  tests/unit/create-map/obstacle-entity-inspector.test.tsx \
  tests/unit/create-map/workbench-wiring.test.tsx
git commit -m "feat: edit layered map obstacles"
```

### Task 9: Generate An Editable Obstacle From A Selected Region

**Files:**
- Create: `src/features/create-map/hooks/useRegionObstacleGeneration.ts`
- Create: `src/features/create-map/components/RegionGenerationPanel.tsx`
- Modify: `src/features/create-map/components/MapCanvas.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.tsx`
- Modify: `src/features/create-map/services/createMapService.ts`
- Create: `tests/unit/create-map/region-obstacle-generation.test.ts`
- Create: `tests/unit/create-map/region-generation-panel.test.tsx`
- Modify: `supabase/functions/pixellab-map/index.ts`
- Modify: `supabase/functions/pixellab-map/auth.test.ts`

**Interfaces:**
- Produces `MapRegionSelection`, `fitObstacleToRegion`, and `useRegionObstacleGeneration`.
- Consumes PixelLab `map_object`, alpha metrics, V2 asset-plan RPC, and Scene entity commands.

- [ ] **Step 1: Implement selection and generation lifecycle**

```ts
export type MapRegionSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
};
```

Drag selection is clamped to the map and remains stable while submitting. The hook creates an obstacle asset plan with current background asset ID/hash references, submits/polls it, derives collision from alpha metrics, fits the visual to the selection, and returns one complete `ObstacleEntity` for a single Scene commit.

- [ ] **Step 2: Implement region panel states and secure Edge input**

Panel states are empty selection, prompt-ready, submitting, generating, failed/retryable, and ready/committed. The Edge Function resolves any temporary style crop internally only if the discovered schema supports an image reference. Browser requests contain Keco IDs and prompt, never signed URLs or raw background bytes.

- [ ] **Step 3: Add post-implementation region-generation verification**

Verify aspect-fit placement, bottom-center ground anchor, circle/rectangle heuristic, selection/prompt preservation on failure, stale-map discard, one entity commit, and authorization rejection for mismatched background or generation identity.

- [ ] **Step 4: Run focused verification**

```bash
npx jest --runInBand \
  tests/unit/create-map/region-obstacle-generation.test.ts \
  tests/unit/create-map/region-generation-panel.test.tsx
npx deno test --config supabase/functions/pixellab-map/deno.json \
  --allow-env --allow-net supabase/functions/pixellab-map
npm run typecheck
```

- [ ] **Step 5: Commit region generation**

```bash
git add src/features/create-map/hooks/useRegionObstacleGeneration.ts \
  src/features/create-map/components/RegionGenerationPanel.tsx \
  src/features/create-map/components/MapCanvas.tsx \
  src/features/create-map/CreateMapWorkbench.tsx \
  src/features/create-map/services/createMapService.ts \
  tests/unit/create-map/region-obstacle-generation.test.ts \
  tests/unit/create-map/region-generation-panel.test.tsx \
  supabase/functions/pixellab-map/index.ts \
  supabase/functions/pixellab-map/auth.test.ts
git commit -m "feat: generate obstacles from map regions"
```

### Task 10: Restore V2 Workspaces Without Cross-Map Leakage

**Files:**
- Modify: `src/features/create-map/hooks/useSavedMaps.ts`
- Modify: `src/features/create-map/components/SavedMapsPanel.tsx`
- Modify: `src/features/create-map/hooks/useMapGeneration.ts`
- Modify: `src/features/create-map/CreateMapWorkbench.tsx`
- Modify: `tests/unit/create-map/saved-maps-panel.test.tsx`
- Modify: `tests/unit/create-map/map-generation-restore.test.ts`
- Modify: `tests/unit/create-map/create-map-shell.test.ts`
- Modify: `tests/unit/create-map/workbench-wiring.test.tsx`

**Interfaces:**
- Consumes `listSavedMapsV2`, `loadSavedMapV2`, installed draft epoch, generation identity, and signed asset URL methods.
- Produces atomic V2 workspace installation with no V1 visibility.

- [ ] **Step 1: Implement V2-only list and atomic restore**

Load the current V2 Plan/Scene plus the exact background and obstacle assets referenced by Scene. Resolve fresh signed URLs before installation, but preserve ready durable state when a URL cannot be signed. Install Project, optional Document, Plan, Scene, draft identity, generation target, images, mode, and transient selection under one current request token.

- [ ] **Step 2: Harden image and request invalidation**

Clear image caches on new Plan, new map, or new generation. Image onload callbacks carry installed-map epoch and asset binding. Dirty/saving/conflict drafts cannot switch. Failed or stale opens leave the existing workspace unchanged.

- [ ] **Step 3: Add post-implementation restore verification**

Cover V1 exclusion, ready background restore, obstacle asset restore, one signed URL failure, stale open, stale image load, dirty switch denial, and local-preview replacement.

- [ ] **Step 4: Run focused verification**

```bash
npx jest --runInBand \
  tests/unit/create-map/saved-maps-panel.test.tsx \
  tests/unit/create-map/map-generation-restore.test.ts \
  tests/unit/create-map/create-map-shell.test.ts \
  tests/unit/create-map/workbench-wiring.test.tsx
npm run typecheck
```

- [ ] **Step 5: Commit restore hardening**

```bash
git add src/features/create-map/hooks/useSavedMaps.ts \
  src/features/create-map/components/SavedMapsPanel.tsx \
  src/features/create-map/hooks/useMapGeneration.ts \
  src/features/create-map/CreateMapWorkbench.tsx \
  tests/unit/create-map/saved-maps-panel.test.tsx \
  tests/unit/create-map/map-generation-restore.test.ts \
  tests/unit/create-map/create-map-shell.test.ts \
  tests/unit/create-map/workbench-wiring.test.tsx
git commit -m "feat: restore create map v2 workspaces"
```

### Task 11: Complete Automated, Browser, And Live Verification

**Files:**
- Create: `tests/e2e/specs/create-map-v2.spec.ts`
- Modify: `scripts/probe-pixellab-map.ts`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-08-10-create-map-v2-layered-generation-design.md`

**Interfaces:**
- Consumes the complete V2 workflow.
- Produces reproducible local commands and recorded verification evidence.

- [ ] **Step 1: Add the browser workflow suite**

The Playwright suite must cover description-only Plan generation, optional Document context, structural Plan edit, confirmation, mocked deterministic resource completion, locked background rendering, obstacle transform/collision edit, selected-region generation, save/reload restore, partial failure, and stale result protection.

Use stable test IDs only for controls whose accessible role/name is insufficient. Do not assert implementation source strings.

- [ ] **Step 2: Upgrade the live PixelLab probe**

The probe must print sanitized semantic capability names, operation names, schema fingerprints, normalized tile masks, output dimensions, transparency, and SHA-256 prefixes. It must never print tokens, authorization headers, complete provider response bodies, signed URLs, or temporary image URLs.

Add scripts:

```json
{
  "test:create-map-v2": "jest --runInBand tests/unit/create-map tests/unit/database/create-map-v2-migration.test.ts",
  "test:e2e:create-map-v2": "playwright test tests/e2e/specs/create-map-v2.spec.ts"
}
```

- [ ] **Step 3: Run the full automated verification gate**

```bash
npm run test:create-map-v2
npx deno test --config supabase/functions/pixellab-map/deno.json \
  --allow-env --allow-net supabase/functions/pixellab-map
npm run typecheck
npm run typecheck:api
npm run lint
npm run build
npm run test:e2e:create-map-v2
```

Expected: every command exits 0. Record any environment-gated RLS suite as passed or skipped with its exact reason; do not call a skipped suite passed.

- [ ] **Step 4: Run visual and live-provider verification**

Start the application on an available local port, capture Playwright screenshots at 1440x900, 1024x768, 768x1024, and 390x844, and inspect text fit, overlap, locked-background framing, pointer controls, drawers, loading, partial, and error states.

With `PIXELLAB_API_TOKEN` configured, run:

```bash
npm run probe:pixellab-map
```

Confirm one minimal terrain, path, and transparent obstacle output plus a composed background. If live capability/schema behavior differs from the normalized adapter contract, update the adapter and rerun Tasks 5, 6, 9, and this gate before completion.

- [ ] **Step 5: Update design status and commit verification**

Change the design status to `Implemented and verified` only after every required non-gated command exits 0 and live verification succeeds. Then commit:

```bash
git add tests/e2e/specs/create-map-v2.spec.ts \
  scripts/probe-pixellab-map.ts package.json \
  docs/superpowers/specs/2026-08-10-create-map-v2-layered-generation-design.md
git commit -m "test: verify create map v2 workflow"
```

---

## Plan Self-Review Record

- Spec coverage: Tasks 1-11 cover all 22 acceptance criteria and every included scope item.
- Scope control: V1 migration, per-tile painting, background Inpaint, Godot export, automatic polygon tracing, and collaborative editing remain excluded.
- Type consistency: Plan, Scene, asset kinds, generation identity, normalized atlas, region selection, and Edge operation names are defined once and reused by later tasks.
- Verification order: tests follow implementation in every task; no failing-test-first or red-green step is present.
- Dirty-worktree safety: every commit command stages explicit task paths and does not use broad repository staging.
