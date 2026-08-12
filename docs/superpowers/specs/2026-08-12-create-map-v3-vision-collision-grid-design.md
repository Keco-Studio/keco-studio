# Create Map V3 Vision Collision Grid Design

## Goal

After PixelLab returns a ready direct-map PNG, analyze that exact image with the Agent provider's multimodal model and attach an editable 8x8-pixel collision grid to the V3 Scene.

## Ownership

- PixelLab owns only the baked map image.
- The multimodal model proposes walkability for each grid cell.
- Keco owns validation, persistence, editing, revision history, and export of the collision grid.
- The user is the final authority and can repaint any analyzed cell.

The collision grid never changes the PNG and is never sent back to PixelLab.

## Grid Contract

All supported direct-map dimensions are divisible by eight:

- 512x512 becomes 64 columns by 64 rows.
- 688x384 becomes 86 columns by 48 rows.
- 384x688 becomes 48 columns by 86 rows.

The durable Scene value is nullable and versioned:

```ts
type DirectMapCollisionGrid = {
  version: 1;
  cellSize: 8;
  columns: number;
  rows: number;
  cells: Array<0 | 1>; // row-major: walkable or blocked
  imageSha256: string;
};
```

`cells.length` must equal `columns * rows`. Dimensions must exactly match the map image. `imageSha256` must match the ready bound asset. A new image with a different hash clears the prior grid before analysis.

Legacy V3 Scenes without `collisionGrid` remain readable and normalize to `null`.

## Analysis Flow

1. A ready map image is materialized into the current draft Scene.
2. The browser detects a bound image without a matching collision grid and makes one analysis request for that image hash.
3. The authenticated API verifies Project writer access, current draft identity, the locked image binding, and the ready asset.
4. The server downloads the private PNG with the service-role client, verifies byte size and SHA-256, and sends it as an in-memory data URL to the configured multimodal endpoint.
5. The model calls a strict tool with one string per grid row. Each row contains exactly the expected number of `0`, `1`, or `2` characters.
6. The server validates and expands the rows to the durable numeric array.
7. The browser installs the grid into the Scene. Existing draft autosave persists it with normal optimistic concurrency.

The model classifies buildings, walls, cliffs, dense tree trunks/canopies, deep water, rocks, and sealed boundaries as blocked. Roads, bridges, doors, clear ground, and intentional entrances remain walkable. For ambiguous shadows, shoreline edges, or partially occluded cells, it compares walkable and blocked confidence and returns the higher-confidence class. There is no uncertain state.

## Vision Configuration

Vision analysis reuses the Agent's OpenAI-compatible provider by default:

```text
CREATE_MAP_VISION_API_URL
CREATE_MAP_VISION_API_KEY
CREATE_MAP_VISION_MODEL
```

Each `CREATE_MAP_VISION_*` value is an optional override of `LLM_API_URL`, `LLM_API_KEY`, or `LLM_MODEL`. This keeps Agent and vision on one supplier and credential while allowing a dedicated multimodal model from that supplier. The selected model must support OpenAI-compatible `image_url` content; the currently configured `deepseek-v4-flash` rejects image content. Missing effective configuration produces `vision_not_configured`; invalid model output produces `collision_grid_invalid_response`.

## UI

The generated image remains the base layer. A canvas overlay uses the same intrinsic dimensions and draws translucent cell fills plus 8px grid lines. Controls appear only when a ready image is bound:

- analysis status and Retry;
- overlay visibility toggle;
- segmented paint mode: Walkable or Obstacle;
- Clear grid command;
- counts for the three cell states.

Click-drag painting updates row-major cells without touching the image. Scene autosave handles persistence. Analysis never overwrites an existing matching grid unless the user explicitly retries analysis.

## Failure Handling

- Missing or non-ready image: reject without calling the model.
- Stale map/revision/image identity: reject with conflict semantics.
- Oversized, non-PNG, or hash-mismatched bytes: reject before model submission.
- Missing vision configuration: keep the image usable and show a configuration error.
- Invalid tool output or wrong row sizes: retry once with validation issues, then return a stable error.
- Save conflict: use the existing draft conflict flow.
- Image regeneration: clear stale grid and analyze the new hash once.

## Verification

Implementation follows the user's explicit non-TDD workflow: add tests after implementation. Verification covers grid validation and editing, model output normalization, authenticated route boundaries, Scene save/restore, image-hash invalidation, existing Create Map V3 tests, typecheck, scoped lint, migration checks, and a browser smoke test with a mocked vision response. A real provider test requires the effective Agent/vision model to support images and must not invoke PixelLab generation.
