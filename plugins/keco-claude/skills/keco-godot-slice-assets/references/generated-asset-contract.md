# Generated Asset Contract

Use this contract for every generated or imported non-UI asset. Keco owns the authoritative asset record; the provider only generates or transforms bytes, and Godot consumes a verified projection.

## Canonical identity

Every parent asset has a stable `assetKey`, `assetKind`, provider capability, provider asset ID, exact target path(s), source/reference hashes, and status. Reuse the canonical asset ID for follow-up animation, edit, reference, and style operations. Do not generate a new still for every motion of the same character unless the user explicitly requests a new design.

```yaml
assetKey: player
assetKind: one canonical value from the loaded PixelLab capability registry
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

For GDD-driven assets, retain the historical Art Style content hash and compile
only the category direction needed by the provider. Record reference capability
as `exact`, `fallback`, or `unavailable`; a required unavailable reference
blocks before paid submission. Signed delivery URLs are ephemeral transport and
must not appear in persisted AssetPlan, SlicePlan, or hashes.

## Upload and import boundary

Host-generated game images use project Assets as their Keco authority. Generate into a temporary location, validate each supported image, then keep this exact order before Godot consumes it:

```text
prepare_image_uploads -> exact signed PUT -> complete_project_game_asset_uploads
-> project Assets read-back -> authoritative Keco download -> Godot materialization
```

Pass only the prepared `image.path` to completion and assign the category that matches the runtime role. The authoritative read-back for every output must match project Asset ID, storage path, name, category, SHA-256, and `status: ready`.

For each output, checkpoint one `project_asset_binding` artifact whose schema-version-1 payload contains `projectAssetId`, `repositoryPath`, `storagePath`, `name`, `category`, `sha256`, `status: ready`, `authoritativeDownloadSha256`, `materializedPath`, and `materializedSha256`. Both download/materialization hashes must equal `sha256`, and `materializedPath` must equal `repositoryPath`; record the artifact only after downloading the Keco authority and atomically materializing those bytes. Its `eventId` binds the image-producing TaskResult, its `contentHash` hashes the canonical payload, and the TaskResult's `artifactIds` must equal the binding artifact IDs exactly. Do not put a project Asset ID or unrelated artifact ID in `artifactIds`. The checkpoint service and database RPC both authoritatively read `project_game_assets` and reject missing, duplicate, forged, cross-project, non-ready, or metadata-mismatched bindings.

Missing bindings, a partial batch, or any read-back mismatch blocks the image-producing task and all dependent Godot work. Run `validate_task_evidence.py` with `--artifacts` before checkpointing. A green geometry test or a file already under `res://` never substitutes for registration and read-back.

When a pre-existing local image is used only as a provider input, inspect it without printing bytes, import it through the provider's configured MCP bridge, verify the returned provider asset ID, and only then call animation, edit, reference, or tileset operations. Never pass a local path as if it were a provider asset ID. Never persist upload URLs, upload tokens, API keys, or authorization headers.

## Credits and jobs

Before a batch, read the current credit balance and model/capability cost. Record the estimate and actual credits in the run ledger. Long-running generation must retain its job/run ID, poll with the supported status operation, and record queued, active, succeeded, failed, cancelled, or expired states. Refresh expired signed URLs through asset metadata rather than retrying generation.

## Parent/child files

Provider-managed multi-file outputs use a parent row in the selected asset registry and, when needed, one compatible child-file registry row per output. The display names `Generated Assets` and `Generated Asset Files` are examples, not required table names. Each child stores `fileKey`, source file, target `res://` path, file hash, dimensions, sequence/frame/direction/tile coordinates, and the typed animation or tileset metadata. Host-generated multi-file outputs instead register every supported image in project Assets. In both paths the parent or task is `ready` only after every file is uploaded, read back, hash-checked, and materializable.

## Persistence and recovery

For provider-managed outputs, keep the order `planned row -> provider operation -> temporary validation -> Keco upload -> Keco read-back -> snapshot export -> authoritative download -> Godot materialization`. For host-generated outputs, use the project Assets sequence above and export the fresh Keco snapshot only after Assets read-back succeeds. A partial upload is retained and rebound by ID; it is never deleted or duplicated automatically. Temporary generator or provider bytes are never copied directly into Godot.

After authoritative download, run
`tsx scripts/game-art-style/inspectOutput.ts <local-png>` and persist its JSON
observation. Track `provenanceStatus` and `visualStyleStatus` independently.
A matching Art Style or source hash can pass provenance only. Semantic palette,
silhouette, composition, perspective, subject matter, outline behavior, UI
contrast, and frame consistency need structured visual-review assertions before
visual style can pass. Regenerate only a failed asset and record the changed
prompt or reference identity.

## Presets and capability selection

When the user names a preset, list and resolve it before generation, then map its settings and reference assets into the typed operation. Select the official provider capability from `assetKind` and acceptance requirements before choosing a transport adapter. Mark adapters `exact`, `fallback`, or `unavailable`; an unavailable typed capability blocks the run instead of silently substituting a generic image operation.
