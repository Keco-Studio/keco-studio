# V2 Orchestration Contract

Load `contract-manifest.json` and run `scripts/validate_contract_case.py` for contract-version-2 boundary and conformance checks.

## SourceProfile And RunContext

Every new run has `contractVersion: 2` and exactly one canonical SourceProfile
of kind `gdd`, `feedback`, `document`, `table`, or `user_idea`. Document kinds
bind project/document IDs, epoch, revision, and content hash; table kinds bind
the table/schema and selected row hashes; user ideas bind the request hash and
bounded excerpt. The run stores the profile and `sourceProfileHash`. A material
source change creates a successor run and never silently upgrades or rewrites
the accepted contract.

```yaml
version: 2
contractVersion: 2
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
planRevision: sha256:accepted-plan-digest
deliveryPolicyHash: sha256:locked-policy-digest
stateToken: opaque-current-token
repairCount: 0
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
  kecoSpecFolderId: direct-child-spec-folder-uuid
  kecoPlanFolderId: direct-child-plan-folder-uuid
  kecoDocumentIds:
    roadmap: null
    spec: null
    plan: null
  kecoDocumentNames:
    roadmap: roadmap
    spec: <sliceId>
    plan: <sliceId>
  localMirrorRoot: docs/superpowers
  localMirrorPaths:
    roadmapPath: docs/superpowers/roadmap.md
    specPath: docs/superpowers/specs/<sliceId>-design.md
    planPath: docs/superpowers/plans/<sliceId>.md
  internalPaths:
    statusPath: internal/<sliceId>/status.json
    evalReportPath: internal/<sliceId>/eval-report.json
evolution:
  strategy: reuse_exact|extend_compatible|migrate_additive|create_new
  targetTableId: null
  targetResourcePaths: []
  discoveryEvidence: []
  noCompatibleTarget: false
```
`kecoFolderId` is the planning root. `kecoSpecFolderId` and
`kecoPlanFolderId` must identify its actual direct child folders named `spec`
and `plan`; they must differ from the root and from each other. The Slice spec
and plan use the bare `sliceId` as their document name and the corresponding
child folder ID. A name such as `spec/<sliceId>` or `plan/<sliceId>` is invalid
because it is still one flat document.

The write token is null until the semantic source decision, roadmap and folder
read-back, Keco Project identity, compatible Keco planning hierarchy, EvalSpec,
SlicePlan, and PlanReview gates pass. It is scoped to this `runId` and
`sliceId`; never reuse it across runs or Slices. Keco folder/document IDs and
state tokens are execution state, not guesses.

The `interaction` block is required for new runs and must pass `scripts/validate_interaction_checkpoint.py` when paused or resumed. Legacy RunContext files without an `interaction` block remain readable only under their stored V1 contract. When present, `interaction.checkpoint.runId` must equal the containing `RunContext.runId`.

## Artifact Ledger

The four user-visible phases are Preflight, Implementation, Verification, and Delivery. Preflight uses `create_slice_bundle`; durable task, review, observation, and repair events use `checkpoint_slice`. Delivery is strictly `implementation_complete -> prepare_delivery -> export_slice_mirrors -> materialize -> MirrorVerification checkpoint -> delivery seal`. `prepare_delivery` is the last planning-document mutation. Export and `finalize_slice(delivery)` are read-only with respect to roadmap/spec/plan. A later action may consume only an accepted artifact with unchanged input revisions and the current opaque state token. A stale token, repeated event, or changed selected document invalidates the affected stage rather than overwriting it.

Every resource or table change records one `evolution.strategy`. `reuse_exact` and `extend_compatible` are preferred; `migrate_additive` preserves existing IDs while adding compatible fields or rows. `create_new` requires `noCompatibleTarget: true` or an explicit isolation requirement, with discovery evidence recorded. An ambiguous target keeps the write token null and performs zero writes.

## Plan, State, And Evidence Ownership

`SlicePlan` is the approved static scope in the Keco `plan/<sliceId>` document;
`docs/superpowers/plans/<sliceId>.md` is its local mirror. It owns tasks, files,
dependencies, evaluation IDs, RED/GREEN commands, and review requirements; a
scope or acceptance change creates a new plan revision. Current task completion
is marked directly in the plan's Markdown checkboxes (`- [ ]` / `- [x]`).
`RunContext`, `status.json`, `TaskResult`, `TaskReview`, and `EvalReport` are
internal machine evidence; they own the active stage, write lease, repair
iteration, recovery state, command output, changed files, read-back, hashes,
screenshots, and runtime evidence.

Order `SlicePlan.tasks` topologically so every dependency appears before its dependent task. That order is also the default execution order. Execute one visible task at a time from top to bottom; do not silently complete a later task while an earlier task is `pending` or `in_progress`.

Apply prerequisite discoveries in this order:

1. Keep the work as an internal RED/GREEN step of the current task when it needs no independently reviewable result.
2. Revise, revalidate, and topologically reorder the plan when scope, acceptance, `allowedFiles`, task identity, or dependencies change.
3. Use `taskTransition` only when the prerequisite was discovered during execution, cannot be kept inside the current task, already exists later in the approved plan, changes none of those plan boundaries, and every dependency of each temporary task is already complete.

Record this transition in the internal `status.json` before the jump:

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

`TaskResult` is a strict schema-versioned artifact bound to one run, Slice, task, plan revision, and attempt. It records one command or MCP operation, phase, timestamps, exit/timeout/cancellation facts, bounded redacted stdout/stderr summaries plus SHA-256 digests, changed-file before/after digests, and expected/observed outcome. RED must observe the approved failure and GREEN the approved pass.

`TaskReview` binds exact TaskResult IDs and current plan revision, records an accepted/rejected verdict and bounded findings, and lists exact after-byte SHA-256 digests reviewed. Its effective level is database-derived: `self`, `separate_context` only with trusted context identity, or `independent_actor` only when the authenticated reviewer differs from the TaskResult actor. A missing review, forged level, unknown key, secret-bearing summary, or review of different bytes blocks completion.
