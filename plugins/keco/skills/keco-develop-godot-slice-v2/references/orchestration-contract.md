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
```
The write token is null until the source, identity, EvalSpec, SlicePlan, and PlanReview gates pass. It is scoped to this `runId` and `sliceId`; never reuse it across runs.

## Artifact Ledger

Each stage records `stage`, `status`, `createdAt`, `inputHashes`, `outputHash`, and `blockingReason`. A later stage may consume only an accepted artifact with unchanged input revisions. If a selected Keco document, table, project identity, or dirty-path baseline changes, invalidate the ledger and return to `BASELINE`.

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
