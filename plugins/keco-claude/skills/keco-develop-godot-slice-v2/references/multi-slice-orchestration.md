# Multi-Slice Orchestration

Use this outer ledger when an accepted Keco source contains one or more development ideas. The existing single-Slice ledger remains the inner execution loop.

## Roadmap Contract

Write one roadmap document in the discovered planning Folder before any per-Slice write:

```yaml
version: 1
roadmapId: stable-roadmap-key
runId: stable-run-id
kecoProjectId: project-uuid
sourceDocument:
  documentId: document-uuid
  revision: accepted-revision
  contentHash: sha256
kecoFolderId: folder-uuid
roadmapDocumentId: document-uuid
status: planned|in_progress|paused|completed|superseded
currentSliceId: null
nextSliceId: null
slices:
  - sliceId: stable-slice-key
    objective: one bounded outcome
    dependencies: []
    priority: 1
    allowedFiles: []
    status: planned|in_progress|completed|failed|blocked
    evalResult: passed|partial|failed|blocked_before_write
    documentIds:
      spec: null
      plan: null
      status: null
      evalReport: null
    repairIteration: 0
```

The roadmap records all candidate Slices from the accepted source. Preserve source order as evidence, but schedule by dependencies first and priority second. Stable Slice IDs bind roadmap entries, Keco documents, data rows, assets, local mirrors, and runtime evidence.

Create the roadmap with `create_document(projectId, folderId, ...)`, then use `read_document` to verify its Project, Folder, document ID, source binding, revision, state token, and content hash. A mutation response without read-back does not authorize a Slice write.

The authoritative roadmap document must include a Markdown checklist for every Slice. Keep the machine-readable fields above in the document metadata or front matter, and use this checklist as the execution view:

## Slice Checklist

- [ ] slice-001: Add gathering point
  - Dependencies: none
  - Priority: 1
  - Status: planned
- [ ] slice-002: Add village signpost
  - Dependencies: slice-001
  - Priority: 2
  - Status: planned

Change a Slice entry to `- [x]` only after its tasks, regressions, status read-back, and eval-report read-back pass. Keco's read-back plan is authoritative; a local mirror or mutation response alone is never sufficient.

## Sequential Execution

Execute all planned Slices sequentially. A Slice is eligible only after every ID in its dependencies is complete with a read-back `eval-report`. When multiple eligible Slices remain, priority is the tie-breaker; stable `sliceId` order is the deterministic final tie-breaker.

```text
SOURCE_DISCOVERY -> SLICE_DECOMPOSITION -> ROADMAP_REVIEW
  -> PLANNING_DOCUMENT_PREFLIGHT -> WRITE_ROADMAP
  -> SELECT_NEXT_SLICE -> DESIGN -> WRITE_SPEC -> WRITE_PLAN -> PLAN_REVIEW
  -> EXECUTION_PREFLIGHT -> EXECUTE_TASKS -> TASK_REVIEW -> RUNTIME_EVAL
  -> REPAIR -> FINAL_VERIFY -> UPDATE_ROADMAP -> NEXT_SLICE
```

`NEXT_SLICE` is allowed only after the current Slice is completed: every planned task is complete, required regression tests pass, the Keco status document is read back, and the Keco eval-report is created and read back. Update and read back the roadmap before selecting the next Slice. When all roadmap Slices pass, set `currentSliceId: null`, `nextSliceId: null`, and `status: completed`.

Do not ask for confirmation between unambiguous Slices. Ask only when source, dependency, acceptance, or allowed-file ambiguity makes the next step unsafe.

## Per-Slice Superpowers-Style Plan

Every Slice owns `spec`, `plan`, `status`, and `eval-report`. Its authoritative `plan` document is a Markdown checklist containing small tasks with exact files, dependencies, served evaluation IDs, a RED command and expected missing behavior, the minimal implementation, a GREEN command and expected evidence, and a review gate. Never execute directly from roadmap prose or an unchecked task.

## Task Checklist

- [ ] task-001: Update existing gathering-point data
  - Files: `game/data/gathering_points.json`
  - Depends on: none
  - RED: `python3 tests/check_gathering_points.py` fails because the new key is missing
  - Minimal implementation: add the new entry using the existing schema
  - GREEN: `python3 tests/check_gathering_points.py` passes and records the expected key
  - Review: required

- [ ] task-002: Add Godot scene integration
  - Files: `game/scenes/village.tscn`, `game/scripts/village.gd`
  - Depends on: task-001
  - RED: the scene test fails because the node and collision shape are absent
  - Minimal implementation: instance the existing resource and configure the declared Godot collision
  - GREEN: the scene test and runtime `KECO_EVAL` pass with the current snapshot hash
  - Review: required

Record task completion in local `status.json` only after its RED/GREEN evidence and review succeed. Keep the accepted `plan` checklist ordered and immutable during execution; render checked state from `status.json` in user progress instead of rewriting the plan for every task. Coalesce ordinary task progress into the next durable Keco status checkpoint. A free-form paragraph is not a substitute for a task checklist.

## Repair Exhaustion

Each Slice has at most three repair iterations. After each failure, retain the original EvalSpec, persist fresh failure evidence, update `repairIteration`, and rerun only the affected evaluation and regressions.

On the third failed repair iteration, persist the final evidence in the Slice status and eval-report, read both documents back, set the roadmap status to `paused`, set `nextSliceId: null` so `NEXT_SLICE` is clear, update and read back the roadmap, and ask the user for direction. Do not automatically skip the failed Slice or continue an independent Slice.

## Resume

After user direction, re-read the source, roadmap, every referenced Slice status/eval-report, Keco schemas, Godot baseline, and dirty paths. Resume only if IDs, revisions, dependencies, and hashes still match. Otherwise invalidate the affected stages and return to the earliest changed decision.
