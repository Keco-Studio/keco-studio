# Godot MCP Execution Policy

Use this policy during `IMPLEMENT`, `VERIFY_STATIC`, and `EVALUATE_RUNTIME`. The editor must already be open on the RunContext project with a compatible addon.

## Read Before Edit

1. Call `godot_project get_info` and `addon_status`.
2. Read relevant project settings and input mappings.
3. Read the open scene, scene tree, affected nodes, resources, and editor log cursor.
4. Capture a baseline runtime digest from a frozen run.
5. Stop the baseline before editing.

Use Godot scene and node tools for engine-owned structure and properties. Use repository editing tools for focused `.gd`, `.tscn`, and generated JSON changes when they preserve existing conventions. Reload a directly edited open scene and read it back.

## Deterministic Evaluation Sequence

```text
godot_editor_edit run frozen=true
  -> godot_exec run (establish preconditions)
  -> godot_runtime_state digest (initial evidence)
  -> godot_game_time step or step_until with bounded inputs
  -> godot_runtime_state digest (result evidence)
  -> godot_editor_read logs and minimal screenshots
  -> godot_exec clear
  -> godot_editor_edit stop
```

Use explicit returns from `godot_exec`; do not rely on `print`. Never run an unbounded loop. Prefer frozen stepping so game time cannot race between MCP calls.

## Reload Rules

- After ordinary `.gd` or `.tscn` edits: stop, then run. A launched game loads them from disk.
- After editing `project.godot`: call `godot_project check_stale`; restart only when editor state is stale.
- Restart for changed addon, plugin, `@tool` code, or cached shader only.
- For unexpected 3D rendering with clean logs: call `godot_validate_meshes` before changing lighting or materials.

## Evidence Rules

- Values: runtime state or exact GDScript return.
- Signals over time: runtime watch or a bounded holder observer.
- Appearance: one modest-width screenshot at each required viewport.
- Performance: profiler measurement only when the EvalSpec contains a budget.
- Errors: incremental editor logs plus runtime errors returned by MCP calls.

Read back edited node properties and scene structure immediately. Stop on parse, import, missing-resource, or runtime errors until corrected. The running game must report the current snapshot aggregate hash before domain evaluations can pass.
