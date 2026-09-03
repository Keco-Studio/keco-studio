# Godot MCP Contract

The configured Godot MCP contract is limited to:

```text
get_godot_version, get_project_info, list_projects, launch_editor,
create_scene, add_node, load_sprite, save_scene, run_project, stop_project,
get_debug_output, export_mesh_library, get_uid, update_project_uids
```

Before writes call `get_godot_version`, `list_projects`, and `get_project_info`; resolve the intended project by canonical path. Read `project.godot`, relevant scenes/scripts/resources and dirty paths with repository tools. If the editor is absent, launch it and repeat project identity checks.

The only automated runtime sequence is:

```text
run_project -> get_debug_output -> stop_project
```

The project must print one line per evaluation:

```text
KECO_OBSERVATION {"schemaVersion":1,"runId":"...","sliceId":"...","evalId":"...","buildHash":"sha256:...","snapshotHash":"sha256:...","actual":{},"errors":[]}
```

`KECO_OBSERVATION` owns observations only. Runtime output must not include `expected`, `status`, `passed`, assertion results, or aggregate results; the locked EvalSpec and deterministic evaluator own those fields. The explicit legacy adapter may read `KECO_EVAL`, but it ignores self-reported expected/status values and never upgrades that evidence to V2.

Prefer one bounded aggregate evaluation scene for evaluations that can share a fresh process and snapshot. Run that scene through one runtime sequence and emit one `KECO_OBSERVATION` line per evaluation. Use separate runtime sequences only when isolation, input, or lifecycle requirements make aggregation invalid, and record that reason in the EvalReport. Parse and retain the required records from one `get_debug_output` response; do not poll or repeat the same run after complete evidence is already available.

When the host requires local-command authorization, describe the complete bounded verification batch before the first command. Use one stable executable and command prefix throughout the batch so the user can choose the host's persistent prefix approval. A Skill cannot suppress or pre-approve the host prompt and must not claim that permission was granted.

There is no supported arbitrary GDScript execution, runtime-state query, time-step control, input injection, or screenshot tool. Do not claim those capabilities. Appearance, unsupported input, and experience evaluations remain `manual_required`; a clean launch is not a domain pass.
