# V2 Orchestration Contract

## RunContext

```yaml
version: 2
runId: stable-run-id
mode: manual-v2
kecoProjectId: uuid
godotProjectPath: absolute-canonical-path
godotGitCommit: full-sha
sliceId: lower-case-hyphen-key
allowedFiles: []
writeToken: null
sourceRevisions: {}
iteration: 0
documents:
  kecoFolderId: existing-folder-uuid
  kecoFolderName: discovered-project-folder-name
  kecoDocumentIds:
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
The write token is null until the source, Keco Project identity, compatible Keco folder, EvalSpec, SlicePlan, and PlanReview gates pass. It is scoped to this `runId` and `sliceId`; never reuse it across runs. Keco folder/document IDs and state tokens are execution state, not guesses.

## Artifact Ledger

Each stage records `stage`, `status`, `createdAt`, `inputHashes`, `outputHash`, and `blockingReason`. The ledger records Keco folder/document IDs and local mirror paths under `documents`; Keco documents are the dated source of truth for the spec, plan, status, and final evaluation report. A later stage may consume only an accepted artifact with unchanged input revisions. If a selected Keco document, folder, table, project identity, or dirty-path baseline changes, invalidate the ledger and return to `BASELINE`.

Every resource or table change records one `evolution.strategy`. `reuse_exact` and `extend_compatible` are preferred; `migrate_additive` preserves existing IDs while adding compatible fields or rows. `create_new` requires `noCompatibleTarget: true` or an explicit isolation requirement, with discovery evidence recorded. An ambiguous target keeps the write token null and performs zero writes.

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
