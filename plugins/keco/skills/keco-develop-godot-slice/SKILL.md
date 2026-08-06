---
name: keco-develop-godot-slice
description: Use when a user explicitly asks to implement or continue one Godot gameplay slice from Keco project GDDs, feedback, or tables and evaluate the running result, including slice-owned UI image generation; not for Keco-only table creation, analysis-only requests, standalone asset generation, running existing tests only, or Godot work unrelated to Keco design sources.
---

# Develop A Godot Slice From Keco

## Overview

Turn Keco design sources into one bounded, evaluated Godot gameplay slice. Keep Keco authoritative, define evaluations before implementation, and use Godot MCP runtime evidence instead of ad hoc tool calls or visual guesses.

## Required Workflow

Copy and track this checklist:

```text
Keco Godot slice progress:
- [ ] CONNECT and DISCOVER
- [ ] RESOLVE_SOURCES and SELECT_SLICE
- [ ] DEFINE_EVALS, DESIGN_DATA, and DESIGN_ASSETS
- [ ] WRITE_KECO_DATA, GENERATE_ASSETS, and PERSIST_ASSETS
- [ ] EXPORT_SNAPSHOT and validate it
- [ ] IMPLEMENT and VERIFY_STATIC
- [ ] EVALUATE_RUNTIME and repair bounded failures
- [ ] REPORT exact evidence and retained work
```

1. Read all seven files in `references/` completely before calling Keco, PixelLab, or Godot tools: [source-priority.md](references/source-priority.md), [slice-plan.md](references/slice-plan.md), [data-plan.md](references/data-plan.md), [asset-plan.md](references/asset-plan.md), [eval-spec.md](references/eval-spec.md), [godot-mcp-policy.md](references/godot-mcp-policy.md), and [recovery-policy.md](references/recovery-policy.md).
2. Execute this state machine in order: `CONNECT -> DISCOVER -> RESOLVE_SOURCES -> SELECT_SLICE -> DEFINE_EVALS -> DESIGN_DATA -> DESIGN_ASSETS -> WRITE_KECO_DATA -> GENERATE_ASSETS -> PERSIST_ASSETS -> EXPORT_SNAPSHOT -> IMPLEMENT -> VERIFY_STATIC -> EVALUATE_RUNTIME -> REPAIR -> REPORT`.
3. Verify both MCP connections and stable Keco/Godot project identities before any write. Stop with zero writes when either identity is unavailable or mismatched.
4. Select one bounded slice. An explicit invocation authorizes that slice without a second confirmation; do not expand its scope.
5. Create the EvalSpec before changing Keco data or Godot files. Every implementation change must serve one accepted evaluation.
6. Design required Keco tables and rows through the DataPlan. Never automatically delete tables, fields, or rows, perform destructive type conversions, or copy local runtime state back into Keco.
7. If the slice needs UI images, create the AssetPlan and verify PixelLab exposes `create_s_xl_image_pro` before any Keco, asset, or Godot write. Existing UI extensions require the original UI image as a generation reference; new UI must derive references and constraints from the current project's UI. Do not use another image generator as an automatic fallback.
8. In `WRITE_KECO_DATA`, discover the project's compatible asset registry from fresh table schemas before planning rows. Reuse a same-purpose table by semantic fields regardless of its display name (`媒体资源`, `UI Assets`, `Generated Assets`, `Assets`, or another project-specific name); create a new table only when no compatible target exists and record that discovery evidence. After every successful Keco write, paginate-read all affected tables again and refresh IDs, revisions, timestamps, labels, values, and references before continuing.
9. Generate only planned AssetPlan outputs with PixelLab. Validate each local result before upload; never expose or persist the PixelLab API key.
10. In `PERSIST_ASSETS`, upload each validated image with `create_image_upload`, HTTP `PUT`, and `complete_image_upload`; write the verified image object, generator/operation, prompt, reference hashes, output hash, target path, dimensions, and `ready` status into the selected asset-registry row. Paginate-read the table again and stop on any mismatch.
11. Export only the fresh Keco read-back with `scripts/export_keco_snapshot.py`, validate it with `scripts/validate_snapshot.py`, then materialize the Godot image from the Keco image URL and require its SHA-256 to match the Keco row. The running game must expose the loaded snapshot hash.
12. Implement only `SlicePlan.allowedFiles`. Use repository editing tools for `.gd`, generated JSON, and focused text changes; use the available Godot MCP scene tools for engine-owned `.tscn` structure. Follow the executable tool order in `godot-mcp-policy.md` and collect evidence only from tools that exist.
13. Repair only failed evaluations for at most three repair iterations, including PixelLab regeneration attempts. Rerun affected regressions after every repair.
14. Persist exact results and report failures, manual requirements, partial Keco writes, asset provenance, original dirty files, snapshot hash, and Godot evidence. Never infer success from writes, parsing, or screenshots alone.

## Routing Boundary

Do not invoke `keco-build-tables-from-document` from this workflow. Route Keco-only new-table requests to that Skill. Route standalone asset generation, analysis-only work, and Godot work unrelated to Keco to their general workflows. PixelLab generation belongs here only when an AssetPlan binds it to the active `runId`, `sliceId`, EvalSpec, and `allowedFiles`.

For character, animation, spritesheet, tileset, TileMap, resource-evolution, or persistent slice-document/Keco Project Folder work, explicitly select `$keco-develop-godot-slice-v2`. V1 does not silently emulate those newer contracts: route the request to v2, or state that the requested contract is outside v1. This routing is self-contained in the repository.

## Common Mistakes

| Mistake | Correction |
|---|---|
| Implement before defining observable success | Return to `DEFINE_EVALS` |
| Treat current code as newer design authority | Apply the source priority contract |
| Duplicate Keco values as GDScript constants | Regenerate and load the snapshot |
| Judge values from screenshots | Require a parsed `KECO_EVAL` record, or mark the evaluation `manual_required` |
| Continue repairing without a bound | Stop after three repair iterations |
| Claim mouse coverage without absolute input evidence | Mark the evaluation `manual_required` |
| Generate UI without inspecting the current style | Return to `DESIGN_ASSETS` and select existing UI references |
| Extend existing UI without the original asset reference | Block generation until the reference is resolved |

## Godot MCP Capability Boundary

The configured Godot MCP exposes exactly these tools:

```text
get_godot_version, get_project_info, list_projects, launch_editor
create_scene, add_node, load_sprite, save_scene
run_project, stop_project, get_debug_output
export_mesh_library, get_uid, update_project_uids
```

Do not call or assume `godot_project`, `addon_status`, `godot_editor_edit`, `godot_exec`, `godot_runtime_state`, `godot_game_time`, `godot_editor_read`, `check_stale`, or `godot_validate_meshes`; they are not available in this MCP. Use `godot-mcp-policy.md` for the supported replacements and evidence limits.

For automated runtime assertions, the project must expose a bounded test/debug entry that prints one machine-readable `KECO_EVAL` JSON record per evaluation, including the current snapshot aggregate hash. Read those records with `get_debug_output` between `run_project` and `stop_project`. If the required input, state, or visual evidence cannot be exposed this way, set `manualRequired: true` and do not claim an automated pass.
