# PixelLab UI Asset Planning And Generation

Use this contract during `DESIGN_ASSETS`, `WRITE_KECO_DATA`, `GENERATE_ASSETS`, `PERSIST_ASSETS`, and `EXPORT_SNAPSHOT`. UI image generation is part of the active gameplay slice, never a separate unbounded art task. Keco stores the authoritative image and metadata; Godot receives an exported local copy.

## AssetPlan

```yaml
version: 1
runId: another-spring-inventory-20260805-120000
sliceId: inventory-panel
mode: new-ui|extend-existing-ui|none
styleEvidence:
  - path: res://ui/existing/inventory_panel.png
    sha256: sha256
assets:
  - key: inventory-slot-active
    purpose: Selected inventory-slot state
    sourceEvidence: []
    referenceAssets:
      - res://ui/existing/inventory_slot.png
    prompt: Exact generation prompt without credentials
    width: 64
    height: 64
    alpha: true
    states: [active]
    targetPath: res://ui/generated/inventory_slot_active.png
    kecoTableKey: ui-assets
    kecoRowKey: inventory-slot-active
    imageFieldLabel: Image
    integrationFiles: []
    evaluations: [inventory-selection-visible]
provenancePath: res://data/generated/keco/ui-asset-provenance.json
blockers: []
warnings: []
```

Every generated file and the provenance manifest must be listed in `SlicePlan.allowedFiles`. Use stable lower-case file names. Do not overwrite an original reference asset unless the current user instruction explicitly requires replacement.

## Keco UI Assets Table

When any asset is planned, include one `UI Assets` table in the DataPlan, reusing a same-purpose compatible table when present. Use `Asset Key` as the stable match field and include:

| Field | Type | Requirement |
|---|---|---|
| Asset Key | string | Required stable key |
| Display Name | string | Required |
| Purpose | string | Required |
| Image | image | Optional while `planned`, required when `ready` |
| Width | int | Required |
| Height | int | Required |
| Target Path | string | Required Godot path |
| PixelLab Operation | string | `create_s_xl_image_pro` |
| Prompt | string | Exact prompt without credentials |
| Reference Paths | string_array | Existing UI inputs |
| Reference Hashes | string_array | SHA-256 aligned with paths |
| Output SHA-256 | string | Empty while planned, required when ready |
| Status | enum | `planned`, `ready`, or `failed` |

Create or update a `planned` row during `WRITE_KECO_DATA` before calling PixelLab. Bind every AssetPlan entry to its returned Keco table ID and row ID. Apply the DataPlan `reuseEmpty` and semantic field-label rules.

## Style Contract

Inspect current UI scenes, themes, fonts, colors, borders, icons, image dimensions, filtering, and representative raster assets before writing a prompt.

- `extend-existing-ui`: `referenceAssets` must contain the original UI image being extended and any state variant needed to understand its visual system. Pass those images through the PixelLab tool's declared reference input. If the tool schema cannot accept them, stop with a blocker.
- `new-ui`: select representative existing UI images as style references and encode the current palette, edge treatment, pixel density, lighting, typography relationship, and spacing in the prompt. If the project has no existing UI image, use explicit GDD visual rules plus the current Godot Theme; otherwise stop instead of inventing an unrelated style.
- `none`: record why no generated image is required and continue without PixelLab.

Match existing import behavior. Preserve intentional pixel-art nearest filtering, transparency, nine-patch safe regions, control-state dimensions, and fixed UI scale. Do not ask PixelLab to render labels or gameplay text that Godot should render dynamically.

## PixelLab Contract

Use only the PixelLab MCP operation `create_s_xl_image_pro` for UI image generation in this Skill. Inspect its live input schema before calling it and map the AssetPlan prompt, dimensions, transparency, and reference images to the declared fields. Do not guess unsupported parameters and do not silently substitute another PixelLab or image-generation tool.

The PixelLab API key belongs in the user's environment or MCP configuration. Never ask the user to paste it into chat, read it, print it, store it in Keco, add it to provenance, or write it into the repository.

Generate only after the planned Keco `UI Assets` rows have been read back. Save the PixelLab result to a temporary or planned local path, then verify file type, dimensions, alpha requirement, non-empty pixels, file size at most 5 MiB, and SHA-256 before persistence. A successful tool response is not proof that the asset matches the game.

## Keco Image Persistence

Persist each validated PixelLab output in this exact order:

```text
create_image_upload(projectId, fileName, fileType, fileSize)
  -> HTTP `PUT` raw bytes to upload.url with the returned headers
  -> complete_image_upload(projectId, image.path)
  -> update_table_row with the verified `image` object and ready metadata
  -> query_table_rows through every page
  -> verify the exact image object, hashes, target path, and ready status
  -> EXPORT_SNAPSHOT
```

Never store the signed upload URL or headers. Pass the complete verified `image` object returned by `complete_image_upload` as the semantic `Image` field value; do not reduce it to a URL or storage path. In the same row update, persist `Output SHA-256`, `Prompt`, `Reference Paths`, `Reference Hashes`, `Target Path`, dimensions, operation, and `Status: ready`.

Complete paginated `query_table_rows` read-back and verify the bound image metadata before entering `EXPORT_SNAPSHOT`.

If image upload completes but the row update fails, retain the completed image object and path in the partial-write report, re-read Keco, and retry the row binding without generating or uploading a duplicate. Never delete a Keco image as an automatic rollback.

After read-back, normalize the `UI Assets` table into the snapshot. Download the authoritative bytes from the read-back image URL to a temporary file, verify them against `Output SHA-256`, then atomically materialize `targetPath`. Do not integrate the original PixelLab download directly into Godot.

## Provenance And Evaluation

For each output, record:

```yaml
assetKey: inventory-slot-active
operation: create_s_xl_image_pro
prompt: exact prompt without secrets
referenceAssets:
  - path: res://ui/existing/inventory_slot.png
    sha256: sha256
image:
  url: Keco verified public URL
  path: project-scoped Keco storage path
  fileName: inventory_slot_active.png
  fileSize: 1024
  fileType: image/png
  uploadedAt: timestamp
outputPath: res://ui/generated/inventory_slot_active.png
outputSha256: sha256
dimensions: [64, 64]
generatedAt: stable timestamp
```

Keco holds the authoritative provenance fields; the repository provenance manifest is their exported read-only projection. Verify deterministic file properties and Keco read-back automatically. Evaluate style consistency, legibility, layout integration, and appearance manually because the configured Godot MCP has no screenshot tool. Set the corresponding visual evaluation to `manualRequired: true`; do not claim a visual pass from generation, upload, or file validation alone.

PixelLab regeneration counts toward the shared three-iteration repair limit. Keep the original UI references on every retry, record the concrete visual divergence, and change only the prompt or planned property responsible for it.
