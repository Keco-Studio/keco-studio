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

Every Slice owns `spec`, `plan`, `status`, and `eval-report`. Its plan contains small tasks with exact files, dependencies, served evaluation IDs, a RED command and expected missing behavior, the minimal implementation, a GREEN command and expected evidence, and a review gate. Never execute directly from roadmap prose.

## Repair Exhaustion

Each Slice has at most three repair iterations. After each failure, retain the original EvalSpec, persist fresh failure evidence, update `repairIteration`, and rerun only the affected evaluation and regressions.

On the third failed repair iteration, persist the final evidence in the Slice status and eval-report, read both documents back, set the roadmap status to `paused`, set `nextSliceId: null` so `NEXT_SLICE` is clear, update and read back the roadmap, and ask the user for direction. Do not automatically skip the failed Slice or continue an independent Slice.

## Resume

After user direction, re-read the source, roadmap, every referenced Slice status/eval-report, Keco schemas, Godot baseline, and dirty paths. Resume only if IDs, revisions, dependencies, and hashes still match. Otherwise invalidate the affected stages and return to the earliest changed decision.
