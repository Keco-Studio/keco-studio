# Source Priority And Discovery

Use this contract during `CONNECT`, `DISCOVER`, and `RESOLVE_SOURCES`. Perform no writes in these states.

## Identity Gate

1. Probe the Keco connection and resolve a unique stable `projectId`.
2. Read project structure, page document metadata, and read every relevant document section without treating truncation as complete.
3. Query every relevant Keco table page with stable IDs and semantic field labels.
4. Use `get_godot_version`, `list_projects`, and `get_project_info` to verify the intended project. Resolve addon/plugin configuration by reading `project.godot` and repository files because this MCP has no `addon_status` tool.
5. Record the Godot project path, engine version, main scene, addon configuration (`configured`, `missing`, or `unknown`), Git commit, branch, and dirty paths. If the editor is not running, `launch_editor` may be used before the final project-info check.
6. Stop before any write if either project identity is missing, ambiguous, or mismatched.

## Priority

Resolve a material conflict with this strict order:

1. current user instruction;
2. newest explicit Keco feedback or change document;
3. current GDD goals and acceptance criteria;
4. Keco table values;
5. current Godot behavior.

Newer feedback overrides older sources only where they conflict. Use lower-priority sources for unspecified details. Never silently combine incompatible rules.

## SourceSnapshot

```yaml
version: 1
keco:
  projectId: uuid
  documents:
    - documentId: uuid
      name: Latest Feedback
      epoch: 0
      revision: 148
  tables:
    - tableId: uuid
      name: Activities
      updatedAt: timestamp
      fieldIds: [uuid]
      rowIds: [uuid]
godot:
  projectPath: C:\\path\\to\\game
  engineVersion: 4.7
  mainScene: res://scenes/main.tscn
  addonStatus: configured|missing|unknown
  gitCommit: full-sha
  branch: feature
  dirtyPaths: []
conflicts:
  - topic: day progression
    selectedSource: feedback-document-id
    rejectedSource: res://scripts/state.gd
    decision: Sleep advances one day; ordinary actions do not.
```

Keep stable IDs and revisions, not only names. Re-read the selected document states and table metadata before `DESIGN_DATA`. If any selected source changed, discard the RunContext and restart discovery.
