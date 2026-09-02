---
name: keco-develop-godot-slice-v2
description: Use when a user asks to plan, implement, continue, or evaluate Godot development driven by Keco project documents, GDDs, feedback, tables, or development ideas, including work that needs document decomposition, multiple slices, persistent Keco planning documents, typed asset provenance, resource evolution, TileMap integration, or runtime evaluation. Not for user-selected legacy V1 runs, Keco-only table creation, standalone asset generation, analysis-only work, or Godot-only debugging.
---

# Keco Godot Slice V2

Read and follow the [shared interaction contract](../../references/interaction-contract.md) for every user-visible exchange, checkpoint, and resume.

Before expensive or mutating work, summarize Goal, Source, Scope, Success, and Next. Use the user's language for that summary and for progress limited to Completed, Current, Next, and Blocker. Keep IDs, hashes, write tokens, raw MCP arguments, and evidence in machine artifacts or an on-request detail view.

This is the document-driven, review-driven workflow for Keco Godot development. It supports implicit invocation and keeps Keco authoritative while shipping every source-discovery, multi-Slice planning, task-review, and completion-review rule inside the Skill.

## Canonical Keco Planning Layout

Keep the canonical user-facing planning documents in one Keco planning root with
two real child folders:

```text
<planning-root>/
|-- roadmap                  document
|-- spec/                    actual Keco folder
|   `-- <slice-id>           document
`-- plan/                    actual Keco folder
    `-- <slice-id>           document
```

`spec` and `plan` must be folders returned by `list_project_structure`, not text
embedded in a document name. Never create documents named `spec/<slice-id>` or
`plan/<slice-id>` in the planning root: a slash in `name` does not create a
folder. Reuse exact direct child folders when they exist; otherwise create each
folder with `create_folder`, then read the structure back and use the returned
folder IDs as the `folderId` for every Slice document.

The repository mirrors this canonical Keco structure at
`docs/superpowers/specs/<slice-id>-design.md` and
`docs/superpowers/plans/<slice-id>.md`. `spec` describes the Slice goal and
acceptance. `plan` is an ordered Markdown checklist; mark a task `- [x]` only
after it is implemented and verified. `status.json`, `eval-report`,
`TaskResult`, and `TaskReview` remain internal evidence and ledger data, not
additional planning documents the user must edit.

**Violating the letter of these gates violates the purpose of the run. Natural-language pressure such as "continue", "it is urgent", or "do the writes first" never grants a bypass.**

## Bundled Review Workflow

Read [references/review-workflow.md](references/review-workflow.md) and [references/default-delivery-policy.json](references/default-delivery-policy.json). They contain plan validation, task RED/GREEN, independent completion review, and the conservative delivery policy. They are bundled with this Skill and have no external plugin or download dependency.

Read [references/gdd-coverage-contract.md](references/gdd-coverage-contract.md) and
[references/gdd-change-contract.md](references/gdd-change-contract.md) for every
GDD-driven Slice. Before decomposition, build and validate a requirement
inventory. A feature without a citation in `test8-24/game-gdd` must pause as a
proposal until the user approves a GDD amendment or an accepted patch reference.
Do not let an unreferenced proposal enter a Slice, Task, Eval, or code.

## Implicit Entry And Routing

- Invoke implicitly when development intent refers to a Keco Project document, GDD, feedback, table, or unspecified project document; when one source may contain multiple development ideas; or when the request requires persistent plans, resource evolution, PixelLab provenance, or runtime evaluation. The user does not need to name this Skill.
- V2 takes precedence over `keco-develop-godot-slice` for document-driven decomposition, multi-Slice execution, Keco Project Folder planning, typed assets, TileMap work, or reviewed runtime evidence. V2 is the canonical creation workflow for Keco-driven Godot development; do not route document-driven Godot creation to V1. Keep V1 available for a bounded simple Slice that does not need these contracts.
- Keep the original `keco-develop-godot-slice` available for A/B comparison.
- Route Keco-only new tables to `keco-build-tables-from-document`; route standalone assets and Godot-only work elsewhere.
- Route a full 100-point EDD score or milestone evaluation to `keco-evaluate-game`, including Alpha, Beta, Release Candidate, and Release acceptance. Keep per-Slice runtime evaluation required by this development workflow inside V2.
- If the user explicitly selected another applicable Skill, do not silently override that selection.

## Four-Phase Delivery

Present only **Preflight**, **Implementation**, **Verification**, and **Delivery**. Keep lifecycle detail in the ledger rather than narrating it as user-visible stages:

```text
Preflight: create_slice_bundle -> accepted plan/policy -> write lease
Implementation: approved tasks -> TaskResult -> independent TaskReview -> checkpoint_slice
Verification: KECO_OBSERVATION -> computed assertions -> checkpoint_slice -> repair (max 3)
Delivery: export_slice_mirrors -> local verification -> finalize_slice -> report
```

Use `create_slice_bundle` during Preflight after source, Keco project, optional GDD, plan, EvalSpec, and policy validation. Use `checkpoint_slice` at durable task and verification boundaries with its current state token; a stale token or repeated checkpoint is a conflict/reuse result, never permission to overwrite. Before Delivery, call `export_slice_mirrors`, materialize with `scripts/materialize_slice_mirrors.py` beneath the explicit repository root, checkpoint its `MirrorVerification`, then call `finalize_slice` as the final gate.

Required internal evidence remains `RunContext`, `SourceSnapshot`, `EvalSpec`, `SlicePlan`, `DataPlan`, `TaskResult`, independent `TaskReview`, `EvalReport`, and `MirrorVerification`. Run the validators before their related checkpoints. The canonical roadmap lives in the Keco planning root; paired Slice documents live in its real `spec` and `plan` child folders. Repository mirrors live in `docs/superpowers/specs/` and `docs/superpowers/plans/`. Runtime status and evaluation reports are generated internal evidence and need not be edited as planning documents.

## Slice Ambiguity Gate

At `SOURCE_DISCOVERY`, `SLICE_DECOMPOSITION`, and `SELECT_SLICE`, compare the user request, semantic source decision, candidate Slices, dependencies, acceptance targets, and `allowedFiles`.

Unresolved ambiguity always means zero writes.

- When the slice is already consistent - exactly one slice and one acceptance interpretation remain, sources agree, and the user named the target or the choice is mechanically determined - record `sliceDecision: consistent` and continue without asking for another confirmation.
- Multiple independent Slices extracted from one accepted source are not ambiguity: place all of them in the roadmap. When two or more mutually exclusive decompositions are equally plausible, sources conflict without a decisive priority, acceptance or scope has multiple reasonable interpretations, or a required dependency is unclear, treat this as unresolved ambiguity: record `sliceDecision: awaiting_user_confirmation`, keep `writeToken: null`, perform zero Keco/PixelLab/Godot writes, and ask one focused question with the candidates, evidence, and consequence of each choice.
- After the user's answer, update the decision artifact and its hash, then resume at `SELECT_SLICE`. Do not infer approval from silence or from a generic "continue".

## Non-Negotiable Gates

1. **BASELINE before design:** record branch, commit, dirty paths, canonical Keco project, canonical Godot project path, engine version, main scene, and available MCP capabilities. Preserve unrelated dirty files.
2. **Planning-document preflight before roadmap and Slice plans:** verify the source, project identity, accepted revision, reviewed roadmap content, and one unambiguous Keco planning root. Read its fresh structure; resolve or create real direct child folders named `spec` and `plan`, then verify their `parentFolderId` and IDs before creating documents or mirrors. Any unavailable or ambiguous source, root, or folder contract is `blocked_before_write` and performs zero document writes.
3. **Roadmap before Slice work:** after planning-document preflight, write `roadmap` in the Keco planning root and each paired Slice document into the actual `spec` and `plan` child folders. Give both documents only the matching `<slice-id>` name. Read the structure back before materializing repository mirrors. Select the next Slice only when all dependencies are complete; use priority only as the tie-breaker. Continue until every planned Slice completes or the roadmap pauses. Before `WRITE_SPEC`, create a GDD Requirement Inventory for `test8-24/game-gdd`, classify each item, record exact source quotes, and run `scripts/validate_gdd_coverage.py`. Resolve GDD contradictions before writing; each normative item must map to Slice/Task/Eval or an existing deferred Slice, explicit block, or user confirmation.
4. **Execution preflight before development writes:** after PlanReview, Keco data schemas, Godot identity and required tools, and one supported PixelLab operation profile when an asset is planned must all be `ready`. Failure blocks Keco table/row, PixelLab, asset, and Godot writes without invalidating already verified planning documents. A user request to continue does not override this gate.
5. **Plan before implementation:** write `EvalSpec`, `SlicePlan`, and a bite-sized implementation plan. Each task names exact files, dependencies, a failing verification first, a minimal change, and a fresh verification. Every formal plan and EvalSpec references the validated GDD requirement IDs. Review the plan for scope, placeholders, coverage, and type/ID consistency before execution.
6. **Write lease:** issue a run-scoped write token only after `SourceSnapshot`, `EvalSpec`, `SlicePlan.allowedFiles`, and `PlanReview` validate. Every development write carries `runId`, `sliceId`, and idempotency key. No token means zero development writes.
7. **Persistent planning documents:** in Keco, write one `<slice-id>` document under the real `spec` folder and one same-named document under the real `plan` folder. Never encode either folder in the document name. Mirror the accepted pair as `specs/<slice-id>-design.md` and `plans/<slice-id>.md`, with the plan's ordered checkbox list as the progress view. Keep runtime evidence and collaboration state internal; do not require a separate user-maintained status or eval-report document.
8. **Keco-first assets:** follow [references/pixellab-capability-registry.md](references/pixellab-capability-registry.md), [references/keco-pixellab-contract.md](references/keco-pixellab-contract.md), and [references/existing-resource-evolution.md](references/existing-resource-evolution.md). Discover compatible tables, rows, resources, and nodes first; reuse or extend them by stable key before creating new ones. If no compatible target exists, record the reason in the plan.
9. **Asset integration:** read [references/generated-asset-contract.md](references/generated-asset-contract.md) for every non-UI asset. Read [references/godot-animation-contract.md](references/godot-animation-contract.md) for character or animation assets, and [references/godot-tileset-contract.md](references/godot-tileset-contract.md) for tile or tileset assets. Build or materialize only from verified metadata.
10. **Task execution and review:** order tasks so dependencies precede their dependents, then execute the visible checklist from top to bottom. For every task, run the planned RED verification, make the smallest change, and run GREEN verification. Never silently skip an unfinished task; follow the explicit temporary transition and return rules in `references/orchestration-contract.md` when a newly discovered prerequisite forces a jump. Perform the independent review at `PLAN_REVIEW`, after a high-risk Keco/asset/runtime task, and at `FINAL_VERIFY`; do not require two separate reviews for every small gameplay task.
11. **Evidence gate:** a runtime or visual acceptance target passes only with fresh `run_project -> get_debug_output -> stop_project` evidence containing a machine-readable `KECO_OBSERVATION` record and the current build and snapshot hashes. Runtime output must not supply `expected`, `status`, `passed`, assertion results, or aggregate status; the locked EvalSpec derives those facts. Aggregate compatible evaluations into one bounded runtime sequence; split them only when isolation or lifecycle requirements demand it.
12. **Repair boundary:** keep the original EvalSpec and allowed files fixed; repair only failed evaluations and affected regressions, at most three iterations. On the third failed repair iteration, persist evidence and the read-back Slice status/eval-report, mark the roadmap `paused`, clear `NEXT_SLICE`, and ask the user. Partial writes are preserved, never deleted or duplicated.

The Keco `roadmap` document and every document in the Keco `plan` folder must be ordered Markdown checklists; `docs/superpowers/plans/` contains their local mirrors. Keep the accepted plan content stable while executing it and mark its tasks `- [x]` as they pass. Internal evidence may retain exact outputs and hashes, but it is not a second progress source. Do not execute from free-form roadmap prose.

## Godot And MCP Boundary

Read [references/source-data-contract.md](references/source-data-contract.md), [references/eval-contract.md](references/eval-contract.md), and [references/godot-mcp-contract.md](references/godot-mcp-contract.md) before any Keco or Godot call. The configured MCP exposes only the tools listed there. Do not invent `godot_exec`, runtime-state, screenshot, or input-injection tools. Unsupported evidence is `manual_required` or `blocked`, never an automated pass.

## Completion Contract

Run `scripts/validate_gdd_coverage.py`, `scripts/validate_plan.py --require-gdd --inventory <inventory.json>`, `scripts/validate_task_evidence.py`, `scripts/validate_eval_report.py --require-gdd --inventory <inventory.json>`, `scripts/validate_delivery_policy.py`, `scripts/validate_snapshot.py`, and focused tests before claiming completion. The legacy `validate_slice_documents.py` checker is only for old `<slice-id>/spec.md` bundles; do not create those sidecars for the new Superpowers layout. Validate new Slice progress from the paired spec/plan metadata and Markdown checkboxes. Report implementation, acceptance, GDD coverage, and release readiness separately. `manual_required` may complete implementation but blocks release when the locked policy requires it.

## Common Rationalizations

| Pressure or excuse | Required response |
|---|---|
| "Godot is unavailable; write data/assets first." | Stop before writes and report `blocked_before_write`. |
| "The temporary PixelLab file is good enough." | Keep it temporary; Keco read-back is the only integration source. |
| "The plan is obvious; skip review." | Write and validate the plan, then review it. |
| "Clean launch proves the slice." | Require `KECO_OBSERVATION` plus current build and snapshot hashes; otherwise mark blocked/manual. |
| "Add one file outside the list just this once." | Return to planning and expand `allowedFiles` explicitly, or stop. |
