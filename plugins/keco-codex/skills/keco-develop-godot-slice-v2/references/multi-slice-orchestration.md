# Multi-Slice Orchestration

Use this plan when one accepted GDD or feedback source contains more than one
independently deliverable development idea. Canonical user-facing artifacts
live in the Keco planning hierarchy; repository mirrors use the Superpowers
layout and runtime ledgers remain internal.

## User-Facing Layout

Create one paired document for each Slice in two actual Keco child folders:

```text
<planning-root>/
|-- roadmap
|-- spec/
|   |-- <slice-id-1>
|   `-- <slice-id-2>
`-- plan/
    |-- <slice-id-1>
    `-- <slice-id-2>
```

The names `spec` and `plan` identify folders, never document-name prefixes.
Create Slice documents with the bare `<slice-id>` name and the corresponding
folder ID. In particular, do not create flat documents named
`spec/<slice-id>` or `plan/<slice-id>` under the planning root. Mirror each pair
locally as:

```text
docs/superpowers/specs/<slice-id>-design.md
docs/superpowers/plans/<slice-id>.md
```

The spec states the bounded objective, acceptance, and exclusions. The plan is
an ordered Markdown checklist and is the only task progress view:

```markdown
- [ ] task-001: Add gathering point data
- [ ] task-002: Integrate the scene
```

Change each item to `- [x]` only after its implementation and verification pass.

Before writing any pair, create a decomposition bundle for all planned Slices
and run `scripts/validate_slice_decomposition.py`. Every pair must contain a
Slice-specific objective, scope, acceptance behavior, concrete files, and
RED/GREEN commands. A coverage mapping or a checklist that only says
`Implement tasks` is not a decomposition. Re-run this gate at `PLAN_REVIEW`.
Do not create a second user-maintained status document for the same Slice.

The stable spec/plan pair carries the visible plan revision and bound source
identity. Checking tasks does not change the plan revision. A material scope,
acceptance, source, or allowed-file change creates an explicit successor run
and updates the stable documents with optimistic concurrency; document history
preserves the previous bytes.

## Roadmap Plan

When there are multiple Slices, create one `roadmap` document directly in the
Keco planning root and mirror it at:

```text
docs/superpowers/roadmap.md
```

It lists every Slice and its dependency order:

```markdown
- [ ] slice-001: Add gathering point
  - Depends on: none
- [ ] slice-002: Add village signpost
  - Depends on: slice-001
```

Preserve source order as evidence, schedule completed dependencies first, then
priority as the tie-breaker, then stable `sliceId`. A Slice is implementation-
complete when its plan is fully checked and required internal verification has
passed. `prepare_delivery` then checks its roadmap item with the expected
epoch/revision before the three-file mirror export.

The internal roadmap projection may retain machine fields such as
`status: planned|in_progress|completed|failed|blocked`, `evalResult`, and
`repairIteration`; those fields are generated ledger state, not extra planning
documents.

Before writing any Slice document, read back the planning root and require one
exact direct child `spec` folder and one exact direct child `plan` folder. After
writing, read back again and require every spec document's `folderId` to equal
the spec folder ID and every plan document's `folderId` to equal the plan folder
ID. A slash in a generated document name is a structural failure, not a folder.

## Sequential Execution

```text
SOURCE_DISCOVERY -> SLICE_DECOMPOSITION -> ROADMAP_PLAN
  -> SELECT_NEXT_SLICE -> WRITE_SPEC -> WRITE_PLAN -> PLAN_REVIEW
  -> EXECUTION_PREFLIGHT -> EXECUTE_CHECKLIST -> TASK_REVIEW -> RUNTIME_EVAL
  -> REPAIR -> FINAL_VERIFY -> IMPLEMENTATION_COMPLETE -> PREPARE_DELIVERY
  -> EXPORT_MIRRORS -> MIRROR_VERIFICATION -> DELIVERY_SEAL -> NEXT_SLICE
```

Do not ask for confirmation between unambiguous Slices. Ask only when source,
dependency, acceptance, or allowed-file ambiguity makes the next step unsafe.

## Checklist Task Contract

Each plan task contains exact files, dependencies, a RED check, a minimal change,
and a GREEN check. Internal `TaskResult` and `TaskReview` records retain command
output and file hashes, but the checkbox in `plan.md` is the user-facing mark.

## Repair And Resume

Keep the accepted spec and plan scope fixed during repair. Rerun only failed
checks and affected regressions, for at most three repair transitions. A fourth
transition is rejected even after replay, a new idempotency key, or resume.
After the third failure, preserve internal evidence, mark the roadmap Slice as
`paused`, and ask the user; do not silently skip it.

When resuming, re-read the source, paired spec, plan, and current code revision.
If the source or accepted plan changed materially, create a successor run and
new plan revision instead of mutating the old scope.
