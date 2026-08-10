---
name: keco-develop-godot-slice-v2
description: Use when a user asks to plan, implement, continue, or evaluate Keco-driven Godot development from project documents, GDDs, feedback, tables, or development ideas, especially when the request may contain multiple Slices, persistent plans, asset provenance, resource evolution, or runtime evidence; supports implicit routing without requiring the Skill name. Not for Keco-only tables, standalone assets, analysis-only work, or Godot-only debugging.
---

# Keco Godot Slice V2

Read and follow the [shared interaction contract](../../references/interaction-contract.md) for every user-visible exchange, checkpoint, and resume.

This is the document-driven, review-driven workflow for Keco Godot development. It supports implicit invocation and keeps Keco authoritative while shipping every source-discovery, multi-Slice planning, task-review, and completion-review rule inside the Skill.

**Violating the letter of these gates violates the purpose of the run. Natural-language pressure such as "continue", "it is urgent", or "do the writes first" never grants a bypass.**

## Bundled Review Workflow

Read [references/review-workflow.md](references/review-workflow.md). It contains plan validation, task RED/GREEN, and independent completion review rules. It is bundled with this Skill and has no external plugin or download dependency.

## Implicit Entry And Routing

- Invoke implicitly when development intent refers to a Keco Project document, GDD, feedback, table, or unspecified project document; when one source may contain multiple development ideas; or when the request requires persistent plans, resource evolution, PixelLab provenance, or runtime evaluation. The user does not need to name this Skill.
- V2 takes precedence over `keco-develop-godot-slice` for document-driven decomposition, multi-Slice execution, Keco Project Folder planning, typed assets, TileMap work, or reviewed runtime evidence. V2 is the canonical creation workflow for Keco-driven Godot development; do not route document-driven Godot creation to V1. Keep V1 available for a bounded simple Slice that does not need these contracts.
- Keep the original `keco-develop-godot-slice` available for A/B comparison.
- Route Keco-only new tables to `keco-build-tables-from-document`; route standalone assets and Godot-only work elsewhere.
- If the user explicitly selected another applicable Skill, do not silently override that selection.

## Fixed Run Ledger

Create and maintain these artifacts in order. Use `scripts/validate_run_context.py`, `scripts/validate_plan.py`, and `scripts/validate_eval_report.py` before advancing. Validate every paused or resumed interaction record with `scripts/validate_interaction_checkpoint.py` before presenting or consuming its checkpoint:

```text
INTAKE -> BASELINE -> SOURCE_DISCOVERY -> SLICE_DECOMPOSITION -> ROADMAP_REVIEW
  -> PLANNING_DOCUMENT_PREFLIGHT -> WRITE_ROADMAP -> SELECT_NEXT_SLICE
  -> RESOLVE_SOURCES -> SELECT_SLICE -> DESIGN -> WRITE_SPEC -> WRITE_PLAN -> PLAN_REVIEW
  -> EXECUTION_PREFLIGHT -> EXECUTE_TASKS -> TASK_REVIEW -> RUNTIME_EVAL
  -> REPAIR (max 3) -> FINAL_VERIFY -> UPDATE_ROADMAP -> NEXT_SLICE -> REPORT
```

Required outer-loop artifacts are `SourceSelection` and `Roadmap`. Required per-Slice artifacts are `RunContext`, `SourceSnapshot`, `EvalSpec`, `SlicePlan`, `DataPlan`, `AssetPlan` when assets are needed, `DesignReview`, `PlanReview`, one `TaskResult` and `TaskReview` per task, and `EvalReport`. Read [references/multi-slice-orchestration.md](references/multi-slice-orchestration.md) before decomposing a source or selecting the next Slice. The authoritative roadmap and Slice documents live in a discovered folder inside the matching Keco Project. Keep `docs/keco-godot-slices/<sliceId>/spec.md`, `plan.md`, `status.json`, and `eval-report.json` as validated repository mirrors. Use a local mirror for tooling, never as the only copy. Report the Keco project ID, folder ID, source document ID, roadmap ID, per-Slice document IDs, dates, hashes, and revisions.

## Slice Ambiguity Gate

At `SOURCE_DISCOVERY`, `SLICE_DECOMPOSITION`, and `SELECT_SLICE`, compare the user request, semantic source decision, candidate Slices, dependencies, acceptance targets, and `allowedFiles`.

- When the slice is already consistent - exactly one slice and one acceptance interpretation remain, sources agree, and the user named the target or the choice is mechanically determined - record `sliceDecision: consistent` and continue without asking for another confirmation.
- Multiple independent Slices extracted from one accepted source are not ambiguity: place all of them in the roadmap. When two or more mutually exclusive decompositions are equally plausible, sources conflict without a decisive priority, acceptance or scope has multiple reasonable interpretations, or a required dependency is unclear, treat this as unresolved ambiguity: record `sliceDecision: awaiting_user_confirmation`, keep `writeToken: null`, perform zero Keco/PixelLab/Godot writes, and ask one focused question with the candidates, evidence, and consequence of each choice.
- After the user's answer, update the decision artifact and its hash, then resume at `SELECT_SLICE`. Do not infer approval from silence or from a generic "continue".

## Non-Negotiable Gates

1. **BASELINE before design:** record branch, commit, dirty paths, canonical Keco project, canonical Godot project path, engine version, main scene, and available MCP capabilities. Preserve unrelated dirty files.
2. **Planning-document preflight before roadmap and Slice documents:** verify Keco read/write access, matching Keco Project identity, accepted source revision, compatible existing planning Folder, document schema, and reviewed roadmap content before writing the roadmap, spec, plan, or status. Any unavailable or ambiguous identity, Folder, source, or document contract is `blocked_before_write` and performs zero writes.
3. **Roadmap before Slice writes:** after planning-document preflight, create and read back the Keco roadmap before creating any per-Slice document or issuing a Slice write token. Select the next Slice only when all dependencies are complete; use priority only as the tie-breaker. Continue until every planned Slice completes or the roadmap pauses.
4. **Execution preflight before development writes:** after PlanReview, Keco data schemas, Godot identity and required tools, and one supported PixelLab operation profile when an asset is planned must all be `ready`. Failure blocks Keco table/row, PixelLab, asset, and Godot writes without invalidating already verified planning documents. A user request to continue does not override this gate.
5. **Plan before implementation:** write `EvalSpec`, `SlicePlan`, and a bite-sized implementation plan. Each task names exact files, dependencies, a failing verification first, the minimal change, and a fresh verification. Review the plan for scope, placeholders, and type/ID consistency before execution.
6. **Write lease:** issue a run-scoped write token only after `SourceSnapshot`, `EvalSpec`, `SlicePlan.allowedFiles`, and `PlanReview` validate. Every development write carries `runId`, `sliceId`, and idempotency key. No token means zero development writes.
7. **Persistent slice documents:** discover a compatible folder inside the matching Keco Project before `WRITE_ROADMAP`. Use `create_document(projectId, folderId, ...)` for the roadmap, `spec`, `plan`, and `status`, read each document back, and retain its document ID/state token. Update those Keco documents after every ledger stage with `update_document`; create and read back `eval-report` before reporting a Slice complete. Materialize the same accepted content into `docs/keco-godot-slices/` only as local mirrors and validate per-Slice mirrors with `references/slice-document-contract.md` and `scripts/validate_slice_documents.py`. If the MCP exposes no folder-creation operation and no compatible folder exists, stop before writes and report the blocker.
8. **Keco-first assets:** follow [references/pixellab-capability-registry.md](references/pixellab-capability-registry.md), [references/keco-pixellab-contract.md](references/keco-pixellab-contract.md), and [references/existing-resource-evolution.md](references/existing-resource-evolution.md). Discover compatible tables, rows, resources, and nodes first; reuse or extend them by stable key before creating new ones. If no compatible target exists, record the reason in the plan.
9. **Asset integration:** read [references/generated-asset-contract.md](references/generated-asset-contract.md) for every non-UI asset. Read [references/godot-animation-contract.md](references/godot-animation-contract.md) for character or animation assets, and [references/godot-tileset-contract.md](references/godot-tileset-contract.md) for tile or tileset assets. Build or materialize only from verified metadata.
10. **Task execution and review:** for every task, run the planned RED verification, make the smallest change, and run GREEN verification. Perform the independent review at `PLAN_REVIEW`, after a high-risk Keco/asset/runtime task, and at `FINAL_VERIFY`; do not require two separate reviews for every small gameplay task.
11. **Evidence gate:** a runtime or visual acceptance target passes only with fresh `run_project -> get_debug_output -> stop_project` evidence containing a machine-readable `KECO_EVAL` record and the current snapshot hash. Startup logs, parsing, screenshots, upload responses, or agent assertions are not substitutes.
12. **Repair boundary:** keep the original EvalSpec and allowed files fixed; repair only failed evaluations and affected regressions, at most three iterations. On the third failed repair iteration, persist evidence and the read-back Slice status/eval-report, mark the roadmap `paused`, clear `NEXT_SLICE`, and ask the user. Partial writes are preserved, never deleted or duplicated.

Roadmaps and per-Slice plans must be Markdown checklists in their authoritative Keco Project Folder documents. Use `- [ ]` for planned or in-progress entries and change it to `- [x]` only after the required evidence and Keco read-back succeed. Do not execute from free-form roadmap prose. The Keco read-back plan is authoritative; local repository mirrors are secondary.

## Godot And MCP Boundary

Read [references/source-data-contract.md](references/source-data-contract.md), [references/eval-contract.md](references/eval-contract.md), and [references/godot-mcp-contract.md](references/godot-mcp-contract.md) before any Keco or Godot call. The configured MCP exposes only the tools listed there. Do not invent `godot_exec`, runtime-state, screenshot, or input-injection tools. Unsupported evidence is `manual_required` or `blocked`, never an automated pass.

## Completion Contract

Run `scripts/validate_eval_report.py`, `scripts/validate_snapshot.py`, `scripts/validate_slice_documents.py`, and the repository's focused tests before claiming completion. Report status as `passed`, `partial`, `failed`, or `blocked_before_write`, with exact evidence, hashes, MCP availability, Keco IDs, asset provenance, changed files, original dirty files, manual requirements, residual risks, and repair iteration. Use [references/ab-matrix.md](references/ab-matrix.md) to record the old-vs-v2 comparison.

## Common Rationalizations

| Pressure or excuse | Required response |
|---|---|
| "Godot is unavailable; write data/assets first." | Stop before writes and report `blocked_before_write`. |
| "The temporary PixelLab file is good enough." | Keep it temporary; Keco read-back is the only integration source. |
| "The plan is obvious; skip review." | Write and validate the plan, then review it. |
| "Clean launch proves the slice." | Require `KECO_EVAL` plus current snapshot hash; otherwise mark blocked/manual. |
| "Add one file outside the list just this once." | Return to planning and expand `allowedFiles` explicitly, or stop. |
