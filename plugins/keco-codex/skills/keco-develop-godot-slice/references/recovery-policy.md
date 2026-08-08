# Recovery And Reporting Policy

Follow this policy from the first connection check through `REPORT`.

## Failure Matrix

| Failure | Action |
|---|---|
| Keco MCP unavailable | Stop before writes |
| Godot MCP unavailable or wrong project | Stop before writes |
| PixelLab unavailable or `create_s_xl_image_pro` missing for a required asset | Stop before Keco, asset, or Godot writes and report the AssetPlan blocker |
| PixelLab API key missing or rejected | Stop; report configuration required and never request or expose the key |
| Required Godot capability is absent | Use the documented repository/harness fallback or mark the evaluation `manual_required`; never invent a tool |
| Selected source revision changed | Discard RunContext and re-plan |
| Unrelated dirty Godot path | Preserve and exclude it |
| Dirty allowed file | Work from current content; never revert user changes |
| Keco partial write | Stop, retain IDs, re-read, never delete rollback |
| Export or validation failure | Do not implement |
| Godot parse, import, or runtime error | Read `get_debug_output`, repair within the slice, then rerun with `run_project` |
| PixelLab output missing or invalid | Do not integrate it; record the concrete failure and retry within the shared repair limit |
| PixelLab output fails style review | Keep original UI references, mark the visual evaluation failed/manual, and regenerate only within the shared repair limit |
| Keco image upload completed but row update failed | Retain the verified image object/path, re-read Keco, and retry binding without generating or uploading a duplicate |
| Keco image row read-back mismatches | Stop before snapshot export and preserve the partial write for repair |
| Keco authoritative image download hash mismatches | Do not materialize or integrate the Godot copy; persist failure and stop |
| Unsupported input evidence | Mark `manualRequired`; do not invent a pass |
| Three failed repair iterations | Persist failure and stop |

## Repair Loop

Keep the original EvalSpec fixed. For each failed evaluation:

1. record the first concrete divergence between expected and actual evidence from `KECO_EVAL` JSON or `get_debug_output`;
2. classify it as source, data, export, parse, resource, runtime, behavior, visual, or regression;
3. change the smallest allowed cause;
4. for source, data, asset, or export failures, rerun the failed state and required Keco read-back before implementation; for runtime failures, start a fresh bounded `run_project` execution;
5. rerun the failed evaluation and affected regressions when implementation evidence is available;
6. increment `RunContext.iteration`.

Run no more than three repair iterations. Return to planning instead of silently expanding `allowedFiles` or changing acceptance criteria.

## EvalReport

```yaml
version: 1
runId: stable-run-id
sliceId: stable-slice-id
status: passed|failed|partial|blocked
sourceRevisions: {}
godotCommit: full-sha
snapshotHash: sha256
conflicts: []
assets:
  - assetKey: inventory-slot-active
    operation: create_s_xl_image_pro
    kecoTableId: uuid
    kecoRowId: uuid
    kecoImagePath: project-scoped-storage-path
    referenceHashes: []
    outputPath: res://ui/generated/inventory_slot_active.png
    outputSha256: sha256
evaluations:
  - evalId: rest-advances-day
    status: passed
    expected: {}
    actual: {}
    evidence: []
    iteration: 1
manualRequirements: []
completedKecoIds: []
changedFiles: []
originalDirtyFiles: []
residualRisks: []
```

Write stable evaluation records to Keco and retain a repository report when the project convention supports it. Report exact IDs, revisions, hashes, paths, commands, evidence, incomplete work, and manual requirements. At completion, the worktree may contain only original user changes and SlicePlan changes.
