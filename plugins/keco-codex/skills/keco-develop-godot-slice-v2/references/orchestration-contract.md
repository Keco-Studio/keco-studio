# V2 Orchestration Contract

## RunContext

```yaml
version: 2
runId: stable-run-id
mode: implicit-v2|explicit-v2
kecoProjectId: uuid
godotProjectPath: absolute-canonical-path
godotGitCommit: full-sha
roadmapId: stable-roadmap-key
roadmapDocumentId: document-uuid
sourceDocumentId: document-uuid
sliceId: lower-case-hyphen-key
allowedFiles: []
writeToken: null
sourceRevisions: {}
iteration: 0
interaction:
  version: 1
  status: running|paused|resuming|completed|blocked_before_write|partial
  blockedAt: null
  completed: []
  writesPerformed: []
  userAction: null
  resumeFrom: null
  checkpoint:
    runId: stable-run-id
    planRevision: stable-plan-revision
    sourceRevisions: {}
  revalidate: []
documents:
  kecoFolderId: existing-folder-uuid
  kecoFolderName: discovered-project-folder-name
  kecoDocumentIds:
    roadmap: null
    spec: null
    plan: null
    status: null
    evalReport: null
  localMirrorRoot: docs/keco-godot-slices/<sliceId>
  localMirrorPaths:
    specPath: docs/keco-godot-slices/<sliceId>/spec.md
    planPath: docs/keco-godot-slices/<sliceId>/plan.md
    statusPath: docs/keco-godot-slices/<sliceId>/status.json
    evalReportPath: docs/keco-godot-slices/<sliceId>/eval-report.json
evolution:
  strategy: reuse_exact|extend_compatible|migrate_additive|create_new
  targetTableId: null
  targetResourcePaths: []
  discoveryEvidence: []
  noCompatibleTarget: false
```
The write token is null until the semantic source decision, roadmap read-back, Keco Project identity, compatible Keco folder, EvalSpec, SlicePlan, and PlanReview gates pass. It is scoped to this `runId` and `sliceId`; never reuse it across runs or Slices. Keco folder/document IDs and state tokens are execution state, not guesses.

The `interaction` block is required for new runs and must pass `scripts/validate_interaction_checkpoint.py` when paused or resumed. Legacy version 2 RunContext files without an `interaction` block remain readable and valid. When present, `interaction.checkpoint.runId` must equal the containing `RunContext.runId`.

## Artifact Ledger

Each stage records `stage`, `status`, `createdAt`, `inputHashes`, `outputHash`, and `blockingReason`. The outer ledger records semantic source selection, Slice decomposition, roadmap revision, dependencies, priority, current Slice, and next Slice. The inner ledger records Keco folder/document IDs and local mirror paths under `documents`; Keco documents are the dated source of truth for the roadmap, spec, plan, status, and final evaluation report. A later stage may consume only an accepted artifact with unchanged input revisions. If a selected Keco document, roadmap, folder, table, project identity, or dirty-path baseline changes, invalidate the ledger and return to the earliest affected stage.

Every resource or table change records one `evolution.strategy`. `reuse_exact` and `extend_compatible` are preferred; `migrate_additive` preserves existing IDs while adding compatible fields or rows. `create_new` requires `noCompatibleTarget: true` or an explicit isolation requirement, with discovery evidence recorded. An ambiguous target keeps the write token null and performs zero writes.

## Plan, State, And Evidence Ownership

`SlicePlan` is the approved static scope. It owns tasks, files, dependencies, evaluation IDs, RED/GREEN commands, and review requirements; a scope or acceptance change creates a new plan revision. Current task completion comes from `status.json`, while `RunContext` owns the active stage, write lease, repair iteration, and recovery state. `TaskResult`, `TaskReview`, and `EvalReport` own command output, changed files, read-back, hashes, screenshots, and runtime evidence.

Order `SlicePlan.tasks` topologically so every dependency appears before its dependent task. That order is also the default execution order. Execute one visible task at a time from top to bottom; do not silently complete a later task while an earlier task is `pending` or `in_progress`.

Apply prerequisite discoveries in this order:

1. Keep the work as an internal RED/GREEN step of the current task when it needs no independently reviewable result.
2. Revise, revalidate, and topologically reorder the plan when scope, acceptance, `allowedFiles`, task identity, or dependencies change.
3. Use `taskTransition` only when the prerequisite was discovered during execution, cannot be kept inside the current task, already exists later in the approved plan, changes none of those plan boundaries, and every dependency of each temporary task is already complete.

Record this transition in `status.json` before the jump:

```yaml
taskTransition:
  pausedTaskId: task-02
  reason: concrete newly discovered dependency
  temporaryTaskIds: [task-03, task-04]
  returnToTaskId: task-02
  discoveredDuring: execution
  canInline: false
  planImpact:
    scopeChanged: false
    acceptanceChanged: false
    allowedFilesChanged: false
```

The paused task must be `in_progress` or `blocked`. Complete only the listed temporary tasks, then return to `returnToTaskId` before advancing to any later task. Keep `taskTransition` while that return task remains unfinished so the out-of-order state stays explained; clear it immediately when the return task completes.

## Task Contract

Each task must contain:

```yaml
id: task-01
files: [exact/path]
dependsOn: []
servesEvaluations: [eval-id]
red:
  command: exact command or MCP sequence
  expected: failing for the missing behavior
green:
  command: exact command or MCP sequence
  expected: passing with zero relevant errors
review:
  spec: required
  quality: required
```

The implementer reports changed files, commands, outputs, and concerns. The reviewer sees the task contract and diff, not an unbounded conversation transcript.
