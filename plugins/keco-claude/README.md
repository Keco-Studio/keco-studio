# Keco (Claude Code plugin)

Claude Code packaging of the Keco Studio workflows. The Codex packaging lives in
`plugins/keco/` and is unchanged; this plugin is the Claude-side equivalent with
the contract defects found in the 2026-08-07 audit corrected.

## Install

```bash
/plugin marketplace add ./           # repo root holds .claude-plugin/marketplace.json
/plugin install keco@keco-studio
```

The plugin connects one remote MCP server (`keco`, Streamable HTTP). The `godot`
and `pixellab` MCP servers stay under the user's own configuration; the plugin
never bundles or overrides them.

## Layout

```text
.claude-plugin/plugin.json          plugin manifest
.mcp.json                           remote Keco MCP connection
assets/                             brand icon and logo (one copy)
references/                         plugin-wide shared contracts
  pixellab-capability-registry.md   capability keys + canonical assetKind vocabulary
scripts/                            deterministic validators (one shared copy)
skills/
  keco-build-tables-from-document/  documents -> new Keco tables
  keco-develop-godot-slice/         one bounded, evaluated Godot slice (V1)
  keco-develop-godot-slice-v2/      document-driven multi-Slice workflow (canonical)
  pixellab-map-assets/              Keco-first map and art resources
```

Skills reference the shared scripts as `${CLAUDE_PLUGIN_ROOT}/scripts/<name>.py`.

## Scripts

| Script | Purpose |
|---|---|
| `validate_run_context.py` | minimum V2 run ledger; accepts `implicit-v2` / `explicit-v2` |
| `validate_plan.py` | reviewable task plan; accepts `true`/`required` and `false`/`optional` |
| `validate_eval_report.py` | completion evidence before a report may claim `passed` |
| `validate_slice_documents.py` | dated spec/plan/status/eval-report set for one Slice |
| `validate_generated_asset_package.py` | hashes, PNG geometry, animation and tileset metadata |
| `build_spriteframes_resource.py` | deterministic Godot 4 `SpriteFrames` `.tres` |
| `export_keco_snapshot.py` | deterministic Godot JSON snapshot from a fresh Keco read-back |
| `validate_snapshot.py` | snapshot hashes, paths, and source identity |

All are offline and contact no service.

## Changes against `plugins/keco/`

Fixes carried into this packaging:

1. `validate_run_context.py` required `mode: manual-v2`, a value no contract
   defines; every conformant `RunContext` failed the gate. It now accepts
   `implicit-v2` and `explicit-v2` per `orchestration-contract.md`.
2. `validate_plan.py` demanded `review == {"spec": true, "quality": true}`
   exactly, rejecting the documented `required`/`required` form and contradicting
   the skill's own "small tasks do not need two reviews" rule. It now accepts
   both spellings, requires a spec review per task, and requires at least one
   quality review per plan.
3. V1 hard-required the PixelLab operation `create_s_xl_image_pro`, which the
   capability registry records as `unavailable`. Both V1 and `pixellab-map-assets`
   now resolve a live adapter and record `compatibility`.
4. The A/B matrix claimed V2 was explicit-invocation only, contradicting the
   skill, its metadata, and its tests.
5. `orchestration-contract.md` and `slice-decision.md` were reachable from
   nothing; they are now linked from the V2 entry point.
6. `build_spriteframes_resource.py` and `validate_generated_asset_package.py`
   were reachable from nothing; they are now wired into the animation, tileset,
   and asset contracts.
7. Three conflicting `assetKind` vocabularies collapsed into one, defined in
   `references/pixellab-capability-registry.md` and enforced by the validator.
8. Map-workflow tool names (`create_topdown_tileset` and friends) are recorded
   as planning labels that are not live MCP tools.
9. `build_spriteframes_resource.py` now emits one texture per distinct
   spritesheet, validates `loop`, and binds `--output` to `resourcePath`.
10. `validate_eval_report.py` reports malformed input instead of raising, and
    requires evidence on every evaluation in a `passed` report.
11. `validate_slice_documents.py` tolerates blank lines and comments in
    frontmatter.
12. `export_keco_snapshot.py` refuses to replace a non-empty directory that is
    not itself a previous snapshot.
13. Scripts and brand assets are stored once instead of duplicated per skill.
14. All shipped text is ASCII; the manifest carries a clean semver.

`tests/unit/plugins/keco-claude-plugin.test.ts` covers all four skills, including
`pixellab-map-assets`, which previously had none, and adds the positive validator
cases that let defects 1 and 2 go unnoticed.
