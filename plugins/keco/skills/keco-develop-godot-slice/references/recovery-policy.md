# Recovery And Reporting Policy

Follow this policy from the first connection check through `REPORT`.

## Failure Matrix

| Failure | Action |
|---|---|
| Keco MCP unavailable | Stop before writes |
| Godot MCP unavailable or wrong project | Stop before writes |
| Selected source revision changed | Discard RunContext and re-plan |
| Unrelated dirty Godot path | Preserve and exclude it |
| Dirty allowed file | Work from current content; never revert user changes |
| Keco partial write | Stop, retain IDs, re-read, never delete rollback |
| Export or validation failure | Do not implement |
| Godot parse, import, or runtime error | Repair within the slice |
| Unsupported input evidence | Mark `manualRequired`; do not invent a pass |
| Three failed repair iterations | Persist failure and stop |

## Repair Loop

Keep the original EvalSpec fixed. For each failed evaluation:

1. record the first concrete divergence between expected and actual evidence;
2. classify it as source, data, export, parse, resource, runtime, behavior, visual, or regression;
3. change the smallest allowed cause;
4. start a fresh frozen run;
5. rerun the failed evaluation and affected regressions;
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
