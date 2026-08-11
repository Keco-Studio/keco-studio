# V2 Orchestration Contract

## RunContext

```yaml
version: 2
runId: stable-run-id
mode: implicit-v2|explicit-v2   # scripts/validate_run_context.py accepts exactly these
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

The `interaction` block is required for new runs and must pass `${CLAUDE_PLUGIN_ROOT}/scripts/validate_interaction_checkpoint.py` when paused or resumed. Legacy version 2 RunContext files without an `interaction` block remain readable and valid. When present, `interaction.checkpoint.runId` must equal the containing `RunContext.runId`.

## Artifact Ledger

Each stage records `stage`, `status`, `createdAt`, `inputHashes`, `outputHash`, and `blockingReason`. The outer ledger records semantic source selection, Slice decomposition, roadmap revision, dependencies, priority, current Slice, and next Slice. The inner ledger records Keco folder/document IDs and local mirror paths under `documents`; Keco documents are the dated source of truth for the roadmap, spec, plan, status, and final evaluation report. A later stage may consume only an accepted artifact with unchanged input revisions. If a selected Keco document, roadmap, folder, table, project identity, or dirty-path baseline changes, invalidate the ledger and return to the earliest affected stage.

Every resource or table change records one `evolution.strategy`. `reuse_exact` and `extend_compatible` are preferred; `migrate_additive` preserves existing IDs while adding compatible fields or rows. `create_new` requires `noCompatibleTarget: true` or an explicit isolation requirement, with discovery evidence recorded. An ambiguous target keeps the write token null and performs zero writes.

## Plan, State, And Evidence Ownership

`SlicePlan` is the approved static scope. It owns tasks, files, dependencies, evaluation IDs, RED/GREEN commands, and review requirements; a scope or acceptance change creates a new plan revision. Current task completion comes from `status.json`, while `RunContext` owns the active stage, write lease, repair iteration, and recovery state. `TaskResult`, `TaskReview`, and `EvalReport` own command output, changed files, read-back, hashes, screenshots, and runtime evidence.

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
  spec: required        # or true; every task carries a spec review
  quality: required     # or optional/false for small, low-risk tasks
```

`scripts/validate_plan.py` accepts `true`/`required` and `false`/`optional` for both
keys. `spec` must be required on every task; `quality` may be relaxed for small
gameplay tasks, but at least one task in the plan must carry a quality review.

The implementer reports changed files, commands, outputs, and concerns. The reviewer sees the task contract and diff, not an unbounded conversation transcript.
