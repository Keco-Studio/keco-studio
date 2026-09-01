# Multi-Slice Orchestration

Use this plan when one accepted GDD or feedback source contains more than one
independently deliverable development idea. User-facing artifacts follow the
repository Superpowers layout; runtime ledgers remain internal.

## User-Facing Layout

Create one paired document for each Slice:

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
Do not create a second user-maintained status document for the same Slice.

The spec/plan pair carries the visible Slice revision and source GDD revision.
Checking tasks does not change the revision; changing scope or acceptance does,
which creates a new dated pair.

## Roadmap Plan

When there are multiple Slices, use one normal plan document as the roadmap:

```text
docs/superpowers/plans/<roadmap-id>.md
```

It lists every Slice and its dependency order:

```markdown
- [ ] slice-001: Add gathering point
  - Depends on: none
- [ ] slice-002: Add village signpost
  - Depends on: slice-001
```

Preserve source order as evidence, schedule completed dependencies first, then
priority as the tie-breaker, then stable `sliceId`. A Slice is complete when its plan is fully
checked and the required internal verification has passed.

The internal roadmap projection may retain machine fields such as
`status: planned|in_progress|completed|failed|blocked`, `evalResult`, and
`repairIteration`; those fields are generated ledger state, not extra planning
documents.

## Sequential Execution

```text
SOURCE_DISCOVERY -> SLICE_DECOMPOSITION -> ROADMAP_PLAN
  -> SELECT_NEXT_SLICE -> WRITE_SPEC -> WRITE_PLAN -> PLAN_REVIEW
  -> EXECUTION_PREFLIGHT -> EXECUTE_CHECKLIST -> TASK_REVIEW -> RUNTIME_EVAL
  -> REPAIR -> FINAL_VERIFY -> CHECK_PLAN -> NEXT_SLICE
```

Do not ask for confirmation between unambiguous Slices. Ask only when source,
dependency, acceptance, or allowed-file ambiguity makes the next step unsafe.

## Checklist Task Contract

Each plan task contains exact files, dependencies, a RED check, a minimal change,
and a GREEN check. Internal `TaskResult` and `TaskReview` records retain command
output and file hashes, but the checkbox in `plan.md` is the user-facing mark.

## Repair And Resume

Keep the accepted spec and plan scope fixed during repair. Rerun only failed
checks and affected regressions, for at most three repair iterations. After the
third failure, preserve internal evidence, mark the roadmap Slice as `paused`,
and ask the user; do not silently skip it.

When resuming, re-read the source, paired spec, plan, and current code revision.
If the source or accepted plan changed, create a new revision instead of
mutating the old scope.
