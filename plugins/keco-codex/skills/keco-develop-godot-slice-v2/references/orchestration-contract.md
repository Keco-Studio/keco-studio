# V2 Orchestration Contract

Load `contract-manifest.json` and run `scripts/validate_contract_case.py` for
contract-version-2 boundary/conformance checks. Preflight must validate
SourceProfile, SlicePlan/EvalSpec, paired Spec/Plan parsing, cross-document
identity/mapping equality, and multi-Slice distinctness. Technical failures
return `SLICE_TECHNICAL_CONTRACT_INVALID` before lease acquisition; `writeToken`
stays `null` and Keco documents remain untouched.

## SourceProfile and RunContext

Every run has `contractVersion: 2` and exactly one canonical SourceProfile of
kind `gdd`, `feedback`, `document`, `table`, or `user_idea`. Document kinds bind
project/document IDs, epoch, revision, and content hash; table kinds bind
table/schema and selected row hashes; user ideas bind request hash and bounded
excerpt. Store the profile and `sourceProfileHash`; a material source change
creates a successor run and never rewrites an accepted contract.

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
  checkpoint: {runId: stable-run-id, planRevision: stable-plan-revision, sourceRevisions: {}}
  revalidate: []
documents:
  kecoFolderId: existing-folder-uuid
  kecoFolderName: discovered-project-folder-name
  kecoSpecFolderId: direct-child-spec-folder-uuid
  kecoPlanFolderId: direct-child-plan-folder-uuid
  kecoDocumentIds: {roadmap: null, spec: null, plan: null}
  kecoDocumentNames: {roadmap: roadmap, spec: <sliceId>, plan: <sliceId>}
  localMirrorRoot: docs/superpowers
  localMirrorPaths: {roadmapPath: docs/superpowers/roadmap.md, specPath: docs/superpowers/specs/<sliceId>-design.md, planPath: docs/superpowers/plans/<sliceId>.md}
  internalPaths: {statusPath: internal/<sliceId>/status.json, evalReportPath: internal/<sliceId>/eval-report.json}
evolution:
  strategy: reuse_exact|extend_compatible|migrate_additive|create_new
  targetTableId: null
  targetResourcePaths: []
  discoveryEvidence: []
  noCompatibleTarget: false
```

`kecoFolderId` is the planning root; `kecoSpecFolderId` and `kecoPlanFolderId`
are distinct direct child folders named `spec` and `plan`. Slice documents use
bare `sliceId` and matching folder IDs; `spec/<sliceId>` and `plan/<sliceId>` are
invalid flat names. The write token stays null until source decision,
roadmap/folder read-back, project identity, compatible hierarchy, EvalSpec,
SlicePlan, and PlanReview gates pass. It is scoped to run and Slice, never
reused; IDs and state tokens are execution state, not guesses.

Interaction block is required for every run; paused/resumed runs must pass
`scripts/validate_interaction_checkpoint.py`, with checkpoint `runId` equal to
the containing RunContext `runId`.

## Artifact ledger and delivery

The four user-visible phases are Preflight, Implementation, Verification, and
Delivery. Preflight uses `create_slice_bundle`; task, review, observation, and
repair events use `checkpoint_slice`. Delivery is strictly
`implementation_complete -> prepare_delivery -> export_slice_mirrors -> materialize -> MirrorVerification checkpoint -> finalize_slice(delivery) -> delivery seal`.
`prepare_delivery` is the last planning-document mutation; export and
`finalize_slice(delivery)` are read-only for roadmap/spec/plan. Actions consume
accepted artifacts with unchanged revisions and the current opaque state token;
stale tokens, repeated events, or changed selected documents invalidate the stage.

Every resource/table change records one `evolution.strategy`: prefer
`reuse_exact` or `extend_compatible`; `migrate_additive` preserves IDs; and
`create_new` requires `noCompatibleTarget: true` or explicit isolation plus
discovery evidence. An ambiguous target keeps the token null and performs zero writes.

## Plan, state, and evidence ownership

`SlicePlan` is the approved static scope in Keco `plan/<sliceId>` and
`docs/superpowers/plans/<sliceId>.md`. It owns tasks, exact files, dependencies,
evaluation IDs, RED/GREEN commands, and review requirements; scope or acceptance
change creates a new plan revision. Task completion is marked in Markdown checkboxes.
`RunContext`, `status.json`, `TaskResult`, `TaskReview`, and
`EvalReport` own stage, lease, repair/recovery state, command output, changed-file
and read-back hashes, screenshots, and runtime evidence. The artifact chain remains
SourceProfile, Requirement Inventory, roadmap, spec, plan, SlicePlan, EvalSpec,
TaskResult, TaskReview, KECO_OBSERVATION, EvalReport, MirrorManifest,
MirrorVerification, and delivery seal.

Order `SlicePlan.tasks` topologically and execute one visible task at a time;
never silently complete a later task while an earlier task is `pending` or
`in_progress`. Apply prerequisite discoveries in this order:

1. Keep work as an internal RED/GREEN step of the current task when no independently reviewable result is needed.
2. Revise, revalidate, and topologically reorder the plan when scope, acceptance,
   `allowedFiles`, task identity, or dependencies change.
3. Use `taskTransition` only when the prerequisite is discovered during execution, cannot be inlined, already exists later, changes none of those boundaries, and every dependency is already complete.

Record this in `status.json` before jumping:

```yaml
taskTransition:
  pausedTaskId: task-02
  reason: concrete newly discovered dependency
  temporaryTaskIds: [task-03, task-04]
  returnToTaskId: task-02
  discoveredDuring: execution
  canInline: false
  planImpact: {scopeChanged: false, acceptanceChanged: false, allowedFilesChanged: false}
```

The paused task is `in_progress` or `blocked`; complete only listed temporary
tasks, return to `returnToTaskId`, keep the transition while unfinished, and
clear it when that task completes.

## Task contract

Each task has exact `id`, `files`, `dependsOn`, `servesEvaluations`, RED/GREEN
commands with expected outcomes, and required spec/quality review. The strict
schema-versioned `TaskResult` binds run, Slice, task, plan revision, and attempt;
it records the command/MCP operation, phase/timestamps, timeout facts, bounded
redacted summaries, SHA-256 digests, changed-file digests, and expected/observed
outcome. RED observes the approved failure and GREEN the approved pass.
`TaskReview` binds exact TaskResult IDs and reviewed byte hashes; its effective
level is database-derived (`self`, trusted `separate_context`, or
`independent_actor` with a different authenticated actor). Forged, incomplete,
secret-bearing, or different-byte review blocks completion.
