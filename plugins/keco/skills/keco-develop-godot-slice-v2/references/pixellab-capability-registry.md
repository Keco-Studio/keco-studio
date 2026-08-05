# PixelLab Official Capability Registry

The official endpoint is the provider capability identity. An MCP tool is only a transport adapter. At `PREFLIGHT`, compare the live MCP schema to this registry and record `compatibility: exact|fallback|unavailable` for every planned asset. Never infer that an official endpoint is callable merely because it exists.

| Capability key | Asset kind | Official endpoint | PixelLab MCP 1.1.0 adapter | Current relation |
|---|---|---|---|---|
| `s-xl-image-pro` | `image`, `effect` | `POST /v2/generate-image-v2` | none | `unavailable` |
| `style-pro` | `image`, `ui`, `effect` | `POST /v2/generate-with-style-v2` | `generate_image_bitforge` | `fallback` |
| `ui-elements-pro` | `ui` | `POST /v2/generate-ui-v2` | none | `unavailable` |
| `pixflux` | `image`, `effect` | `POST /v2/create-image-pixflux` | `generate_image_pixflux` | `exact` |
| `bitforge` | `image`, `effect` | `POST /v2/create-image-bitforge` | `generate_image_bitforge` | `exact` |
| `character-pro` | `character` | `POST /v2/create-character-pro` | none | `unavailable` |
| `eight-rotations-pro` | `character-rotation` | `POST /v2/generate-8-rotations-v2` | `rotate` | `fallback` |
| `animate-text-pro` | `animation` | `POST /v2/animate-with-text-v2` | `animate_with_text` | `exact` |
| `animate-skeleton` | `animation` | `POST /v2/animate-with-skeleton` | `animate_with_skeleton` | `exact` |
| `inpaint-pro` | `edit` | `POST /v2/inpaint-v3` | `inpaint` | `exact` |
| `edit-images-pro` | `edit` | `POST /v2/edit-images-v2` | none | `unavailable` |
| `tiles-pro` | `tile` | `POST /v2/create-tiles-pro` | none | `unavailable` |
| `top-down-tileset` | `tileset` | `POST /v2/create-tileset` | none | `unavailable` |
| `isometric-tile` | `tile` | `POST /v2/create-isometric-tile` | none | `unavailable` |
| `sidescroller-tileset` | `tileset` | `POST /v2/create-tileset-sidescroller` | none | `unavailable` |

`estimate_skeleton` and `get_balance` are transport helpers, not substitutes for provider capabilities. The live MCP may expose newer exact adapters later; update `transportTool` and the observed schema in the run ledger instead of rewriting provider capability IDs.

## Selection rules

1. Select `providerCapability` from `assetKind` and acceptance requirements before inspecting transport availability.
2. Use `exact` directly after schema validation.
3. For `fallback`, compare output count, reference handling, resolution, animation/rotation semantics, and quality. If these differences affect acceptance, enter `awaiting_user_confirmation`; otherwise record the accepted difference.
4. For `unavailable`, set the asset task to `blocked_before_write`. Do not silently substitute Pixflux, Bitforge, repeated `rotate`, or direct REST calls.
