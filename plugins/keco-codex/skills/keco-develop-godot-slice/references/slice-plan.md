# Run And Slice Planning

Use this contract in `SELECT_SLICE`. Select exactly one independently evaluable gameplay slice.

## RunContext

```yaml
version: 1
runId: project-slice-yyyymmdd-hhmmss
kecoProjectId: uuid
godotProjectPath: C:\\path\\to\\game
godotGitCommit: full-sha
sliceId: lower-case-hyphen-key
sourceSnapshot: SourceSnapshot
allowedFiles: []
iteration: 0
```

Keep the RunContext in the conversation and persist its identifiers in the final report. Bind every Keco write, exported file, Godot edit, and evaluation to `runId` and `sliceId`.

## Selection

1. Honor an explicit feature or slice from the user.
2. Otherwise find unmet acceptance targets in current GDD and feedback.
3. Exclude targets blocked by missing prerequisites or unresolved design conflicts.
4. Prefer the highest-priority target that delivers a player-observable result with deterministic evidence.
5. Choose the smallest target that completes one coherent input-to-outcome path.

Do not choose unrelated cleanup, speculative infrastructure, or a second gameplay feature.

## SlicePlan

```yaml
version: 1
sliceId: sleep-advances-day
objective: Sleeping restores energy and advances exactly one day.
sourceEvidence:
  - documentId: uuid
    locator: feedback item 2
acceptanceTargets:
  - sleep restores energy to 100
  - sleep increments elapsed days by 1
  - ordinary actions do not advance day
outOfScope:
  - save-slot UI
  - new location art
dataChanges: []
assetChanges:
  - create selected inventory-slot state matching existing UI
godotChanges: []
allowedFiles:
  - res://scripts/main/state/game_state.gd
  - res://data/generated/keco/**
  - res://ui/generated/inventory_slot_active.png
risks: []
```

List exact repository paths, including PixelLab outputs and the UI asset provenance manifest when `assetChanges` is non-empty. Original user changes are never part of the plan unless the slice explicitly builds on them. When a required dependency is discovered outside `allowedFiles`, return to `SELECT_SLICE`, update the plan and affected regressions, and record why; do not silently edit it.
