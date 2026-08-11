---
name: pixellab-map-assets
description: Use when a user asks to create or integrate top-down map-art resources for Godot, such as terrain tilesets, roads or paths, building kits, or map props, including style-matched extensions to an existing map. Not for complete playable maps, gameplay logic, collision-only work, characters, portraits, UI assets, scene backgrounds, or broader Keco-driven Godot slices.
---

# PixelLab Map Assets

Use PixelLab as an art-resource generator, Keco as the provenance authority when the request is Keco-driven, and Godot as the authority for layout, collision, walkability, and gameplay logic.

## Scope And Routing

Use this skill for standalone map-art work or for a Godot slice that specifically needs map resources. Route a Keco-driven gameplay slice through `keco-develop-godot-slice-v2` when the request also requires Keco planning, snapshot export, or runtime evaluation. Resolve the live PixelLab capability from the available MCP tools instead of assuming that a single full-map operation exists.

When the request contains development intent (implement, continue, integrate, edit, or evaluate a Godot scene/game/map), or any of the game-art terms in the trigger description, treat it as Keco-first even if the user never mentions PixelLab. Discover the Keco project and compatible asset registry, write a `planned` row, and read it back before calling PixelLab. Use the standalone path without a Keco pre-write only for clearly exploratory non-game art requests that do not ask to integrate the result into development.

PixelLab produces resources, not these gameplay systems:

- complete map layout or room topology;
- obstacle collision shapes;
- player walkable area or navigation meshes;
- pathfinding, triggers, spawn logic, or map state.

## Intent Confidence

Decide whether the user is asking for this resource-based workflow before generating anything:

- **High confidence:** the user asks for tiles, terrain, roads, buildings, props, PixelLab assets, or Godot TileMap resources. Invoke the skill and begin read-only preflight.
- **Medium confidence:** the user asks to make a village/world/map but does not specify whether they need art, layout, or gameplay logic. Invoke the skill for a short preflight, then ask: “Should PixelLab generate tilesets, paths, and map objects while Godot assembles the map and configures collision? Does this workflow match your requirements?” Do not generate until the user confirms.
- **Low confidence:** the request may be unrelated to map art or could mean a complete playable map. Ask the same focused workflow question before invoking generation.

User confirmation is not needed for harmless inspection of the project or the live MCP schema. It is needed before a paid or persistent PixelLab generation when the intended output remains ambiguous.

## Required Workflow

Track this checklist in the response or working notes:

```text
- [ ] inspect the live PixelLab MCP tools and input schemas
- [ ] classify the request as development or standalone art
- [ ] inspect the Godot project style, tile size, and target paths
- [ ] write an asset manifest before generation
- [ ] for development intent, write and read back the Keco `planned` asset row
- [ ] generate only the planned resources
- [ ] validate every returned file locally
- [ ] for development intent, upload to Keco and read back the `ready` row before export
- [ ] materialize Godot files from the authoritative Keco image bytes
- [ ] import resources into Godot and configure TileSet/TileMap rules
- [ ] define collision and walkability in Godot
- [ ] report generated files, target paths, and remaining manual work
```

### 1. Preflight the live tools

List the currently exposed PixelLab MCP tools and inspect the exact schema before making a call. Match by semantic capability, not by memory. The expected adapters are:

| Asset need | Preferred operation | Output expectation |
|---|---|---|
| seamless top-down terrain | `create_topdown_tileset` | PNG tile set plus Wang/corner autotiling metadata |
| one world prop or building | `create_map_object` | transparent-background PNG object |
| roads, rivers, or paths | `create_path_tiles` | directional edge/path tiles and edge rules |
| floors, walls, doors, columns | `create_building_kit` | compatible building tiles/parts |

If a preferred operation is absent, do not silently substitute a generic image generator. Report the missing capability and ask whether the user accepts a different operation. Record the actual tool name and schema fields in the asset manifest. Never send secrets in prompts or tool arguments.

### 2. Inspect the target project

Before generating, inspect the existing Godot project and answer:

- Godot version and whether it uses `TileMap` or `TileMapLayer`;
- tile size, texture filtering, import scale, and pixel-art nearest filtering;
- existing palette/style references (for example `spring_village_v2.png`);
- target `res://` paths and whether an atlas/scene already exists;
- whether the resource is for a new tilemap or an extension of an existing one.

For an existing style, pass the original image as a declared reference only when the live PixelLab schema supports reference images. Do not crop a full map into a tileset without checking tile boundaries and repetition seams.

### 3. Create an asset manifest

Create one planned entry per requested resource before invoking PixelLab:

```yaml
assetKey: village-ground
kind: tileset
operation: create_topdown_tileset
prompt: "Top-down pixel-art spring village grass, dirt, and water transitions..."
referencePaths: ["res://art/spring_village_v2.png"]
tileSize: 16
targetPaths: ["res://art/tiles/village-ground/..."]
transparency: false
collisionOwner: godot
status: planned
```

Also record the requested palette, camera projection, tile size, expected file count, transparency, and the Godot node/TileSet that will consume each output. Keep the prompt free of dynamic UI text; render labels in Godot.

### Keco registry discovery (required for development intent)

For development intent, read the current Keco project structure before generation and inspect table names, descriptions, semantic fields, stable match fields, and representative rows. Select the table whose schema is compatible with asset provenance; do not require a particular display name. Common examples are `Media Assets`, `UI Assets`, `Generated Assets`, and `Assets`, but a project-specific name is equally valid. Reuse that table and extend it only with compatible fields for generator, operation, prompt, references, target path, dimensions, output hash, verified image object, and status. If two tables are equally compatible, ask the user which registry is authoritative and perform no writes until answered. Create a new table only when discovery proves that no compatible registry exists, using the project's naming conventions.

Create or update the `planned` row with the stable asset key, asset type/kind, purpose, target Godot path, width, height, transparency, generator/operation, exact prompt, reference paths and hashes, `runId`, `sliceId`, and `status: planned` before calling PixelLab. Use the active Keco/Godot development run and slice IDs; if the caller has not supplied them, establish them in the development plan before the write. Resolve these semantic roles to the selected table's actual field labels and IDs; use the returned `projectId`, `tableId`, `fieldId`, and `rowId`, never fixed labels or guessed IDs. Paginate-read the selected table and confirm the row binding and unchanged project identity. After generation and local validation, call `create_image_upload`, upload the bytes with the signed PUT target, call `complete_image_upload`, update the same row with the complete verified Keco image object and `status: ready`, and paginate-read until the exact object and metadata match. Never create a second row just because the provider returned multiple files.

For standalone art exploration, Keco persistence is optional unless the user asks to retain or integrate the result. If the request becomes a development request later, restart at registry discovery and create the planned row before any new generation.

### 4. Generate and validate

For development intent, call PixelLab only after the Keco `planned` row read-back succeeds. For standalone art exploration, save results to a temporary or explicitly planned local directory. In both cases, validate each file before integrating it:

- file is a readable PNG (or the format declared by the live schema);
- dimensions and tile grid match the manifest;
- alpha matches the request and transparent objects have no matte halo;
- file is non-empty, contains visible pixels, and is within the project size limit;
- tiles repeat cleanly and edge/corner metadata is present when promised;
- no accidental text, UI labels, or unrelated objects appear;
- style and palette are consistent with the supplied reference.

On a failed visual or structural check, regenerate only the failed asset, preserve the original reference, and change the prompt/property responsible for the failure. Do not integrate an unvalidated response merely because the MCP call succeeded.

### 5. Integrate in Godot

For development intent, download the authoritative image bytes from the verified Keco `ready` row, verify the output hash, and atomically materialize the declared `res://` target before opening or editing Godot. Never copy the temporary PixelLab result directly into Godot. Then use the project’s existing scene and import conventions. For a tileset:

1. Import the PNG atlas with nearest filtering and no unintended mipmaps.
2. Create or extend a `TileSet` atlas source at the declared tile size.
3. Configure terrain sets and Wang/corner peering rules from the PixelLab metadata.
4. Add the atlas to the project’s `TileMap`/`TileMapLayer`; paint the map layout in Godot.
5. Add TileSet physics layers and per-tile collision polygons only for solid terrain.

For path tiles, map the four directional edges to terrain peering rules and test straight, corner, T-junction, and end-cap cases. For a building kit, assemble floors/walls/doors as atlas tiles or reusable scenes and keep collision on the wall/column tiles. For a map object, place the transparent PNG as a `Sprite2D` or scene and add a `StaticBody2D`/`Area2D` shape in Godot as required. Run the Godot project after integration and collect the project's available runtime/debug evidence for rendering, placement, collision, and walkability.

If this project currently renders a single background texture (such as `spring_village_v2.png`), do not claim that adding a tileset automatically replaces it. Either keep the background and add the generated resources as a separate map layer, or explicitly migrate the scene to a TileMap and recreate its layout.

### 6. Define gameplay geometry manually

Keep collision and walkability in Godot-owned files. Use the project’s established representation, such as `RECT_OBSTACLES` and `CIRCLE_OBSTACLES` in `village.gd`, TileSet physics polygons, or navigation regions. Derive shapes from the visible footprint of each object, not from the transparent PNG bounds. Test player movement around corners and narrow passages after placement.

## Output Contract

Finish with a concise report containing:

- for development intent, the discovered Keco registry table ID, planned row key, read-back result, and final `ready` binding;
- each PixelLab operation actually called and its generated files;
- validation results and any regenerated assets;
- Godot target paths, TileSet/TileMap nodes, and import settings;
- collision/walkability changes made in Godot;
- unresolved blockers, including unavailable operations or missing MCP configuration.

Never report a complete map, collision, or playable navigation system unless Godot evidence shows that those parts were explicitly created and tested.

For detailed operation fields and a reusable manifest template, read [pixellab-operations.md](references/pixellab-operations.md). For Godot atlas, terrain, and collision patterns, read [godot-integration.md](references/godot-integration.md).
