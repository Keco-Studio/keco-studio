---
name: keco-godot-slice-assets
description: Resolve and validate typed Keco Godot Slice V2 assets, provenance, resource evolution, animation, and TileMap resources.
---

# Keco Godot Slice Assets

Read the [shared interaction contract](../../references/interaction-contract.md) before mutating work.

Before expensive or mutating work, summarize Goal, Source, Scope, Success, and Next in the user's language. Keep progress to Completed, Current, Next, and Blocker; keep IDs, hashes, write tokens, raw MCP arguments, and evidence in machine artifacts.

Own PixelLab capability resolution, host-generated image writeback, provider provenance, file hashes, target paths, typed package validation, resource evolution, character/animation/SpriteFrames output, tileset/TileMap assets, and frame/tile/PNG geometry validation. Every supported host-generated game image must be registered in project Assets and authoritatively read back before Godot materialization; a local file alone is not a completed asset.

Before accepting an image-producing task, match every created or changed PNG, JPEG, GIF, WebP, or safe static SVG to one `project_asset_binding` artifact for a ready project Asset. Put the binding artifact IDs, not the project Asset IDs, in `TaskResult.artifactIds`. Missing bindings block task completion and all dependent implementation. Non-image files are reported separately and do not satisfy this gate.

## References

- [generated-asset-contract.md](references/generated-asset-contract.md)
- [existing-resource-evolution.md](references/existing-resource-evolution.md)
- [godot-animation-contract.md](references/godot-animation-contract.md)
- [godot-tileset-contract.md](references/godot-tileset-contract.md)
- [keco-pixellab-contract.md](references/keco-pixellab-contract.md)
- [pixellab-capability-registry.md](references/pixellab-capability-registry.md)

## Scripts

- validate_generated_asset_package.py
- build_spriteframes_resource.py

Use contractVersion 2 and the canonical manifest/corpus. Preserve Keco authority, immutable plan bindings, and the interaction contract. Do not route new work to a legacy workflow.
