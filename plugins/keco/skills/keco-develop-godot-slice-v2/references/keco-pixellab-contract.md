# Keco And PixelLab Contract

Keco is the authoritative store for generated assets and provenance. PixelLab is only a generator. The API key remains in the environment or MCP configuration and is never requested, printed, stored in Keco, added to a prompt, or committed.

## Operation adapter

Read [pixellab-capability-registry.md](pixellab-capability-registry.md). At `PREFLIGHT`, list the live PixelLab MCP tools and record an `operationProfile`. Keep official provider capability, endpoint, transport tool, and compatibility as separate fields. Never call an operation by memory, label an official capability as legacy, or silently substitute an unsupported tool. Map the AssetPlan to the live schema, including prompt/description, dimensions, transparency/background behavior, reference paths, frames, directions, and tile constraints.

```yaml
assetKind: ui|image|effect|character|character-rotation|animation|edit|tile|tileset
providerCapability: official capability key
officialEndpoint: POST /v2/...
transport: mcp
transportTool: live tool name or null
compatibility: exact|fallback|unavailable
compatibilityReason: exact semantic difference or blocker
```

## Required order

```text
PREFLIGHT PixelLab schema and operationProfile
 -> Keco Generated Assets planned row + paginated read-back
 -> PixelLab operation selected from operationProfile
 -> temporary file validation (type, dimensions, alpha, non-empty, <=5 MiB, SHA-256)
 -> create_image_upload
 -> HTTP PUT raw bytes with signed headers
 -> complete_image_upload
 -> update_table_row with the verified image object and provenance
 -> paginated Keco read-back and exact hash/object check
 -> fresh Keco snapshot export + validation
 -> download authoritative Keco bytes, verify hash, atomically materialize targetPath
 -> Godot import/runtime evaluation
```

The planned row precedes generation. An upload that succeeds but cannot bind to the row is a partial write: retain its image object/path and retry binding without regenerating or uploading a duplicate. Never auto-delete it.

Every `Generated Assets` row binds `runId`, `sliceId`, `Asset Key`, `Asset Kind`, provider capability, official endpoint, transport tool, compatibility, exact prompt without secrets, reference paths and hashes, dimensions, frame/direction counts, target `res://` paths, and `Status: planned|ready|failed|blocked`.

Use one row for a single image. For characters, rotations, animations, and tilesets with multiple files, add a `Generated Asset Files` table keyed by `Asset File Key` and reference the parent `Generated Assets` row. Each file row stores sequence/frame/direction/tile coordinates, Keco image object, output SHA-256, and target path. Upload and read back every file before the parent row becomes `ready`.

Existing UI extensions require the original asset as a style/edit reference; new UI should select `ui-elements-pro` when an exact transport adapter exists. Character, animation, rotation, and tile requests must use their typed capability rather than being flattened into a generic Pixflux/Bitforge image.
