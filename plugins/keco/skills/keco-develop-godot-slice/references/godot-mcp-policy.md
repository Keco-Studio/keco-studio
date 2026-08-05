# Godot MCP Execution Policy

Use this policy during `CONNECT`, `DISCOVER`, `IMPLEMENT`, `VERIFY_STATIC`, and `EVALUATE_RUNTIME`. This policy is limited to the configured Godot MCP's fourteen tools; do not invent editor, runtime, or scripting endpoints.

## Available Tools

```text
get_godot_version, get_project_info, list_projects, launch_editor
create_scene, add_node, load_sprite, save_scene
run_project, stop_project, get_debug_output
export_mesh_library, get_uid, update_project_uids
```

The MCP does not edit GDScript text, execute arbitrary Godot commands, expose runtime state or game-time stepping, capture screenshots, report addon status, or validate meshes. Use repository editing tools for text files and classify unsupported evidence as `manual_required`.

## Read Before Edit

1. Call `get_godot_version`, `list_projects`, and `get_project_info`; resolve the intended project by canonical path, not only by name.
2. Read `project.godot`, relevant scenes, scripts, resources, and input mappings with repository tools. Record addon/plugin configuration from files because no `addon_status` tool exists.
3. If the editor is not available, call `launch_editor` for the resolved project and re-run `get_project_info` before editing.
4. Before editing, run the project once when a baseline is needed, read `get_debug_output`, and call `stop_project`.

Use `create_scene`, `add_node`, `load_sprite`, and `save_scene` for scene structure and sprite assignment when practical. Use repository editing tools for focused `.gd`, `.tscn`, and generated JSON changes when they preserve existing conventions. Because this MCP has no scene-read tool, inspect directly edited scenes from the repository and use `run_project` as the import/load check.

Use `get_uid` to resolve a resource UID when a slice introduces or repairs a UID-sensitive reference. Use `update_project_uids` only after the changed resource paths have been reviewed and only when the project requires re-saving references; record the affected paths in `changedFiles`.

## Deterministic Evaluation Sequence

```text
run_project (project or bounded test/debug scene)
  -> get_debug_output (initial and result `KECO_EVAL` records)
  -> stop_project
```

The project-side test/debug entry must establish preconditions, execute a bounded player flow, and print machine-readable lines in this form:

```text
KECO_EVAL {"evalId":"...","status":"passed|failed","expected":{},"actual":{},"snapshotHash":"sha256:..."}
```

Use `get_debug_output` to collect those records and errors. Do not treat ordinary prose, a clean launch, or a screenshot from outside this MCP as structured evidence. Never run an unbounded test loop. Without a project-side harness, retain startup/log evidence but mark domain evaluation `manual_required`.

## Reload Rules

- After ordinary `.gd` or `.tscn` edits: call `stop_project` if needed, then `run_project`; the launched game loads files from disk.
- After editing `project.godot`, addon/plugin files, `@tool` code, or cached shaders: stop and relaunch the project with `run_project`. There is no stale-state or mesh-validation endpoint.
- If an import or rendering issue remains, use `get_debug_output` and repository inspection to diagnose it; do not claim a mesh validation step was run.

## Evidence Rules

- Values: parsed `KECO_EVAL` JSON from `get_debug_output`; exact runtime state is unavailable otherwise.
- Signals over time: a project-side bounded harness that emits ordered `KECO_EVAL` records, or `manual_required`.
- Appearance: `manual_required`; this MCP has no screenshot tool.
- Performance: profiler measurement only when the EvalSpec contains a budget.
- Errors: incremental editor logs plus runtime errors returned by MCP calls.

Inspect edited scene text and resource paths after repository changes. Stop on parse, import, missing-resource, or runtime errors until corrected. The running game must report the current snapshot aggregate hash in each `KECO_EVAL` record before domain evaluations can pass.
