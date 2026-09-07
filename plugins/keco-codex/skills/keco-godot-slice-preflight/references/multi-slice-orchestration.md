# Multi-Slice Orchestration

Use this reference when one accepted GDD or feedback source contains more than
one independently deliverable development idea.

## User-Facing Layout

Use folder/mirror/spec/plan rules in `slice-document-contract.md`; mirror pairs at `docs/superpowers/specs/<slice-id>-design.md` and `docs/superpowers/plans/<slice-id>.md`.

Before any pair, create one decomposition bundle for all Slices and run
`scripts/validate_slice_decomposition.py`; repeat at `PLAN_REVIEW`. Every pair
has Slice-specific objective/scope/acceptance, concrete files, and RED/GREEN
commands; do not create a second user-maintained status document.

When there are multiple Slices, create or bind `roadmap` directly in the Keco
planning root and mirror it at `docs/superpowers/roadmap.md`. List every Slice
and dependency order; preserve source order as evidence, then schedule completed
dependencies, priority, and stable `sliceId` as successive tie-breakers.
`prepare_delivery` checks the roadmap item with expected epoch/revision before
the three-file mirror export; the internal roadmap projection's `status`,
`evalResult`, and `repairIteration` are ledger fields, not extra planning documents.

## Sequential Execution

```text
SOURCE_DISCOVERY -> SLICE_DECOMPOSITION -> ROADMAP_PLAN
  -> SELECT_NEXT_SLICE -> WRITE_SPEC -> WRITE_PLAN -> PLAN_REVIEW
  -> EXECUTION_PREFLIGHT -> EXECUTE_CHECKLIST -> TASK_REVIEW -> RUNTIME_EVAL
  -> REPAIR -> FINAL_VERIFY -> IMPLEMENTATION_COMPLETE -> PREPARE_DELIVERY
  -> EXPORT_MIRRORS -> MIRROR_VERIFICATION -> DELIVERY_SEAL -> NEXT_SLICE
```

Do not ask for confirmation between unambiguous Slices; ask only when source,
dependency, acceptance, or allowed-file ambiguity makes the next step unsafe.
Each task contains exact files, dependencies, RED/minimal-change/GREEN checks;
TaskResult and TaskReview retain command output/hashes; the checkbox in `plan.md` is the user-facing mark.

## Checklist Task Contract

- [ ] task-001: Add the bounded Slice behavior
- [x] task-001: Add the bounded Slice behavior

## Repair and resume

Keep accepted spec and plan scope fixed during repair. Rerun failed checks and
affected regressions for at most three repair transitions. A fourth transition
is rejected even after replay, a new idempotency key, or resume. After third failure,
preserve internal evidence, mark the roadmap Slice `paused`, and ask the user;
do not silently skip it. On resume reread source, paired spec, plan,
and current code revision. A material source or accepted-plan change creates a
successor run and new plan revision rather than mutating old scope.
