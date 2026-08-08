# Generated Asset Contract

Use this contract for every generated or imported non-UI asset. Keco owns the authoritative asset record; the provider only generates or transforms bytes, and Godot consumes a verified projection.

## Canonical identity

Every parent asset has a stable `assetKey`, `assetKind`, provider capability, provider asset ID, exact target path(s), source/reference hashes, and status. Reuse the canonical asset ID for follow-up animation, edit, reference, and style operations. Do not generate a new still for every motion of the same character unless the user explicitly requests a new design.

```yaml
assetKey: player
assetKind: one canonical value from ../../../references/pixellab-capability-registry.md
provider:
  capability: animate-text-pro
  transportTool: live-tool-name
  assetId: provider-owned-id
status: planned|ready|failed|blocked
files: []
```

Use the reference roles precisely:

- `styleAssetIds`: ambient style, palette, proportions, and rendering guidance.
- `referenceAssetId`: one specific visual or layout source.
- `editAssetId`: the one asset being directly modified.

## Upload and import boundary

When the source is a local path, inspect it without printing bytes, upload/import it through the configured MCP bridge, verify the returned asset ID, and only then call animation, edit, reference, or tileset operations. Never pass a local path as if it were a provider asset ID. Never persist upload URLs, upload tokens, API keys, or authorization headers.

## Credits and jobs

Before a batch, read the current credit balance and model/capability cost. Record the estimate and actual credits in the run ledger. Long-running generation must retain its job/run ID, poll with the supported status operation, and record queued, active, succeeded, failed, cancelled, or expired states. Refresh expired signed URLs through asset metadata rather than retrying generation.

## Parent/child files

Multi-file outputs use a parent row in the selected asset registry and, when needed, one compatible child-file registry row per output. The display names `Generated Assets` and `Generated Asset Files` are examples, not required table names. Each child stores `fileKey`, source file, target `res://` path, file hash, dimensions, sequence/frame/direction/tile coordinates, and the typed animation or tileset metadata. The parent is `ready` only after every child is uploaded, read back, hash-checked, and materializable.

## Persistence and recovery

Keep the order `planned row -> provider operation -> temporary validation -> Keco upload -> Keco read-back -> snapshot export -> authoritative download -> Godot materialization`. A partial upload is retained and rebound by ID; it is never deleted or duplicated automatically. A temporary provider download is never copied directly into Godot.

## Presets and capability selection

When the user names a preset, list and resolve it before generation, then map its settings and reference assets into the typed operation. Select the official provider capability from `assetKind` and acceptance requirements before choosing a transport adapter. Mark adapters `exact`, `fallback`, or `unavailable`; an unavailable typed capability blocks the run instead of silently substituting a generic image operation.
