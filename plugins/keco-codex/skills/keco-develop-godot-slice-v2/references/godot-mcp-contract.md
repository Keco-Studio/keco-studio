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
KECO_EVAL {"evalId":"...","status":"passed|failed","expected":{},"actual":{},"snapshotHash":"sha256:..."}
```

There is no supported arbitrary GDScript execution, runtime-state query, time-step control, input injection, or screenshot tool. Do not claim those capabilities. Appearance, unsupported input, and experience evaluations remain `manual_required`; a clean launch is not a domain pass.
