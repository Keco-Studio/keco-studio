# Create Map V2 Layered Generation Design

**Date:** 2026-08-10
**Status:** Implemented; automated verification passed; live PixelLab output evidence pending
**Supersedes:** `2026-08-08-create-map-workbench-design.md` for the Create Map editor and generation workflow

## Objective

Create Map V2 turns a natural-language description into a complete top-down map with two durable ownership domains:

1. a generated, composed, locked background image;
2. independently editable obstacle entities whose visual resources remain bound to their collision geometry.

Users can review and edit the map's structural plan before paid generation, edit obstacles after generation, and select a region of the background to generate a new transparent obstacle that remains movable and editable.

The workflow may use an existing Keco Document as optional context, but a Document is not required. A free-form description is the primary input.

## Product Decisions

- Use the existing Create Map route and three-column workbench.
- Keep the existing Supabase revision, asset provenance, private storage, and PixelLab Edge Function foundations.
- Replace the current schema with `MapPlanV2` and `MapSceneV2` as the only writable formats.
- Do not migrate or open schema version 1 maps in the V2 editor.
- Generate one durable locked background PNG from normalized terrain and path resources.
- Represent each obstacle as one entity that owns a transparent visual resource, transform, layer, and local collision shape.
- Generate selected-region obstacles as transparent PixelLab map objects. Do not bake editable obstacles into the background.
- Remove the current non-functional Regenerate and Inpaint controls. Background Inpaint is outside this delivery.
- Do not build a general TileMap editor. Plan editing operates on terrain polygons and path centerlines, not individual tiles.
- Do not use test-driven development. Implement the approved design first, then add and run the required automated and browser verification before completion.

## Scope

### Included

- free-form map description input;
- optional Project and Document context;
- structured MapPlan V2 generation and correction;
- editable terrain regions and path centerlines before generation;
- PixelLab terrain, path, and transparent obstacle generation;
- normalized provider atlas manifests;
- deterministic server-owned background composition;
- locked background rendering;
- editable obstacle transforms and local collision geometry;
- selected-region obstacle generation;
- obstacle visual regeneration without transform or collision loss;
- revision-safe autosave, generation, retry, restore, and signed previews;
- V2-only saved-map discovery and restore.

### Excluded

- schema version 1 map migration;
- per-tile terrain painting;
- background Inpaint or free-form background brush editing;
- Godot export, navigation mesh generation, or gameplay pathfinding;
- automatic polygon collision tracing;
- provider cancellation when PixelLab does not expose a verified cancellation capability;
- arbitrary user-created background layers;
- collaborative cursor or live co-editing UI.

## User Workflow

### Create A Plan

The source panel contains:

- a required free-form map description;
- an optional Project selector;
- an optional Document selector that is enabled only after selecting a Project;
- a `Create map plan` command.

Plan creation supports two persistence modes:

- Without a Project, the plan is a local preview. The user must select a Project before generating assets.
- With a Project, the V2 draft is persisted and autosaved.

When a Document is selected, the server reads an authorized, consistent Document snapshot and combines it with the user's description. The description is the direct instruction. The Document provides supporting game-design context.

### Review The Plan

Plan Review mode renders a schematic preview rather than generated or placeholder artwork:

- terrain regions appear as palette colors;
- roads and rivers appear as centerlines with their planned width;
- planned obstacles appear as bounded silhouettes;
- validation issues appear next to the affected resource and on the canvas.

The user can:

- edit name, dimensions, tile size, visual brief, style prompt, and palette;
- add, remove, reorder, and retarget terrain regions;
- add, move, and remove terrain polygon vertices;
- add, remove, and retarget paths;
- add, move, and remove path points;
- change path kind, width, and supporting terrain;
- edit terrain, path, and obstacle generation prompts;
- add, remove, and move planned obstacle placements.

`Generate map` is disabled until the complete plan passes structural and semantic validation and a Project has been selected.

### Generate The Map

Generating the map performs this ordered workflow:

1. save the latest valid V2 draft;
2. publish an immutable generation revision;
3. create immutable terrain, path, and obstacle asset plans;
4. ask for explicit user confirmation before paid PixelLab calls;
5. submit and poll PixelLab jobs per asset;
6. normalize completed terrain and path outputs into Keco atlas manifests;
7. validate and store every provider PNG;
8. compose and store the locked background PNG;
9. materialize planned obstacle entities from ready obstacle resources;
10. install the ready scene into the next editable V2 draft.

Successful siblings remain usable when one asset fails. Background composition remains blocked until every source atlas required by the plan is ready.

### Edit The Scene

Scene mode presents three fixed concerns:

- `Background`: one locked background layer with visibility and regenerate commands;
- `Obstacles`: editable obstacle entities with per-entity z-order;
- `Collision`: a transient editing overlay that is not part of visual export.

Obstacle editing supports:

- select;
- drag;
- scale;
- rotate;
- duplicate;
- delete;
- change z-order;
- change collision type;
- edit rectangle, circle, and polygon collision geometry;
- regenerate only the obstacle's visual resource.

Undo and redo operate on Scene commands. Selection, pointer gestures, signed URLs, loading previews, and open inspectors are transient UI state and are not stored in revision payloads.

### Generate An Obstacle In A Region

The `Generate obstacle` tool follows this flow:

1. the user drags a rectangular selection on the map;
2. the region panel captures a required prompt;
3. Keco stores the region in map coordinates and creates a planned obstacle asset;
4. the Edge Function resolves the live PixelLab `map_object` capability;
5. PixelLab generates a transparent PNG;
6. Keco validates and stores the PNG;
7. the editor fits the object into the selected region while preserving aspect ratio;
8. Keco derives an initial local collision shape from the alpha bounds;
9. the entity is selected for immediate adjustment.

The placement transform is deterministic:

- scale is the smaller of selection width divided by asset width and selection height divided by asset height;
- the visual horizontal center aligns with the selection horizontal center;
- the visual ground anchor aligns with the selection bottom center;
- scale must remain positive and finite.

Initial collision derivation uses non-transparent pixels with alpha greater than 16:

- compute the tight non-transparent bounding box;
- use a circle when the bounding-box aspect ratio is between 0.8 and 1.2 and the opaque fill ratio is at least 0.62;
- otherwise use a rectangle;
- express the result in entity-local coordinates relative to the ground anchor;
- never create an automatic polygon in V2.

If generation fails, the selection and prompt remain available for retry. No Scene entity is committed until a validated asset is ready.

## Architecture And Ownership

```text
Natural-language description + optional Document snapshot
  -> MapPlanV2 interpretation and validation
  -> immutable generation revision
  -> terrain/path/obstacle asset plans
  -> PixelLab resource image generation
  -> Keco atlas normalization
  -> Keco deterministic background composition
  -> MapSceneV2 materialization
  -> obstacle editing and revision-safe autosave
```

### Keco Owns

- source binding;
- MapPlan and MapScene schemas;
- structural layout;
- terrain region and path rasterization;
- normalized atlas manifests;
- background pixel composition;
- obstacle transforms;
- collision geometry;
- layer order;
- revisions, permissions, provenance, and storage;
- image validation and read-back;
- current-generation identity.

### PixelLab Owns

- generated terrain image bytes;
- generated path image bytes;
- generated transparent obstacle image bytes;
- provider job state exposed by verified MCP or exact REST fallback capabilities.

PixelLab never owns map layout, collision geometry, background composition, Scene state, or revision identity.

### State Writers

- `MapPlanV2` is written by the planner and Plan Review commands.
- `MapSceneV2` is written by scene materialization and editor commands.
- `map_assets` state is written by database RPCs and the authorized Edge Function.
- the background compositor writes only a derived `background` asset.
- no module writes both Plan and Scene as a side effect of one field edit.

## Domain Schemas

### MapPlanV2

```ts
type MapPlanV2 = {
  schemaVersion: 2;
  name: string;
  visualBrief: string;
  map: {
    width: number;
    height: number;
    tileSize: 16 | 32 | 48 | 64;
    projection: 'top-down';
  };
  background: {
    stylePrompt: string;
    palette: string[];
    baseTerrainKey: string;
    regions: TerrainRegion[];
    paths: BackgroundPath[];
  };
  terrains: TerrainAssetPlan[];
  obstacleAssets: ObstacleAssetPlan[];
  obstaclePlacements: PlannedObstacleEntity[];
};
```

`TerrainRegion` contains a stable ID, a valid terrain asset key, and at least three non-collinear map-space polygon points.

`BackgroundPath` contains a stable ID, editable non-empty name and prompt, kind (`road` or `river`), path asset key, supporting terrain key, positive width, z-order, and at least two map-space centerline points.

`PlannedObstacleEntity` contains a stable ID, obstacle asset key, map-space position, positive scale, finite rotation, integer z-index, and an initial local collision shape.

Plan validation requires:

- positive dimensions divisible by tile size;
- every point and complete region inside map bounds;
- unique resource keys and IDs;
- a valid base terrain;
- non-self-degenerate polygons with positive area;
- positive path width and obstacle scale;
- valid cross-resource references;
- non-empty bounded prompts and palette values.

### MapSceneV2

```ts
type MapSceneV2 = {
  schemaVersion: 2;
  size: {
    width: number;
    height: number;
    tileSize: number;
  };
  background: {
    layerId: 'background';
    assetKey: string;
    sourceRevisionId: string;
    width: number;
    height: number;
    locked: true;
  } | null;
  layers: SceneLayerV2[];
  obstacleEntities: ObstacleEntity[];
  canvas: CanvasState;
};
```

Before materialization, a newly planned Scene has `background: null`, an empty `obstacleEntities` array, and only the fixed layer definitions needed by the editor. After successful background composition and Scene materialization, `background` is required and remains locked. `validateMapSceneV2` accepts `background: null` only for this empty pre-generation Scene; generated or obstacle-bearing Scenes require the complete locked background binding.

`ObstacleEntity` contains:

- stable entity ID;
- obstacle layer ID;
- durable asset key;
- position, positive scale, rotation, and z-index;
- ground anchor;
- one local collision shape;
- source (`plan`, `region-generation`, or `manual`).

Local collision shapes use entity-local coordinates. Rendering and hit testing apply the entity transform to both visual and collision geometry. Moving or transforming an entity cannot leave its collision geometry behind.

### Durable Asset Kinds

```ts
type MapAssetKind = 'terrain' | 'path' | 'obstacle' | 'background';
```

Terrain and path records contain a normalized atlas manifest in metadata after completion. Background records contain:

- source revision ID;
- ordered source asset IDs and SHA-256 hashes;
- canonical Plan fingerprint;
- compositor version;
- output dimensions and SHA-256;
- verified storage path.

Signed URLs, provider credentials, provider response bodies, and temporary external URLs are never durable metadata.

## Normalized Atlas Contract

PixelLab payload parsing remains isolated inside the Edge Function adapter. The rest of Keco consumes this provider-independent contract:

```ts
type NormalizedTileAtlas = {
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

Connectivity masks use four bits in this order:

- north: `1`;
- east: `2`;
- south: `4`;
- west: `8`.

The provider adapter must inspect the live MCP tool schema and normalize either an atlas response or multiple returned tile images into one stored atlas PNG and this manifest. It must not select one hard-coded tile. If a required connectivity mask cannot be normalized, the asset becomes `blocked` with `atlas_manifest_incomplete`.

## Background Composition

Background composition runs server-side as a deterministic pure pixel operation.

1. validate the Plan and every source asset binding;
2. rasterize the base terrain across the complete tile grid;
3. apply terrain regions in array order using tile-center point-in-polygon membership;
4. rasterize paths in ascending z-order using distance to centerline and path width;
5. derive the north/east/south/west connectivity mask for each tile;
6. resolve the corresponding atlas source rectangle;
7. scale source pixels to the map tile size using nearest-neighbor sampling;
8. compose RGBA output bytes;
9. encode and validate the complete PNG;
10. upload, read back, hash, and bind the background asset atomically.

The compositor has a versioned identifier. Equal Plan fingerprints, ordered source hashes, and compositor versions must produce byte-identical output.

Composition never runs in the browser and never treats a signed URL as source authority.

## Persistence And Revision Semantics

- Existing schema version 1 rows remain stored but are not listed or opened by V2.
- The revision schema-version constraint accepts only versions 1 and 2.
- Existing V1 revisions retain a complete source tuple: `source_document_id`, `source_document_updated_at`, `source_epoch`, and `source_revision` are all non-null.
- A V2 revision may omit Document context. Its source tuple is either entirely null or entirely populated; partial source tuples are invalid.
- The durable database asset-kind constraint keeps legacy `road`, `object`, and `inpaint` rows valid alongside `terrain`, `path`, `obstacle`, and `background`. V2 RPCs accept only `terrain`, `path`, `obstacle`, and `background`.
- V2 uses explicit V2 RPCs so old callers cannot accidentally write V2 payloads with V1 contracts.
- `create_map_project_v2` creates a V2 draft.
- `save_map_draft_v2` validates current revision identity and expected save version.
- `publish_map_revision_v2` freezes the generation revision and creates the next editable V2 draft.
- `create_map_asset_plan_v2` accepts only V2 asset kinds and immutable plan inputs.
- published Plan and Scene payloads remain immutable.
- background and obstacle regeneration create new asset plans on a new generation revision.

Saved-map discovery joins the current revision and returns only maps whose current revision has schema version 2.

Editing Plan name updates the map summary name. Successful draft saves and current revision changes update the map summary timestamp.

## Autosave And Concurrency

Autosave uses a single serialized writer per installed draft:

- changes debounce for 750 ms;
- at most one save request is in flight;
- changes made during an in-flight save set a pending flag;
- after a successful save, pending changes schedule the next save with the new save version;
- replacing the installed map invalidates completion handlers from the old map;
- a server conflict freezes autosave and offers reload or fork;
- local schema or cross-reference failures prevent the request and show field errors.

Every generation operation carries `projectId`, `mapId`, `revisionId`, and `generationId`. A result may update UI state only when all four still match the installed target.

## PixelLab Integration

The browser calls the authenticated `pixellab-map` Supabase Edge Function. It never calls PixelLab directly.

The Edge Function:

1. authenticates the Supabase user;
2. verifies Project editor or admin permission;
3. verifies map, revision, generation, and asset identity;
4. discovers the live PixelLab MCP tools and input schemas;
5. selects the exact semantic terrain, path, or map-object capability;
6. uses an exact documented REST fallback only when the semantic capability permits it;
7. stores actual operation, transport, schema fingerprint, and provider job ID;
8. polls without relying on browser memory;
9. normalizes tile outputs when required;
10. validates PNG structure, dimensions, alpha, visible pixels, and SHA-256;
11. stores verified bytes privately and transitions the same asset row.

Region obstacle generation references the current background asset ID and hash. The Edge Function may create a temporary background crop for provider style reference only when the discovered live schema supports an image reference. Otherwise it uses the approved style prompt and palette. Temporary URLs and crop bytes are not stored in asset metadata.

## UI Design

Create Map remains a quiet, dense operational editor that follows the existing Keco Studio visual system. It is not a landing page and does not introduce a second design system.

### Left Panel

- description and optional source selectors;
- saved V2 maps;
- workflow status;
- Plan resources in Plan Review mode;
- fixed scene concerns and obstacle list in Scene mode.

### Canvas

- stable map aspect and dimensions;
- explicit Plan Review and Scene mode labels;
- pan and zoom;
- plan region/path editing tools before generation;
- select, generate-obstacle region, and collision editing tools after generation;
- transient generation region and collision overlays;
- no layout shift when generation status changes.

### Right Panel

- selected Plan structure inspector in Plan Review mode;
- generation status and confirmation;
- selected obstacle transform and collision inspector in Scene mode;
- region prompt and retry state while generating an obstacle.

Buttons use the existing Ant Design icon family already established in this feature. Loading, empty, partial, blocked, conflict, and error states are explicit. Controls remain usable at supported desktop sizes, while the existing side-panel drawer behavior remains the mobile fallback.

## Error Handling

- Invalid description or Plan: keep the current workspace, show exact issues, and make no paid request.
- Missing Project before generation: keep the local Plan and focus the Project selector.
- Stale optional Document: retain the captured source token and require explicit Plan regeneration to use newer content.
- Missing PixelLab configuration: return `pixellab_not_configured` without provider or credential details.
- Missing capability: mark the affected asset `blocked`; do not substitute a generic image operation.
- Rate limit or transient provider failure: retain provider identity and expose bounded retry.
- Incomplete atlas normalization: mark only that asset `blocked` with `atlas_manifest_incomplete`.
- Structural image failure: mark only that asset failed and do not bind invalid bytes.
- Background composition failure: preserve ready source assets and allow composition-only retry.
- Region obstacle failure: preserve selection and prompt; do not add a partial entity.
- Signed URL failure: preserve durable ready status, show unavailable preview, and allow URL refresh.
- Save conflict: stop autosave and offer reload or fork.
- Stale async completion: discard it without changing the installed workspace.

## Verification Strategy

Development does not use TDD. Verification is still a completion requirement and is added or updated after the implementation behavior exists.

### Unit Verification

- MapPlan V2 schema and semantic validation;
- MapScene V2 schema and cross-reference validation;
- Plan normalization and LLM correction;
- point-in-polygon, path rasterization, and connectivity masks;
- normalized atlas parsing;
- deterministic background pixel composition;
- alpha-bound collision derivation;
- obstacle visual and local collision transforms;
- editor commands, undo, and redo;
- serialized autosave and stale completion invalidation;
- generation target identity and restore behavior.

### Edge And Database Verification

- live-tool discovery mapping with mocked MCP responses;
- exact submit, poll, retry, and normalization behavior;
- PNG and atlas validation;
- private storage upload and byte-for-byte read-back;
- V2 RLS matrix for owner, admin, editor, viewer, outsider, and unauthenticated users;
- immutable generation revisions;
- V2-only saved-map discovery;
- CAS save conflicts and map summary updates.

### Browser Verification

- description-only Plan creation;
- optional Document context;
- Plan region and path editing;
- paid-generation confirmation;
- background completion and locked rendering;
- obstacle transform and collision editing;
- selected-region obstacle generation and retry;
- obstacle visual regeneration with transform/collision preservation;
- save, refresh, and restore;
- stale map-open and stale generation protection;
- desktop and mobile screenshots with overlap and text-fit inspection.

### Real PixelLab Verification

Before declaring completion, run a live capability probe and one minimal terrain, path, and obstacle generation using the configured development account. Confirm the actual MCP schemas, normalized atlas manifest, background output, transparent obstacle output, and absence of credentials or signed URLs in durable metadata.

Verification record on 2026-08-10:

- Live MCP discovery passed for `create_topdown_tileset`, `create_path_tiles`, `create_map_object`, and `inpaint_image`, with sanitized stable schema fingerprints.
- The Create Map Jest gate passed 26 suites and 148 tests; the PixelLab Edge gate passed 42 Deno tests; TypeScript, API TypeScript, ESLint, production build, diff checks, and five Playwright workflows exited successfully.
- Desktop, tablet, mobile, generated Scene, partial failure, and mobile drawer screenshots were inspected for text fit, overlap, framing, and state visibility.
- Live generated-output evidence remains blocked because no authoritative `PIXELLAB_PROBE_REVISION_ID` was configured for a Keco V2 generation. This verification run did not select an arbitrary revision through the service role and did not bypass Keco provenance by generating directly against PixelLab.

## Acceptance Criteria

1. An authenticated user can generate a valid MapPlan V2 from only a free-form description.
2. A Document can add context but is not required.
3. A Project is required only when persisting or generating assets.
4. Plan Review represents base terrain, polygon regions, roads, rivers, and planned obstacles.
5. The user can edit structural Plan geometry without editing individual tiles.
6. Paid generation requires a valid saved Plan and explicit confirmation.
7. PixelLab resource generation remains server-owned and capability-discovered.
8. Terrain and path outputs are normalized into complete provider-independent atlas manifests.
9. The compositor uses connectivity masks rather than repeating one atlas tile.
10. The complete background is one verified, private, locked PNG.
11. Every obstacle entity binds one visual resource to one local collision shape.
12. Moving, scaling, or rotating an obstacle transforms visual and collision together.
13. Rectangle, circle, and polygon collision geometry can be edited.
14. Selecting a region can generate, validate, place, and select a transparent obstacle.
15. Region-generation failure preserves the prompt and selection for retry.
16. Regenerating one obstacle preserves its transform and collision geometry.
17. Regenerating the background preserves obstacle entities.
18. Save and refresh restore background, obstacle entities, layers, and generation state.
19. Partial generation failure preserves successful siblings.
20. A stale revision, generation, poll, open, or signed-image completion cannot replace current state.
21. Schema version 1 maps are neither listed nor opened in Create Map V2.
22. Automated verification, browser screenshots, and live PixelLab smoke verification complete successfully before delivery.

## Delivery Sequence

The implementation plan must preserve this dependency order:

1. V2 schemas and persistence contracts;
2. planner and Plan Review editing;
3. normalized PixelLab terrain/path/obstacle resources;
4. deterministic background compositor;
5. Scene V2 obstacle editing;
6. selected-region obstacle generation;
7. autosave, restore, concurrency hardening, and complete verification.

Each stage must leave the application buildable and must not claim later-stage behavior before that stage exists.
