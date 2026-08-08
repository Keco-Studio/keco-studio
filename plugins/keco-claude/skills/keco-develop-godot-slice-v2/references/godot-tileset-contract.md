# Godot Tileset Contract

Use this contract for generated terrain, tile, or tileset assets. Tile layout metadata is authoritative; never infer terrain mappings from a PNG appearance alone.

## Supported layout identities

Record one explicit layout identity:

- `topdown-15`: 4x4 dual-grid atlas with 15 drawable masks and one empty mask.
- `topdown-17`: provider-defined 17-piece top-down layout; require its coordinates and terrain mapping metadata.
- `platformer-16`: 4x4 match-sides atlas with top/right/bottom/left connections.
- `isometric-atlas`: atlas-only export; terrain connect is not assumed.

Every file records `tileSize`, `columns`, `rows`, and the layout-specific mapping source. Verify `imageWidth == tileSize * columns` and `imageHeight == tileSize * rows` before import.

## Godot materialization

When the provider returns a verified `.tres`, materialize it as an ordinary generated resource and validate its source texture, tile size, terrain set, atlas coordinates, and target path. When only an atlas is returned, create only the resource structure supported by the recorded layout. For top-down or platformer terrain, require explicit terrain mapping before claiming a terrain-ready TileSet.

Attach a validated `TileSet` to a `TileMapLayer` only in the selected slice. A bounded paint scene may verify that terrain-connect mode resolves edges and corners; it must not be treated as proof of visual quality without supported visual evidence.

## Dual-grid rule

The `topdown-15` mask order and atlas lookup are provider-specific. If the manifest declares `spritecook-dual-grid-15`, use its recorded mask table and render one extra tile row/column around the logical cells. Do not reinterpret it as a generic eight-neighbor blob tileset.

## Evidence and failure policy

Validate the package with `${CLAUDE_PLUGIN_ROOT}/scripts/validate_generated_asset_package.py <package.json>` before materialization; it checks the declared SHA-256, the real PNG dimensions, `tileSize * columns/rows`, the layout identity, and the presence of `terrainMapping`. Static evidence must prove dimensions, layout metadata, resource paths, and terrain configuration. Runtime evidence must include the loaded snapshot hash and a machine-readable `KECO_EVAL`. Missing mapping, mismatched tile geometry, or an atlas-only export used as terrain-ready is a failure or `blocked_before_write`, not a warning.
