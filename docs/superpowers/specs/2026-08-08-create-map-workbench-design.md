# Create Map Workbench Design

**Date:** 2026-08-08
**Status:** Ready for written review
**Wireframe:** `docs/superpowers/mockups/create-map-wireframe.html` and `docs/superpowers/mockups/create-map-wireframe.png`

## Objective

Add a first-class Create Map workspace to Keco Studio. A user enters from the fourth button in the global left navigation, selects a Keco project and one of its Documents, reviews an editable structured plan derived from that Document, then generates and edits a complete top-down map asset set:

- a composed background;
- Wang terrain tilesets;
- roads and path terrain;
- transparent movable objects;
- editable rectangle, circle, and polygon obstacles;
- mask-based Inpaint for local visual revisions.

The first release is a Keco editing and persistence workflow. It does not export a Godot project or claim to create gameplay navigation. Keco stores layout and obstacle geometry so a later Godot workflow can consume them.

## Product Decisions

- Replace the disabled fourth `IconAlign` slot in `LeftNav` with the Create Map entry.
- Use the global route `/create-map`; project and Document selection happen inside the workspace.
- Hide the normal Studio project-tree Sidebar and global Agent Chat on this route. Keep the global LeftNav and TopBar.
- Use the approved three-column, canvas-first layout rather than a step-by-step modal.
- Treat `battle-poc` only as a reference for separating visual, collision, and entity state. Do not copy its single-image generation or fixed 16 by 16 collision grid.
- Generate the complete first-release asset set. Tilesets, roads, and movable objects are not deferred.
- Use one server-owned PixelLab account. The token is never accepted from or returned to the browser.

## Experience

### Entry And Source Selection

The fourth LeftNav button uses a map icon, label `Create Map`, active styling, `aria-current="page"`, and navigation to `/create-map`. Create Map is a global workspace, so users do not have to navigate into a project first.

On entry, the left panel presents two dependent selectors:

1. **Project** lists projects readable by the signed-in user.
2. **Document** lists Documents in the selected project and excludes document content from the list query.

After selection, Keco reads the complete Document, captures its current source token, and offers `Create Map Plan`. Changing either selector while there are unsaved map edits requires confirmation.

The source token binds the map plan to the exact source used for interpretation:

- `documentId`;
- `documentUpdatedAt`;
- collaboration `epoch` and `revision`.

The first release always reads the current Document state. Choosing an older saved Document version is outside this release.

A later Document update does not silently mutate an existing map. The UI shows that the source is newer and offers `Create new plan revision`.

### Workspace Layout

The workbench fills the area below TopBar.

**Left panel, 260 px target width**

- Project and Document selectors;
- stages: Source, Plan, Terrain, Objects, Obstacles, Review;
- Layers and Objects tabs;
- visibility controls and per-resource generation status;
- retry action on a failed resource only.

**Center canvas, flexible width**

- composed map preview;
- stable 16:10 editing surface with pan and zoom;
- selection, hand, rectangle obstacle, circle obstacle, polygon obstacle, and mask-brush tools;
- snap-to-grid toggle and zoom controls;
- overlays for object bounds, ground anchors, obstacle shapes, and Inpaint mask;
- status strip for coordinates, zoom, grid size, and save state.

The canvas renders terrain and roads from tile metadata, then transparent object instances, then optional editing overlays. It does not flatten editable layers until an exported preview is requested.

**Right panel, 320 px target width**

- MapPlan summary and editable generation properties;
- selected layer or object inspector;
- obstacle geometry inspector;
- Inpaint prompt, brush size, mask preview, generate, and rollback controls;
- revision and generation history.

The layout follows the approved wireframe. At narrower desktop widths the side panels contract; below the supported editing width, panels become drawers while the canvas remains the primary surface. Text must wrap within controls and no toolbar item may resize the canvas when its state changes.

### Plan Review

Document interpretation produces an editable `MapPlan`, not a provider prompt string. Before paid generation, the user can review and change:

- map name and short visual brief;
- projection, pixel-art style, palette, tile size, map width, and map height;
- terrain types and transition pairs;
- roads and paths with endpoints, width, and terrain relationship;
- object definitions, quantities, suggested placements, anchors, and movability;
- suggested obstacles and their geometry;
- one prompt per generated resource.

The plan validator blocks generation when dimensions are unsupported, stable resource keys collide, a road references a missing terrain, an object is outside the map, or obstacle geometry is invalid. The raw Document remains read-only inside this workspace.

## Architecture

### Ownership Boundaries

```text
Document
  -> Keco MapPlan interpretation and validation
  -> Keco generation manifest and planned asset records
  -> PixelLab terrain tiles / map objects / Inpaint images
  -> Keco deterministic tile composition and object placement
  -> Keco obstacle geometry and revision history
```

**Keco owns:** source binding, MapPlan, generation manifest, asset provenance, map composition, tile and object placement, layer ordering, obstacle geometry, revisions, permissions, uploads, and read-back verification.

**PixelLab owns:** generated image resources. The backend resolves the live MCP schema at runtime and uses the actual operation names exposed by PixelLab. Expected capabilities are top-down Wang tilesets, map objects, and Inpaint. Roads are represented as terrain/path transitions because PixelLab does not expose gameplay road topology. PixelLab does not own collision, walkability, navigation, or complete room layout.

**Supabase owns:** authenticated persistence, RLS, generated asset storage, optimistic concurrency, and the server-only PixelLab secret.

### Frontend Modules

Create a focused feature directory under `src/features/create-map/`:

- `CreateMapWorkbench` coordinates source, revision, selection, and save state.
- `MapSourcePanel` loads project and Document summaries.
- `MapStages` and `MapLayerList` expose workflow and resource states.
- `MapCanvas` renders the editable scene and converts pointer coordinates to map coordinates.
- canvas tool modules implement selection, transforms, geometry, and mask painting independently.
- `MapPlanInspector`, `MapObjectInspector`, `ObstacleInspector`, and `InpaintInspector` edit one concern each.
- `mapPlanSchema` defines runtime validation and TypeScript types.
- `mapSceneReducer` applies deterministic editing commands and provides undo/redo boundaries.
- `createMapService` is the only browser-side persistence and generation client.

Use existing React, Next App Router, Supabase, React Query, CSS modules, and icon conventions. Do not add a general diagramming framework for the first release. The map editor can use DOM/canvas primitives behind `MapCanvas`; its public model must remain independent of the rendering implementation.

### Server Integration

All PixelLab calls go through a Supabase Edge Function named `pixellab-map`. The browser sends an authenticated operation request containing Keco IDs and validated generation input, never a PixelLab credential.

The Edge Function:

1. verifies the Supabase user and project write permission;
2. verifies that the requested revision and planned asset belong to that project;
3. reads `PIXELLAB_API_TOKEN` from the function environment;
4. resolves and invokes the official PixelLab hosted MCP capability when it supports the operation;
5. uses the documented PixelLab REST endpoint only for an exact required capability that the hosted MCP does not expose;
6. records the actual transport, provider operation, provider job ID, and sanitized request metadata;
7. polls or resumes an asynchronous provider job without holding browser state as authority;
8. validates the returned PNG dimensions, alpha expectations, and non-empty visible pixels;
9. uploads verified bytes to a private Supabase Storage bucket;
10. marks the same asset row `ready` and returns Keco identifiers plus a signed preview URL.

The local application reads the token from `.env.local` only when running a local server adapter or local function process. Production reads the same variable name from a Supabase Edge Function secret. `.env.example` documents only `PIXELLAB_API_TOKEN=`. No actual value is committed, logged, placed in prompts, provider metadata, client bundles, or database rows.

The backend must inspect the live PixelLab MCP tool list and schemas before implementing provider mappings. It must not invent operation names from documentation. The current expected official REST capabilities are `/create-tileset`, `/map-objects`, and `/inpaint-v3`; these names are planning references, not permission to skip live schema discovery.

### Data Model

Use dedicated relational rows for identity, concurrency, and resource state, with versioned JSON for the evolving editor payload.

**`map_projects`**

- `id`, `project_id`, `name`, `source_document_id`;
- `current_revision_id`;
- `created_by`, `created_at`, `updated_at`.

Each row is a user-visible map and remains associated with one Keco project. A source Document may produce multiple maps.

**`map_revisions`**

- `id`, `map_project_id`, monotonic `revision`;
- `parent_revision_id`;
- source token fields;
- `schema_version`;
- `plan` JSONB and `scene` JSONB;
- `status`: `draft`, `generating`, `partial`, `ready`, or `failed`;
- `created_by`, `created_at`.

Revisions are immutable after publication. Autosave edits update the active `draft` using an expected revision token. Starting generation publishes that draft and creates the next draft from it. A provider completion attaches asset state to the published revision; it never rewrites an earlier scene snapshot.

**`map_assets`**

- `id`, `map_revision_id`, stable `asset_key`, `kind`;
- `status`: `planned`, `queued`, `generating`, `ready`, `failed`, or `blocked`;
- requested provider capability and actual provider operation/transport;
- exact sanitized prompt and generation parameters;
- reference asset IDs and hashes;
- provider job ID, attempt count, and last error code;
- storage path, SHA-256, dimensions, transparency, and metadata JSONB;
- created and updated timestamps.

There is one row per planned resource. Retrying updates the attempt on that row rather than creating duplicate logical resources. Provider outputs are never authoritative until local validation, upload, and database read-back succeed.

The private storage layout is `map-assets/{projectId}/{mapId}/{revisionId}/{assetKey}/{sha256}.png`. Signed preview URLs are transient and are not stored in revisions.

### Core Types

`MapPlan` contains map settings, terrain resources, road/path resources, object definitions, suggested instances, and suggested obstacles. Every resource has a stable `assetKey` and provider-independent intent.

`MapScene` contains ordered layers, tile placements, object instances, obstacle instances, and canvas settings. Object instances reference an asset key and store position, scale, rotation, z-order, ground anchor, and `movable` state. Obstacles use map-space coordinates:

- rectangle: `x`, `y`, `width`, `height`;
- circle: `cx`, `cy`, `radius`;
- polygon: at least three ordered points.

`InpaintRequest` references a ready raster asset, its SHA-256, a same-size black-and-white mask, prompt, and new asset key. White mask pixels are generated and black pixels are preserved. Inpaint always creates a derived asset; it never overwrites the source bytes.

## Generation Workflow

1. Read the selected Document and bind its source token.
2. Interpret it into a validated MapPlan and save a draft revision.
3. Let the user edit and approve the plan.
4. Publish the generation revision and create `planned` map asset rows.
5. Generate the terrain vertex layout from the plan.
6. Request the PixelLab Wang tileset and retain its tile metadata, including `pattern_4x4` where provided.
7. Compose terrain and road/path layers deterministically from the approved layout and tileset metadata.
8. Request transparent PixelLab map objects using the approved style/reference context.
9. Place movable object instances from MapPlan suggestions; keep placement editable.
10. Add Keco-owned obstacle geometry and let users move, resize, add, or remove shapes.
11. Save the completed scene as a new immutable revision.
12. Use Inpaint only as a targeted derived-asset revision after the base resource is ready.

Generation runs per asset rather than as one opaque `create map` call. This exposes progress, preserves successful work, and permits precise retries.

## Editing And Revision Semantics

- Canvas edits are commands with local undo and redo while the draft remains open.
- Autosave debounces edits and sends the expected draft revision token.
- A save conflict means another tab or collaborator advanced the draft. Keco stops autosave, fetches the current revision, and offers `Reload current` or `Save as new revision`; it never silently applies last-write-wins.
- A generation starts from a frozen revision. Later plan edits do not alter an in-flight provider request.
- Successful assets remain ready when a sibling asset fails. The revision becomes `partial` and the failed layer shows `Retry`.
- Retrying uses the same asset key, plan intent, and source references, increments the attempt count, and changes only the failed resource.
- Cancel stops queued work and asks the provider to cancel when supported. Completed assets remain available; no generated bytes are deleted automatically.

### Inpaint

The user selects a ready raster layer or object, enters mask mode, paints the exact region, adds a prompt, and requests Inpaint. The client produces a same-dimension binary PNG mask and previews white/generate versus black/preserve regions before submission.

Inpaint creates a derived asset and a new map revision. `Apply` replaces the selected instance's asset reference in the new draft. `Rollback` restores the prior reference by creating another revision pointer change; it does not delete either asset. A failed Inpaint request leaves the current map and source asset unchanged. Users can retry only that request.

## Error Handling

- Missing or unreadable source: show an inline source error and keep selectors usable.
- Stale source Document: show a non-blocking banner and require an explicit new plan revision to incorporate it.
- Invalid MapPlan: mark exact fields and block paid generation.
- Missing PixelLab configuration: return a server configuration error without revealing secret details.
- Unsupported MCP capability: record `blocked`, name the missing capability, and do not substitute a generic image operation silently.
- Provider rate limit or transient failure: retain the job and asset row, show a retryable state, and use bounded server backoff.
- Structural image failure: mark only that asset failed and preserve the invalid provider output outside the authoritative storage binding for diagnosis.
- Auth or project permission failure: return 401/403 and never call PixelLab.
- Storage or read-back failure: keep the asset non-ready even when PixelLab succeeded; retry persistence without paying for regeneration when provider bytes are recoverable.
- Browser refresh: rebuild progress from database rows and provider job IDs rather than restarting generation.

Provider errors shown to users are stable Keco codes with short messages. Raw provider responses, signed URLs, and authentication headers are excluded from client logs and persisted error text.

## Permissions And Security

- Any accepted project collaborator may read maps that belong to the project.
- Only owner, admin, and editor roles may create plans, edit scenes, generate assets, or Inpaint.
- RLS enforces project access for all map tables and storage objects.
- Edge Function authorization is repeated server-side before every paid operation.
- Prompts and Document content are sent to PixelLab only in the minimum resource-specific form needed for generation.
- The PixelLab token is a server secret. The already shared development token must be rotated before production use because it has appeared in conversation history.

## Testing Strategy

### Unit Tests

- MapPlan schema accepts valid complete plans and rejects bad dimensions, duplicate keys, missing terrain references, off-map objects, and invalid polygons.
- scene reducer covers select, move, resize, reorder, add/delete obstacle, undo, and redo.
- coordinate conversion covers zoom, pan, snapping, and high-DPI canvas dimensions.
- mask encoding produces a same-size binary image with correct white/black semantics.
- revision helpers preserve immutability and generate conflict-safe payloads.
- PixelLab adapter mapping uses discovered capability metadata and sanitizes secrets and errors.
- returned PNG validation checks dimensions, alpha, visible pixels, and SHA-256.

### Service And Database Tests

- RLS matrix covers owner, editor, viewer, outsider, and unauthenticated users.
- optimistic save RPC returns a conflict when the expected revision is stale.
- publishing a draft freezes plan and scene data.
- partial success preserves ready assets and retries only failed rows.
- Inpaint creates a derived asset and rollback changes only the map reference.
- Edge Function refuses missing authentication, cross-project IDs, unsupported operations, and absent configuration before any provider request.
- provider, storage, and read-back failures produce distinct recoverable states.

PixelLab calls use a contract fixture in automated tests. A manually invoked integration probe can inspect the live MCP schema and perform one controlled generation, but paid generation is not part of the default test suite.

### Browser Tests

- the fourth LeftNav button opens `/create-map` and receives active semantics;
- Studio Sidebar and Agent Chat are hidden while TopBar and LeftNav remain;
- Project selection scopes Document options and a Document creates a reviewable plan;
- the canvas edits movable objects and all three obstacle types;
- a multi-asset generation shows independent progress and targeted retry;
- Inpaint mask preview, apply, failure preservation, and rollback work;
- refresh restores revision and job status;
- desktop and narrow layouts have no overlapping controls or clipped labels.

Before release, capture Playwright screenshots at 1440 by 900 and a narrow supported viewport, and inspect the canvas pixels to ensure the map preview is nonblank and correctly framed.

## Delivery Scope

The first release is complete when a signed-in editor can select a Project and Document, review a structured MapPlan, generate and persist terrain/roads/objects through the server-owned PixelLab integration, compose the result, edit object and obstacle placement, perform and roll back targeted Inpaint, recover partial failures, and reopen the saved map from Keco.

Explicitly out of scope:

- Godot export or direct `res://` materialization;
- gameplay pathfinding, navigation meshes, triggers, spawns, or collision runtime validation;
- arbitrary freeform vector drawing;
- real-time collaborative cursor presence inside the map canvas;
- user-supplied PixelLab API keys or per-user PixelLab accounts.

## Implementation Sequence

1. Route and shell isolation, then the approved static workbench structure.
2. MapPlan and MapScene types, validation, reducer, and local canvas editing.
3. Supabase map schema, storage policy, RLS, revisions, and optimistic save.
4. Project/Document source loading and MapPlan interpretation.
5. PixelLab server adapter, live capability preflight, asset jobs, validation, and upload.
6. deterministic terrain/road composition and movable object placement.
7. obstacle editor and persistence.
8. Inpaint masks, derived assets, apply, and rollback.
9. recovery states, accessibility, responsive polish, integration tests, and screenshots.
