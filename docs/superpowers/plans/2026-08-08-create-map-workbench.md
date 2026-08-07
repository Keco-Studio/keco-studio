# Create Map Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Keco Studio Create Map workspace that converts a selected project Document into an editable MapPlan, generates terrain/roads/objects through a server-owned PixelLab integration, persists immutable revisions, and supports obstacle editing plus mask-based Inpaint.

**Architecture:** A focused `src/features/create-map` domain owns editor types, commands, composition, UI, and browser persistence. Supabase tables/RPCs own project authorization, drafts, immutable revisions, asset provenance, and optimistic concurrency. A separate `pixellab-map` Edge Function owns the PixelLab token, discovers live MCP capabilities, uses exact REST fallbacks only when necessary, validates provider images, and writes private Storage objects.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Zod 3, Supabase/Postgres/Edge Functions/Storage, PixelLab hosted MCP and official REST fallback, HTML Canvas 2D, Jest 30, Deno 2.9 tests, Playwright 1.57, CSS Modules.

## Global Constraints

- Route is global `/create-map` and uses the fourth LeftNav slot.
- Hide Studio Sidebar and Agent Chat on Create Map; keep LeftNav and TopBar.
- First release includes composed background, Wang tilesets, roads/path terrain, movable transparent objects, rectangle/circle/polygon obstacles, and Inpaint.
- Keco owns plan, composition, placement, geometry, revision state, and provenance. PixelLab owns generated image bytes only.
- No Godot export, navigation mesh, gameplay collision runtime, or per-user PixelLab account.
- PixelLab credentials stay server-side under `PIXELLAB_API_TOKEN`; never log, persist, bundle, or commit the value.
- Paid generation starts only after the user reviews a valid MapPlan and the planned asset rows are read back.
- Successful assets survive sibling failures; retry only the failed stable asset key.
- Every implementation task follows RED, GREEN, REFACTOR and ends with a focused commit.

---

## File Map

### Route And Presentation

- `src/lib/create-map/isCreateMapPath.ts`: exact route predicate shared by shell and navigation.
- `src/app/(dashboard)/create-map/page.tsx`: route entry.
- `src/features/create-map/CreateMapWorkbench.tsx`: feature composition and state orchestration.
- `src/features/create-map/CreateMapWorkbench.module.css`: approved three-column responsive layout.
- `src/features/create-map/components/MapSourcePanel.tsx`: Project and Document selection.
- `src/features/create-map/components/MapStages.tsx`: workflow stage state.
- `src/features/create-map/components/MapLayerList.tsx`: layer/object lists and asset progress.
- `src/features/create-map/components/MapToolbar.tsx`: fixed-size editor tools.
- `src/features/create-map/components/MapCanvas.tsx`: Canvas 2D rendering and pointer input.
- `src/features/create-map/components/MapPlanInspector.tsx`: editable plan fields and validation.
- `src/features/create-map/components/ObjectInspector.tsx`: selected object transforms and anchors.
- `src/features/create-map/components/ObstacleInspector.tsx`: rectangle/circle/polygon geometry.
- `src/features/create-map/components/InpaintInspector.tsx`: mask prompt, submit, apply, and rollback.

### Domain And Services

- `src/features/create-map/model/mapPlanSchema.ts`: Zod schemas and inferred plan types.
- `src/features/create-map/model/mapSceneSchema.ts`: scene, asset, obstacle, revision, and job DTOs.
- `src/features/create-map/model/mapSceneReducer.ts`: deterministic edit commands and history.
- `src/features/create-map/model/coordinates.ts`: pan, zoom, map, screen, and grid conversion.
- `src/features/create-map/model/mask.ts`: binary Inpaint mask model and PNG encoding.
- `src/features/create-map/model/terrainComposer.ts`: seeded terrain/road placement from Wang metadata.
- `src/features/create-map/services/createMapService.ts`: browser Supabase/RPC/Edge Function facade.
- `src/features/create-map/hooks/useMapSources.ts`: source queries.
- `src/features/create-map/hooks/useMapDraft.ts`: map loading and optimistic autosave.
- `src/features/create-map/hooks/useMapGeneration.ts`: asset submission and polling.
- `src/features/create-map/hooks/useInpaint.ts`: mask and derived-asset lifecycle.
- `src/lib/server/createMapDocumentSource.ts`: authorized consistent Document snapshot.
- `src/lib/server/createMapPlanner.ts`: Document-to-MapPlan structured LLM call and validation.
- `src/app/api/create-map/plan/route.ts`: authenticated plan endpoint.

### Persistence And Provider

- `supabase/migrations/20260808010000_create_map_workbench.sql`: maps, revisions, assets, private bucket, RLS, and atomic RPCs.
- `supabase/functions/pixellab-map/index.ts`: Edge entry point.
- `supabase/functions/pixellab-map/http.ts`: bounded authenticated request handler.
- `supabase/functions/pixellab-map/auth.ts`: user/project/asset authorization.
- `supabase/functions/pixellab-map/pixellab-client.ts`: MCP discovery and REST fallback.
- `supabase/functions/pixellab-map/png.ts`: returned image validation.
- `supabase/functions/pixellab-map/storage.ts`: private upload and ready read-back.
- `supabase/functions/pixellab-map/types.ts`: closed request and provider DTOs.
- `.env.example`: variable names only.
- `scripts/probe-pixellab-map.ts`: opt-in live capability/generation probe with redacted output.

### Tests

- `tests/unit/create-map/`: focused domain, service, UI wiring, and API test directory containing the exact test files named in each task.
- `tests/unit/database/create-map-workbench-migration.test.ts`: migration contract.
- `tests/unit/database/create-map-workbench.rls.behavior.test.ts`: opt-in live RLS/RPC matrix.
- `supabase/functions/pixellab-map/auth.test.ts`, `pixellab-client.test.ts`, `http.test.ts`, `png.test.ts`, `storage.test.ts`, and `inpaint.test.ts`: Deno provider/auth/image tests.
- `tests/e2e/pages/create-map.page.ts` and `tests/e2e/specs/create-map.spec.ts`: browser workflow and screenshots.

---

### Task 1: Add The Create Map Route And Isolate The Dashboard Shell

**Files:**
- Create: `src/lib/create-map/isCreateMapPath.ts`
- Create: `src/app/(dashboard)/create-map/page.tsx`
- Create: `src/features/create-map/CreateMapWorkbench.tsx`
- Create: `src/features/create-map/CreateMapWorkbench.module.css`
- Modify: `src/components/layout/LeftNav.tsx`
- Modify: `src/components/layout/DashboardLayout.tsx`
- Test: `tests/unit/create-map/create-map-shell.test.ts`
- Test: `tests/unit/layout/leftnav-wiring.test.ts`

**Interfaces:**
- Produces: `isCreateMapPath(pathname: string | null): boolean`.
- Produces: a routable `<CreateMapWorkbench />` with stable `data-testid="create-map-workbench"`.
- Consumes: existing Next navigation, TopBar, LeftNav, and dashboard auth gate.

- [ ] **Step 1: Write failing shell tests**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isCreateMapPath } from '@/lib/create-map/isCreateMapPath';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

it('matches only the Create Map workspace', () => {
  expect(isCreateMapPath('/create-map')).toBe(true);
  expect(isCreateMapPath('/create-map/history')).toBe(true);
  expect(isCreateMapPath('/projects')).toBe(false);
});

it('uses the fourth nav slot and isolates the dashboard shell', () => {
  const nav = read('src/components/layout/LeftNav.tsx');
  const layout = read('src/components/layout/DashboardLayout.tsx');
  expect(nav).toContain("router.push('/create-map')");
  expect(nav).toContain('aria-label="Create Map"');
  expect(layout).toContain('hideSidebarForCreateMap');
  expect(layout).toContain('hideChatPanel');
});
```

- [ ] **Step 2: Run the tests and verify the missing module/wiring failure**

Run: `npx jest tests/unit/create-map/create-map-shell.test.ts tests/unit/layout/leftnav-wiring.test.ts --runInBand`

Expected: FAIL because `isCreateMapPath` and the route wiring do not exist.

- [ ] **Step 3: Implement the route predicate and shell wiring**

```ts
export function isCreateMapPath(pathname: string | null): boolean {
  return pathname === '/create-map' || Boolean(pathname?.startsWith('/create-map/'));
}
```

In `LeftNav`, derive `onCreateMap`, exclude it from `onStudio`, replace the fourth disabled button with an enabled `Create Map` button, and preserve the existing icon dimensions. In `DashboardLayout`, set:

```ts
const onCreateMap = isCreateMapPath(pathname);
const hideSidebarForCreateMap = onCreateMap;
const showStudioSidebar = !hideSidebarForSimulation && !onScriptSystem && !hideSidebarForCreateMap;
const hideChatPanel = hideSidebarForSimulation || hideSidebarForCreateMap;
```

Make the route page render only `CreateMapWorkbench`; the dashboard wrapper continues to own authentication and global chrome.

- [ ] **Step 4: Build the approved static workbench frame**

Create semantic left, center, and right regions with the wireframe labels and stable dimensions:

```tsx
<main className={styles.workbench} data-testid="create-map-workbench">
  <aside className={styles.leftPanel} aria-label="Map source and layers" />
  <section className={styles.canvasPanel} aria-label="Map canvas" />
  <aside className={styles.rightPanel} aria-label="Map plan and inspector" />
</main>
```

Use grid tracks `minmax(232px, 260px) minmax(480px, 1fr) minmax(286px, 320px)`, an unframed canvas work surface, 6-8 px control radii, and existing Keco neutral/blue tokens. Do not put panels inside cards.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx jest tests/unit/create-map/create-map-shell.test.ts tests/unit/layout/leftnav-wiring.test.ts --runInBand && npm run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit the route shell**

```bash
git add src/lib/create-map src/app/'(dashboard)'/create-map src/features/create-map src/components/layout/LeftNav.tsx src/components/layout/DashboardLayout.tsx tests/unit/create-map tests/unit/layout/leftnav-wiring.test.ts
git commit -m "feat: add create map workspace shell"
```

### Task 2: Define And Validate MapPlan And MapScene

**Files:**
- Create: `src/features/create-map/model/mapPlanSchema.ts`
- Create: `src/features/create-map/model/mapSceneSchema.ts`
- Create: `tests/unit/create-map/fixtures.ts`
- Create: `tests/unit/create-map/map-plan-schema.test.ts`
- Create: `tests/unit/create-map/map-scene-schema.test.ts`

**Interfaces:**
- Produces: `MapPlanSchema`, `MapPlan`, `MapSceneSchema`, `MapScene`, `MapAssetRecord`, `MapRevisionRecord`.
- Produces: `validateMapPlan(plan): { success: true; data: MapPlan } | { success: false; issues: MapPlanIssue[] }`.
- Consumes: no React or provider code.

- [ ] **Step 1: Write failing plan validation tests**

```ts
it('rejects duplicate keys, missing terrain references, invalid polygons, and off-map objects', () => {
  const plan = makeValidMapPlan();
  plan.objects.push({ ...plan.objects[0], assetKey: plan.objects[0].assetKey });
  plan.roads[0].terrainKey = 'missing';
  plan.obstacles[0] = { id: 'bad', shape: 'polygon', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] };
  plan.objectInstances[0].position.x = plan.map.width + 1;
  const result = validateMapPlan(plan);
  expect(result.success).toBe(false);
  if (!result.success) expect(result.issues.map((issue) => issue.code)).toEqual(
    expect.arrayContaining(['duplicate_asset_key', 'missing_terrain', 'invalid_polygon', 'outside_map'])
  );
});
```

Also test a complete fixture with terrain transitions, a road, one movable object, and all three obstacle types.

- [ ] **Step 2: Run tests and verify missing-schema failures**

Run: `npx jest tests/unit/create-map/map-plan-schema.test.ts tests/unit/create-map/map-scene-schema.test.ts --runInBand`

Expected: FAIL because the schemas are absent.

- [ ] **Step 3: Implement provider-independent schemas**

Define strict Zod objects with these stable roots:

```ts
type MapPlan = {
  schemaVersion: 1;
  name: string;
  visualBrief: string;
  map: { width: number; height: number; tileSize: 16 | 32 | 48 | 64; projection: 'top-down'; palette: string[]; stylePrompt: string };
  terrains: TerrainPlan[];
  roads: RoadPlan[];
  objects: MapObjectPlan[];
  objectInstances: PlannedObjectInstance[];
  obstacles: Obstacle[];
};

type MapScene = {
  schemaVersion: 1;
  size: { width: number; height: number; tileSize: number };
  layers: SceneLayer[];
  tiles: TilePlacement[];
  objects: ObjectInstance[];
  obstacles: Obstacle[];
  canvas: { zoom: number; panX: number; panY: number; snapToGrid: boolean };
};
```

Use discriminated unions for rectangle, circle, and polygon obstacles. Use pixel/map-space coordinates, not browser coordinates. Resource prompts are per asset and may not contain credential-shaped fields.

- [ ] **Step 4: Add semantic validation after Zod parsing**

`validateMapPlan` checks unique keys, valid references, bounds, positive dimensions, supported tile size, at least one terrain, polygon point count/nonzero area, and road endpoint bounds. Return stable codes and field paths for inspector errors.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx jest tests/unit/create-map/map-plan-schema.test.ts tests/unit/create-map/map-scene-schema.test.ts --runInBand && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the domain contracts**

```bash
git add src/features/create-map/model tests/unit/create-map
git commit -m "feat: define create map domain schemas"
```

### Task 3: Add Deterministic Editor Commands, Coordinates, And Mask Model

**Files:**
- Create: `src/features/create-map/model/mapSceneReducer.ts`
- Create: `src/features/create-map/model/coordinates.ts`
- Create: `src/features/create-map/model/mask.ts`
- Create: `tests/unit/create-map/map-scene-reducer.test.ts`
- Create: `tests/unit/create-map/coordinates.test.ts`
- Create: `tests/unit/create-map/mask.test.ts`

**Interfaces:**
- Produces: `createEditorState(scene)`, `reduceEditorCommand(state, command)`, `undo`, `redo`.
- Produces: `screenToMap`, `mapToScreen`, `snapPoint`, `createMask`, `paintMask`, `encodeBinaryMaskPng`.
- Consumes: Task 2 scene and obstacle types.

- [ ] **Step 1: Write failing reducer and coordinate tests**

```ts
it('moves one object, preserves others, and supports undo/redo', () => {
  const initial = createEditorState(makeValidMapScene());
  const moved = reduceEditorCommand(initial, { type: 'object/move', id: 'tree-1', position: { x: 96, y: 64 } });
  expect(findObject(moved.present, 'tree-1').position).toEqual({ x: 96, y: 64 });
  expect(undo(moved).present).toEqual(initial.present);
  expect(redo(undo(moved)).present).toEqual(moved.present);
});

it('converts screen coordinates through pan and zoom then snaps', () => {
  expect(screenToMap({ x: 220, y: 140 }, { zoom: 2, panX: 20, panY: 12 })).toEqual({ x: 100, y: 64 });
  expect(snapPoint({ x: 101, y: 63 }, 16)).toEqual({ x: 96, y: 64 });
});
```

Test add/move/resize/delete for every obstacle shape, layer reorder/visibility, selection, and history truncation after a new command.

- [ ] **Step 2: Write failing mask tests**

Test that black is preserved, brush pixels become white, clipping works at edges, and encoded PNG dimensions exactly equal the selected source image.

- [ ] **Step 3: Run tests and confirm failures**

Run: `npx jest tests/unit/create-map/map-scene-reducer.test.ts tests/unit/create-map/coordinates.test.ts tests/unit/create-map/mask.test.ts --runInBand`

Expected: FAIL because the editor modules are missing.

- [ ] **Step 4: Implement immutable commands and bounded history**

Use this command union and cap past/future history at 100 entries:

```ts
type EditorCommand =
  | { type: 'object/move'; id: string; position: Point }
  | { type: 'object/transform'; id: string; scale: number; rotation: number }
  | { type: 'obstacle/add'; obstacle: Obstacle }
  | { type: 'obstacle/update'; obstacle: Obstacle }
  | { type: 'obstacle/delete'; id: string }
  | { type: 'layer/reorder'; layerId: string; toIndex: number }
  | { type: 'layer/visibility'; layerId: string; visible: boolean };
```

Do not store hover, pointer capture, or transient polygon preview in durable scene state.

- [ ] **Step 5: Implement binary mask storage and deterministic PNG encoding**

Represent mask pixels as `Uint8Array(width * height)` containing only `0` or `255`. `paintMask` uses a circular brush. `encodeBinaryMaskPng` writes RGBA values where RGB equals the mask byte and alpha is 255; verify the encoded IHDR dimensions in tests.

- [ ] **Step 6: Run tests and typecheck**

Run: `npx jest tests/unit/create-map/map-scene-reducer.test.ts tests/unit/create-map/coordinates.test.ts tests/unit/create-map/mask.test.ts --runInBand && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit editor primitives**

```bash
git add src/features/create-map/model tests/unit/create-map
git commit -m "feat: add create map editor commands"
```

### Task 4: Build The Interactive Workbench UI

**Files:**
- Create: `src/features/create-map/components/MapSourcePanel.tsx`
- Create: `src/features/create-map/components/MapStages.tsx`
- Create: `src/features/create-map/components/MapLayerList.tsx`
- Create: `src/features/create-map/components/MapToolbar.tsx`
- Create: `src/features/create-map/components/MapCanvas.tsx`
- Create: `src/features/create-map/components/MapPlanInspector.tsx`
- Create: `src/features/create-map/components/ObjectInspector.tsx`
- Create: `src/features/create-map/components/ObstacleInspector.tsx`
- Create: `src/features/create-map/components/InpaintInspector.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.module.css`
- Test: `tests/unit/create-map/workbench-wiring.test.tsx`
- Test: `tests/unit/create-map/canvas-renderer.test.ts`

**Interfaces:**
- Consumes: Task 2 schemas and Task 3 commands/conversions.
- Produces: `renderMapScene(ctx, scene, assets, viewport)` and accessible editor controls.

- [ ] **Step 1: Write failing workbench contract tests**

Assert the source selectors, stage list, Layers/Objects tabs, canvas toolbar, plan inspector, object inspector, obstacle inspector, Inpaint controls, save indicator, and retry status are wired. Keep pure renderer assertions separate from source-string wiring tests.

```ts
it('renders layers behind objects and editing overlays last', () => {
  const calls = recordCanvasCalls();
  renderMapScene(calls.context, makeValidMapScene(), makeReadyAssets(), defaultViewport);
  expect(calls.kinds).toEqual(['terrain', 'road', 'object', 'obstacle-overlay', 'selection-overlay']);
});
```

- [ ] **Step 2: Run tests and verify missing component failures**

Run: `npx jest tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/canvas-renderer.test.ts --runInBand`

Expected: FAIL.

- [ ] **Step 3: Implement stable workbench controls**

Use icon buttons with `aria-label` and tooltips for select, hand, undo, redo, rectangle, circle, polygon, mask, zoom in, and zoom out. Use a checkbox/toggle for snap-to-grid and segmented controls for Layers/Objects and New map/Regenerate. Keep toolbar button dimensions fixed at 32 by 32 px.

- [ ] **Step 4: Implement the Canvas 2D renderer and pointer controller**

Render at `devicePixelRatio` without changing CSS dimensions. Draw terrain/roads, transparent objects using ground anchors, then overlays. Pointer interactions convert through `screenToMap`, apply optional snapping, and dispatch one durable command on pointer-up. Polygon creation finishes on double click or Enter and cancels on Escape.

- [ ] **Step 5: Match the approved responsive composition**

Keep 1440 by 900 parity with the wireframe. At widths below 1100 px, use left/right overlay drawers controlled by icon buttons; never horizontally compress the canvas toolbar until text overlaps. Avoid nested cards and decorative gradients.

- [ ] **Step 6: Run focused tests, typecheck, and build**

Run: `npx jest tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/canvas-renderer.test.ts --runInBand && npm run typecheck && npm run build`

Expected: PASS and successful Next production build.

- [ ] **Step 7: Commit the interactive UI**

```bash
git add src/features/create-map tests/unit/create-map
git commit -m "feat: build create map editing workbench"
```

### Task 5: Add Map Persistence, RLS, Revisions, Assets, And Private Storage

**Files:**
- Create: `supabase/migrations/20260808010000_create_map_workbench.sql`
- Create: `tests/unit/database/create-map-workbench-migration.test.ts`
- Create: `tests/unit/database/create-map-workbench.rls.behavior.test.ts`

**Interfaces:**
- Produces: `map_projects`, `map_revisions`, `map_assets`, private `map-assets` bucket.
- Produces RPCs: `create_map_project`, `save_map_draft`, `fork_map_draft`, `publish_map_revision`, `create_map_asset_plan`, `transition_map_asset`.
- Consumes: existing project role helpers and `update_updated_at_column`.

- [ ] **Step 1: Write failing static migration tests**

Assert table keys, cascades, status checks, source token columns, unique `(map_revision_id, asset_key)`, private bucket, project-scoped Storage paths, RLS policies, direct-write revocation, and `SECURITY DEFINER SET search_path = ''` on every mutation RPC.

```ts
it('uses compare-and-swap for draft saves', () => {
  expect(sql).toMatch(/save_map_draft[\s\S]+p_expected_save_version bigint/i);
  expect(sql).toMatch(/save_version = map_revisions\.save_version \+ 1/i);
  expect(sql).toMatch(/map_revisions\.save_version = p_expected_save_version/i);
  expect(sql).toMatch(/select 'conflict'::text/i);
});
```

- [ ] **Step 2: Run static tests and verify the migration is absent**

Run: `npx jest tests/unit/database/create-map-workbench-migration.test.ts --runInBand`

Expected: FAIL.

- [ ] **Step 3: Implement normalized identities and immutable payloads**

Use UUID primary keys. `map_projects.current_revision_id` is deferred as an FK until `map_revisions` exists. `map_revisions` stores `revision_number`, mutable `save_version` only while `status='draft'`, source document ID/updated time/epoch/revision, `schema_version=1`, plan JSONB, scene JSONB, and status. Published plan/scene JSON never changes. Asset state remains independently mutable.

- [ ] **Step 4: Implement atomic RPC contracts**

Use these return shapes:

```sql
-- create_map_project -> (map_id uuid, draft_revision_id uuid, revision_number bigint, save_version bigint)
-- save_map_draft -> (status text, save_version bigint)
-- fork_map_draft -> (status text, draft_revision_id uuid, revision_number bigint, save_version bigint)
-- publish_map_revision -> (status text, published_revision_id uuid, next_draft_revision_id uuid)
-- create_map_asset_plan -> (asset_id uuid, status text)
-- transition_map_asset -> (asset_id uuid, status text, attempt_count integer)
```

`fork_map_draft` locks the map and creates a new current draft from an explicitly readable parent revision; use it for conflict-safe Save as new revision, Inpaint apply, and rollback. `publish_map_revision` locks the map, verifies expected `save_version`, changes the current draft to `generating`, creates the next draft with parent/source/plan/scene copied, and advances `current_revision_id`. `transition_map_asset` validates legal state transitions and never changes `asset_key`.

- [ ] **Step 5: Implement RLS and Storage policies**

Accepted collaborators may select map rows. Owner/admin/editor may use mutation RPCs. Viewer, outsider, pending collaborator, and anonymous callers cannot mutate. Storage object names must follow `{projectId}/{mapId}/{revisionId}/{assetKey}/{sha256}.png`; access joins the first path segment to an accessible project. Only the Edge Function service role writes provider bytes.

- [ ] **Step 6: Add opt-in live behavior tests**

Cover owner/admin/editor/viewer/outsider/pending/anonymous, stale concurrent draft saves, immutable published payloads, one logical asset row across retries, and project cascade. Use the existing `RLS_DB_TESTS_ENABLED` harness.

- [ ] **Step 7: Run migration tests**

Run: `npx jest tests/unit/database/create-map-workbench-migration.test.ts tests/unit/database/create-map-workbench.rls.behavior.test.ts --runInBand`

Expected: static tests PASS; live tests PASS when configured or report skipped under the existing gate.

- [ ] **Step 8: Commit persistence**

```bash
git add supabase/migrations/20260808010000_create_map_workbench.sql tests/unit/database/create-map-workbench*
git commit -m "feat: persist versioned create map projects"
```

### Task 6: Load Project Documents, Create MapPlan, And Autosave Drafts

**Files:**
- Create: `src/lib/server/createMapDocumentSource.ts`
- Create: `src/lib/server/createMapPlanner.ts`
- Create: `src/app/api/create-map/plan/route.ts`
- Create: `src/features/create-map/services/createMapService.ts`
- Create: `src/features/create-map/hooks/useMapSources.ts`
- Create: `src/features/create-map/hooks/useMapDraft.ts`
- Modify: `src/features/create-map/CreateMapWorkbench.tsx`
- Test: `tests/unit/create-map/create-map-planner.test.ts`
- Test: `tests/unit/create-map/create-map-plan-route.test.ts`
- Test: `tests/unit/create-map/create-map-service.test.ts`

**Interfaces:**
- Produces: `readCreateMapDocumentSource(supabase, userId, documentId): Promise<CreateMapDocumentSource>`.
- Produces: `createMapPlanFromDocument(markdown, source): Promise<MapPlan>`.
- Produces: `createMapService(supabase)` with source, CRUD, CAS save, publish, asset, and Edge invoke methods.
- Consumes: existing `listProjects`, `listDocuments`, `documentStateGateway`, `completeLlmNonStreaming`.

- [ ] **Step 1: Write failing planner tests**

Mock `completeLlmNonStreaming` and assert the planner uses required tool `submit_map_plan`, temperature 0, provider-independent JSON, MapPlan validation, one correction retry for invalid model output, and no document text in logs.

```ts
expect(mockedComplete).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
  temperature: 0,
  thinking: 'disabled',
  toolName: 'submit_map_plan',
}));
```

- [ ] **Step 2: Write failing route and service tests**

Test 401, 403 for viewer, cross-project source rejection, empty Document, valid source token binding, LLM error sanitization, project-scoped Document list, and `save_map_draft` conflict mapping.

- [ ] **Step 3: Run tests and confirm failures**

Run: `npx jest tests/unit/create-map/create-map-planner.test.ts tests/unit/create-map/create-map-plan-route.test.ts tests/unit/create-map/create-map-service.test.ts --runInBand`

Expected: FAIL.

- [ ] **Step 4: Implement consistent source reads**

Read through `documentStateGateway`, fetch name/updated timestamp, verify the role is admin/editor, reject blank markdown, and return:

```ts
type CreateMapDocumentSource = {
  documentId: string;
  projectId: string;
  documentName: string;
  documentUpdatedAt: string;
  markdown: string;
  token: { epoch: number; revision: number };
};
```

- [ ] **Step 5: Implement structured MapPlan generation**

Define an OpenAI-compatible tool schema matching Task 2. The system message must state: top-down only, PixelLab creates resource images rather than gameplay geometry, roads use terrain transitions, all assets need stable kebab-case keys, object placements remain editable, and obstacles use Keco geometry. Parse JSON and run `validateMapPlan`; retry once with issue codes and paths, then return `map_plan_invalid_response`.

- [ ] **Step 6: Implement route and browser service**

`POST /api/create-map/plan` body is `{ projectId, documentId }`. Authenticate with `withAuth`, require admin/editor on the body project, verify the source project again, and return `{ sourceToken, plan }`. The browser service calls existing project/Document services, map RPCs, and `supabase.functions.invoke('pixellab-map', { body })`; translate PostgREST/Function errors into stable UI codes.

- [ ] **Step 7: Add debounced optimistic autosave**

`useMapDraft` waits 750 ms after the last durable command, saves the expected `saveVersion`, updates it only on `saved`, and freezes autosave on `conflict` until the user chooses Reload or Save as new revision.

- [ ] **Step 8: Run focused tests and typecheck**

Run: `npx jest tests/unit/create-map/create-map-planner.test.ts tests/unit/create-map/create-map-plan-route.test.ts tests/unit/create-map/create-map-service.test.ts --runInBand && npm run typecheck`

Expected: PASS.

- [ ] **Step 9: Commit source-to-plan flow**

```bash
git add src/lib/server/createMap* src/app/api/create-map src/features/create-map tests/unit/create-map
git commit -m "feat: create map plans from project documents"
```

### Task 7: Implement The PixelLab Capability Adapter And Authenticated Edge API

**Files:**
- Create: `supabase/functions/pixellab-map/deno.json`
- Create: `supabase/functions/pixellab-map/types.ts`
- Create: `supabase/functions/pixellab-map/auth.ts`
- Create: `supabase/functions/pixellab-map/pixellab-client.ts`
- Create: `supabase/functions/pixellab-map/http.ts`
- Create: `supabase/functions/pixellab-map/index.ts`
- Create: `supabase/functions/pixellab-map/auth.test.ts`
- Create: `supabase/functions/pixellab-map/pixellab-client.test.ts`
- Create: `supabase/functions/pixellab-map/http.test.ts`
- Create: `scripts/probe-pixellab-map.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: Edge operations `capabilities`, `submit`, `poll`, `retry`, and `inpaint`.
- Produces: `PixelLabClient` with `discover`, `submitAsset`, `pollJob`, `downloadResult`.
- Consumes: `PIXELLAB_API_TOKEN`, authenticated Supabase bearer token, Task 5 map rows.

- [ ] **Step 1: Write failing auth/HTTP tests**

Test OPTIONS, method/body limits, missing bearer token, invalid user, viewer, cross-project asset, missing configuration, stable response codes, and that provider fetch is never called before authorization.

- [ ] **Step 2: Write failing provider contract tests**

Use injected `fetch` fixtures for MCP `tools/list`, MCP tool invocation, asynchronous REST submission/polling, 429/5xx retry classification, malformed responses, and redaction. Assert no request/log/error contains the token.

```ts
Deno.test('prefers a live MCP capability and records its actual name', async () => {
  const client = makeClient(mcpFixture(['create_topdown_tileset']));
  const capability = await client.discover('topdown_tileset');
  assertEquals(capability, { transport: 'mcp', operation: 'create_topdown_tileset' });
});
```

- [ ] **Step 3: Run Deno tests and confirm failures**

Run: `deno test --config supabase/functions/pixellab-map/deno.json --allow-env supabase/functions/pixellab-map`

Expected: FAIL because the function does not exist.

- [ ] **Step 4: Implement closed operation contracts**

Validate strict request unions:

```ts
type PixelLabMapRequest =
  | { operation: 'capabilities'; projectId: string }
  | { operation: 'submit'; projectId: string; mapId: string; revisionId: string; assetId: string }
  | { operation: 'poll'; projectId: string; assetId: string }
  | { operation: 'retry'; projectId: string; assetId: string }
  | { operation: 'inpaint'; projectId: string; mapId: string; revisionId: string; sourceAssetId: string; assetId: string; maskPath: string };
```

Set a 64 KiB JSON body limit. Authorize user JWT with an auth-bound Supabase client, load the asset/revision/map join, and require admin/editor before provider access.

- [ ] **Step 5: Implement live MCP discovery and exact REST fallbacks**

Send MCP JSON-RPC to `https://api.pixellab.ai/mcp`, parse JSON or SSE responses, and match semantic capabilities from the returned names/descriptions/schemas. Do not hardcode a successful MCP capability without discovery. If a required semantic operation is absent, allow only these documented REST fallbacks: `/create-tileset`, `/map-objects`, and `/inpaint-v3`. Record `{ transport, operation, schemaFingerprint }` on the asset row.

- [ ] **Step 6: Implement safe polling and errors**

Persist provider job ID before returning. `poll` resumes from that ID. Retry network/429/5xx with bounded backoff only before a paid submission is acknowledged. After acknowledgement, poll rather than resubmit. Map errors to `pixellab_not_configured`, `pixellab_capability_missing`, `pixellab_rate_limited`, `pixellab_upstream`, or `pixellab_invalid_response`.

- [ ] **Step 7: Add an opt-in redacted probe**

`npm run probe:pixellab-map` checks only whether the environment variable is present, lists semantic capabilities and schema fingerprints, and optionally submits one test asset when `PIXELLAB_PROBE_GENERATE=1`. It must never print prompts, bearer headers, signed URLs, provider bodies, or token fragments.

- [ ] **Step 8: Run Deno tests and checks**

Run: `deno test --config supabase/functions/pixellab-map/deno.json --allow-env supabase/functions/pixellab-map && deno check --config supabase/functions/pixellab-map/deno.json supabase/functions/pixellab-map/index.ts`

Expected: PASS.

- [ ] **Step 9: Commit the provider boundary**

```bash
git add supabase/functions/pixellab-map scripts/probe-pixellab-map.ts package.json
git commit -m "feat: add authenticated PixelLab map adapter"
```

### Task 8: Validate, Store, And Read Back Generated Assets

**Files:**
- Create: `supabase/functions/pixellab-map/png.ts`
- Create: `supabase/functions/pixellab-map/storage.ts`
- Create: `supabase/functions/pixellab-map/png.test.ts`
- Create: `supabase/functions/pixellab-map/storage.test.ts`
- Modify: `supabase/functions/pixellab-map/deno.json`
- Modify: `supabase/functions/pixellab-map/http.ts`

**Interfaces:**
- Produces: `validatePng(bytes, expectation): ValidatedPng`.
- Produces: `persistValidatedAsset(context, asset, bytes): ReadyAssetBinding`.
- Consumes: Task 5 storage path and asset transition RPC, Task 7 provider downloads.

- [ ] **Step 1: Write failing PNG tests**

Fixture tests cover signature, truncation, declared dimensions, tile-grid alignment, required/forbidden alpha, all-transparent/all-blank images, visible pixels, and SHA-256.

- [ ] **Step 2: Write failing storage tests**

Assert upload uses exact private path, read-back downloads the same bytes/hash, `ready` happens only after read-back, storage retry does not call PixelLab again, and failed validation never binds a storage path.

- [ ] **Step 3: Run tests and verify failures**

Run: `deno test --config supabase/functions/pixellab-map/deno.json --allow-env supabase/functions/pixellab-map/png.test.ts supabase/functions/pixellab-map/storage.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement pure PNG validation**

Use a pinned pure-JavaScript PNG decoder in `deno.json`. Reject files over 10 MiB, non-PNG data, unexpected dimensions, empty visible content, matte alpha for transparent objects, and tilesets whose atlas is not divisible by tile size. Calculate SHA-256 with Web Crypto.

- [ ] **Step 5: Implement authoritative upload/read-back**

Upload with the service-role client only after authorization and validation. Use `upsert: false`, `contentType: image/png`, and the hash path. Immediately download, byte-compare/hash-compare, then call `transition_map_asset(p_asset_id, p_expected_status, 'ready', p_metadata)`. On upload/read-back failure, retain provider job metadata and set `failed` with `storage_failed`; retry persistence from recoverable provider bytes/job output.

- [ ] **Step 6: Run all Edge tests and checks**

Run: `deno test --config supabase/functions/pixellab-map/deno.json --allow-env supabase/functions/pixellab-map && deno check --config supabase/functions/pixellab-map/deno.json supabase/functions/pixellab-map/index.ts`

Expected: PASS.

- [ ] **Step 7: Commit validated persistence**

```bash
git add supabase/functions/pixellab-map
git commit -m "feat: validate and persist PixelLab map assets"
```

### Task 9: Generate Terrain, Roads, Objects, And Partial-Retry Progress

**Files:**
- Create: `src/features/create-map/model/terrainComposer.ts`
- Create: `src/features/create-map/hooks/useMapGeneration.ts`
- Create: `tests/unit/create-map/terrain-composer.test.ts`
- Create: `tests/unit/create-map/map-generation.test.ts`
- Modify: `src/features/create-map/CreateMapWorkbench.tsx`
- Modify: `src/features/create-map/components/MapLayerList.tsx`
- Modify: `src/features/create-map/components/MapCanvas.tsx`
- Modify: `src/features/create-map/services/createMapService.ts`

**Interfaces:**
- Produces: `composeTerrain(plan, wangMetadata, seed): TilePlacement[]`.
- Produces: `useMapGeneration` with `start`, `retryAsset`, `cancelQueued`, and derived progress.
- Consumes: tasks 2, 5, 7, and 8.

- [ ] **Step 1: Write failing terrain composition tests**

Test deterministic seed output, `pattern_4x4` mapping, grass/dirt-road transitions, straight/corner/T/end road coverage, no out-of-bounds placement, and identical plan+seed output.

- [ ] **Step 2: Write failing generation state tests**

Model one tileset success, one object failure, and one pending object. Assert the map status is `partial`, successful asset IDs remain bound, retry invokes only the failed asset ID, and refresh reconstruction uses database rows rather than creating new plans.

- [ ] **Step 3: Run tests and verify failures**

Run: `npx jest tests/unit/create-map/terrain-composer.test.ts tests/unit/create-map/map-generation.test.ts --runInBand`

Expected: FAIL.

- [ ] **Step 4: Implement deterministic terrain and road composition**

Build a seeded vertex terrain grid from MapPlan terrain weights/regions. Convert terrain corner combinations through PixelLab `pattern_4x4`/Wang metadata. Rasterize road centerlines into the road terrain key, then recalculate neighboring transition tiles. Keep layout generation in Keco; never ask PixelLab for obstacle or navigation data.

- [ ] **Step 5: Implement asset manifest publication**

On `Generate map`, publish the frozen draft, create/read back one planned row for the tileset and one per object definition, then submit each planned asset. Limit active submissions to two. Store the exact style/reference context in sanitized parameters. Suggested object instances are created in the next draft and reference stable asset keys.

- [ ] **Step 6: Implement polling, partial state, retry, and cancellation**

Poll queued/generating assets with exponential intervals capped at 10 seconds and stop on terminal state/unmount. Derive overall status from asset rows. Retry only `failed`/`blocked` assets after capability/config becomes available. Cancel only queued local submissions plus provider jobs that advertise cancellation; retain completed assets.

- [ ] **Step 7: Render generated resources without flattening**

Load signed preview URLs on demand, cache decoded `ImageBitmap`s by hash, draw atlas tiles by metadata, and place objects by ground anchor/z-order. Revoke/expire URL state without storing signed URLs in `MapScene`.

- [ ] **Step 8: Run tests, typecheck, and build**

Run: `npx jest tests/unit/create-map/terrain-composer.test.ts tests/unit/create-map/map-generation.test.ts --runInBand && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 9: Commit generation orchestration**

```bash
git add src/features/create-map tests/unit/create-map
git commit -m "feat: generate layered map assets"
```

### Task 10: Complete Obstacles And Mask-Based Inpaint Revisions

**Files:**
- Create: `src/features/create-map/hooks/useInpaint.ts`
- Create: `tests/unit/create-map/inpaint-flow.test.ts`
- Modify: `src/features/create-map/components/InpaintInspector.tsx`
- Modify: `src/features/create-map/components/ObstacleInspector.tsx`
- Modify: `src/features/create-map/components/MapCanvas.tsx`
- Modify: `src/features/create-map/services/createMapService.ts`
- Modify: `supabase/functions/pixellab-map/http.ts`
- Test: `supabase/functions/pixellab-map/inpaint.test.ts`

**Interfaces:**
- Produces: `useInpaint` with `beginMask`, `submit`, `apply`, `rollback`, `retry`.
- Consumes: Task 3 mask PNG, Task 5 revision RPCs, Task 7/8 provider and storage flow.

- [ ] **Step 1: Write failing browser Inpaint flow tests**

Assert Inpaint requires a ready raster selection, mask dimensions match source pixels, submit creates a derived planned asset, failure leaves the source reference untouched, apply changes only the selected instance/layer in a new draft, and rollback creates a new pointer revision without deleting bytes.

- [ ] **Step 2: Write failing Edge Inpaint tests**

Verify white means generate, black means preserve, mask/source dimensions match, source hash is current, operation prefers live MCP then `/inpaint-v3`, and output uses normal PNG validation/storage/read-back.

- [ ] **Step 3: Run tests and confirm failures**

Run: `npx jest tests/unit/create-map/inpaint-flow.test.ts --runInBand && deno test --config supabase/functions/pixellab-map/deno.json --allow-env supabase/functions/pixellab-map/inpaint.test.ts`

Expected: FAIL.

- [ ] **Step 4: Complete obstacle inspectors and canvas tools**

Expose numeric x/y/width/height, center/radius, and polygon point editing. Derive an object's suggested obstacle from its visible footprint only as an explicit user action; never use full transparent PNG bounds automatically.

- [ ] **Step 5: Implement mask upload and derived asset generation**

Upload masks to a temporary private path bound to user/project/map/revision and validate ownership in the Edge Function. Provider input includes ready source bytes/reference, binary mask, and prompt. Create a new asset key such as `{sourceKey}-inpaint-{shortId}` and preserve `derivedFromAssetId`.

- [ ] **Step 6: Implement apply and rollback commands**

Apply writes a new draft scene reference after the derived asset is ready. Rollback writes another new revision whose reference points to the prior asset. Neither operation deletes source, derived image, mask audit metadata, or history.

- [ ] **Step 7: Run browser/Edge tests, typecheck, and build**

Run: `npx jest tests/unit/create-map/inpaint-flow.test.ts tests/unit/create-map/map-scene-reducer.test.ts --runInBand && deno test --config supabase/functions/pixellab-map/deno.json --allow-env supabase/functions/pixellab-map && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 8: Commit obstacle/Inpaint workflow**

```bash
git add src/features/create-map tests/unit/create-map supabase/functions/pixellab-map
git commit -m "feat: edit obstacles and inpaint map assets"
```

### Task 11: Add Recovery UX, Environment Documentation, E2E Coverage, And Final Verification

**Files:**
- Create: `.env.example`
- Create: `tests/e2e/pages/create-map.page.ts`
- Create: `tests/e2e/specs/create-map.spec.ts`
- Modify: `src/features/create-map/CreateMapWorkbench.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.module.css`
- Modify: `package.json`
- Modify: `README.md` only if it already contains local Supabase function setup; otherwise keep setup in `.env.example` comments and the probe help.

**Interfaces:**
- Produces: tested reload/conflict/partial/retry/responsive flows.
- Documents: `PIXELLAB_API_TOKEN` variable name and Supabase production secret command without any value.
- Consumes: every prior task.

- [ ] **Step 1: Write the E2E fixture and mocked provider workflow**

Create an owner, project, and map-source Document. Mock `/api/create-map/plan` and the `pixellab-map` function with deterministic PNG fixtures for default CI. The page object exposes source selection, plan generation, asset progress, object movement, obstacle creation, mask painting, retry, refresh, and conflict actions.

- [ ] **Step 2: Write failing browser tests**

Cover:

```ts
test('creates a layered map from a project Document and restores it after refresh', async ({ page }) => {
  const map = new CreateMapPage(page);
  await map.goto();
  await map.selectSource(projectName, documentName);
  await map.createAndApprovePlan();
  await map.generateMap();
  await map.expectLayersReady(['Terrain', 'Roads and water', 'Map objects']);
  await page.reload();
  await map.expectLayersReady(['Terrain', 'Roads and water', 'Map objects']);
});

test('keeps ready terrain when one object fails and retries only that object', async ({ page }) => {
  const calls = await installPartialGenerationFixture(page, { failedAssetKey: 'market-stall' });
  const map = new CreateMapPage(page);
  await map.gotoExisting(mapId);
  await map.expectAssetStatus('terrain-main', 'Ready');
  await map.expectAssetStatus('market-stall', 'Failed');
  await map.retryAsset('market-stall');
  expect(calls.submittedAssetKeys).toEqual(['market-stall']);
});

test('moves objects and edits rectangle, circle, and polygon obstacles', async ({ page }) => {
  const map = new CreateMapPage(page);
  await map.gotoExisting(mapId);
  await map.moveObject('tree-1', { x: 160, y: 96 });
  await map.createRectangleObstacle({ x: 32, y: 32, width: 64, height: 48 });
  await map.createCircleObstacle({ cx: 240, cy: 120, radius: 24 });
  await map.createPolygonObstacle([{ x: 300, y: 80 }, { x: 340, y: 112 }, { x: 304, y: 144 }]);
  await map.expectSavedScene({ objectId: 'tree-1', obstacleCount: 3 });
});

test('applies and rolls back an Inpaint-derived asset', async ({ page }) => {
  const map = new CreateMapPage(page);
  await map.gotoExisting(mapId);
  const sourceHash = await map.selectedAssetHash('tree-1');
  await map.inpaintSelection('tree-1', 'Add red fruit', { x: 8, y: 8, width: 16, height: 16 });
  const derivedHash = await map.selectedAssetHash('tree-1');
  expect(derivedHash).not.toBe(sourceHash);
  await map.rollbackInpaint();
  expect(await map.selectedAssetHash('tree-1')).toBe(sourceHash);
});

test('offers reload or new revision after optimistic conflict', async ({ page }) => {
  await installDraftConflictFixture(page);
  const map = new CreateMapPage(page);
  await map.gotoExisting(mapId);
  await map.moveObject('tree-1', { x: 128, y: 96 });
  await map.expectConflictActions(['Reload current', 'Save as new revision']);
  await map.saveAsNewRevision();
  await map.expectRevisionNumber(3);
});
```

- [ ] **Step 3: Run E2E and capture the expected pre-polish failures**

Run: `npx playwright test tests/e2e/specs/create-map.spec.ts --project=chromium`

Expected: FAIL on incomplete recovery/responsive assertions.

- [ ] **Step 4: Implement explicit recovery and stale-source states**

Add inline retry for source load, stale Document banner with `Create new plan revision`, autosave conflict dialog with only `Reload current` and `Save as new revision`, configuration/capability blocked rows, partial generation summary, storage-resume action, and refresh reconstruction.

- [ ] **Step 5: Document environment names without secrets**

Add `.env.example` with:

```dotenv
# Server-only PixelLab credential. Never prefix with NEXT_PUBLIC_.
PIXELLAB_API_TOKEN=
```

Local development reads the value from ignored `.env.local` and/or ignored `supabase/functions/.env.local`. Production configuration uses `supabase secrets set PIXELLAB_API_TOKEN` interactively; the secret value must not appear in shell history, documentation, commits, test snapshots, or task output. Add `check:pixellab-map` and `test:pixellab-map` scripts.

- [ ] **Step 6: Verify desktop and narrow visual layout**

Capture screenshots at 1440 by 900 and 1024 by 768. Assert the canvas bounding box is nonzero, sample canvas pixels are not all transparent/white, toolbar and panels do not overlap, buttons retain stable dimensions, and longest labels wrap rather than clip.

- [ ] **Step 7: Run focused and full verification**

Run in this order:

```bash
npx jest tests/unit/create-map tests/unit/database/create-map-workbench-migration.test.ts --runInBand
deno test --config supabase/functions/pixellab-map/deno.json --allow-env supabase/functions/pixellab-map
deno check --config supabase/functions/pixellab-map/deno.json supabase/functions/pixellab-map/index.ts
npx playwright test tests/e2e/specs/create-map.spec.ts --project=chromium
npm run lint
npm run typecheck
npm run typecheck:api
npm run build
```

Expected: every command exits 0. If the opt-in live database or PixelLab probe is configured, run those separately and report their paid/external nature.

- [ ] **Step 8: Scan for credentials and accidental generated artifacts**

Run:

```bash
git diff --check
git status --short
git diff --cached --name-only
git grep -n 'PIXELLAB_API_TOKEN=' -- ':!*.example'
```

Expected: no credential assignment in tracked files, no `.env.local`, provider output, signed URL, screenshot diff noise, or unrelated `__pycache__` staged.

- [ ] **Step 9: Commit release hardening**

```bash
git add .env.example package.json src/features/create-map tests/e2e
git commit -m "test: verify create map workflow"
```

---

## Live Integration Gate

The default automated suite uses provider fixtures and makes no paid PixelLab request. Before claiming live PixelLab completion:

1. Confirm `PIXELLAB_API_TOKEN` is present in the ignored local function environment without printing its value.
2. Run `npm run probe:pixellab-map` to capture actual MCP tool names and schema fingerprints.
3. Update only the semantic adapter mapping when live schemas differ; do not weaken validation or silently use a generic image generator.
4. With explicit paid-generation approval already present for this feature, run one tileset, one transparent object, and one Inpaint probe.
5. Record operation names, returned dimensions, alpha checks, hashes, Keco planned/read-back/ready bindings, and any unavailable capability.

## Completion Evidence

The feature is complete only when the full verification commands pass, Playwright screenshots show the approved canvas-first workbench at both viewports, canvas pixel checks are nonblank, the live capability probe has been reconciled, and a real map can be reopened from Keco with terrain, roads, movable objects, editable obstacles, and reversible Inpaint state intact.
