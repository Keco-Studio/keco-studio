# PixelLab Official Capability Registry

This file is the single source of truth for PixelLab capabilities and the `assetKind`
vocabulary across every skill in this plugin. `keco-develop-godot-slice-v2`, its
phase modules, and `pixellab-map-assets` all resolve operations here;
no skill defines its own competing tool list.

The official endpoint is the provider capability identity. An MCP tool is only a transport adapter. At `PREFLIGHT`, compare the live MCP schema to this registry and record `compatibility: exact|fallback|unavailable` for every planned asset. Never infer that an official endpoint is callable merely because it exists.

## Canonical `assetKind` values

```text
animation, character, character-rotation, cutout, edit,
effect, image, texture, tile, tileset, ui
```

`scripts/validate_generated_asset_package.py` enforces exactly this set. Use `character-rotation` (not `rotation`) for multi-direction character exports.

## Capability table

| Capability key | Asset kind | Official endpoint | PixelLab MCP 1.1.0 adapter | Current relation |
|---|---|---|---|---|
| `s-xl-image-pro` | `image`, `effect` | `POST /v2/generate-image-v2` | none | `unavailable` |
| `style-pro` | `image`, `ui`, `effect` | `POST /v2/generate-with-style-v2` | `generate_image_bitforge` | `fallback` |
| `ui-elements-pro` | `ui` | `POST /v2/generate-ui-v2` | none | `unavailable` |
| `pixflux` | `image`, `effect` | `POST /v2/create-image-pixflux` | `generate_image_pixflux` | `exact` |
| `bitforge` | `image`, `effect` | `POST /v2/create-image-bitforge` | `generate_image_bitforge` | `exact` |
| `character-pro` | `character` | `POST /v2/create-character-pro` | `create_character` (`mode: pro`) + `get_character` | `exact` |
| `eight-rotations-pro` | `character-rotation` | `POST /v2/generate-8-rotations-v2` | `rotate` | `fallback` |
| `animate-character-v3` | `animation` | `POST /v2/animate-with-text-v2` | `animate_character` (`mode: v3`) + `get_character` | `exact` |
| `animate-skeleton` | `animation` | `POST /v2/animate-with-skeleton` | `animate_with_skeleton` | `exact` |
| `inpaint-pro` | `edit` | `POST /v2/inpaint-v3` | `inpaint` | `exact` |
| `edit-images-pro` | `edit` | `POST /v2/edit-images-v2` | none | `unavailable` |
| `tiles-pro` | `tile` | `POST /v2/create-tiles-pro` | none | `unavailable` |
| `top-down-tileset` | `tileset` | `POST /v2/create-tileset` | none | `unavailable` |
| `isometric-tile` | `tile` | `POST /v2/create-isometric-tile` | none | `unavailable` |
| `sidescroller-tileset` | `tileset` | `POST /v2/create-tileset-sidescroller` | none | `unavailable` |

`estimate_skeleton` and `get_balance` are transport helpers, not substitutes for provider capabilities. The live MCP may expose newer exact adapters later; update `transportTool` and the observed schema in the run ledger instead of rewriting provider capability IDs.

## Map-workflow capability aliases

`pixellab-map-assets` plans against map-shaped needs. Those needs map onto this registry as follows; the third column is what the live MCP actually exposes today.

| Map need | Capability key | Adapter today |
|---|---|---|
| seamless top-down terrain | `top-down-tileset` | none (`unavailable`) |
| roads, rivers, or paths | `tiles-pro` | none (`unavailable`) |
| floors, walls, doors, columns | `tiles-pro` | none (`unavailable`) |
| one world prop or building | `pixflux` or `bitforge` | `generate_image_pixflux` / `generate_image_bitforge` (`exact`) |

Names such as `create_topdown_tileset`, `create_path_tiles`, `create_building_kit`, and `create_map_object` are **not** live MCP tool names and must never be called by memory. Resolve the adapter from the live tool list and record the observed name in the asset manifest.

## Selection rules

1. Select `providerCapability` from `assetKind` and acceptance requirements before inspecting transport availability.
2. Use `exact` directly after schema validation.
3. For `fallback`, compare output count, reference handling, resolution, animation/rotation semantics, and quality. If these differences affect acceptance, enter `awaiting_user_confirmation`; otherwise record the accepted difference.
4. For `unavailable`, set the asset task to `blocked_before_write`. Do not silently substitute Pixflux, Bitforge, repeated `rotate`, or direct REST calls.

## No hard-coded operation names

No skill may require one fixed PixelLab tool name as a precondition. Requiring a capability that this table records as `unavailable` makes that path permanently unreachable. Always resolve the live adapter, record `compatibility`, and apply rule 4 when nothing exact or acceptable exists.
