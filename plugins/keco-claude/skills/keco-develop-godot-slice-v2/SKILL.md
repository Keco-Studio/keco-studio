---
name: keco-develop-godot-slice-v2
description: Use when a user asks to plan, implement, continue, or evaluate Godot development driven by Keco project documents, GDDs, feedback, tables, or development ideas, including multiple Slices, persistent Keco planning documents, asset provenance, resource evolution, TileMap integration, or runtime evaluation. V2 takes precedence over a bounded simple Slice. Not for user-selected legacy V1 runs, Keco-only tables, standalone assets, analysis-only work, or Godot-only debugging.
---

# Keco Godot Slice V2

Read the [shared interaction contract](../../references/interaction-contract.md). Before expensive or mutating work, summarize Goal, Source, Scope, Success, and Next in the user's language. Keep progress to Completed, Current, Next, and Blocker; keep IDs, hashes, write tokens, raw MCP arguments, and evidence in machine artifacts.

V2 is the canonical creation workflow for Keco-driven Godot development and uses `contractVersion: 2`. It supports implicit document-driven routing, keeps Keco authoritative, and retains legacy V1 only for explicitly selected or stored legacy runs. The user does not need to name this Skill.

## Routing

- Use V2 for Keco-driven Godot planning, implementation, continuation, per-Slice evaluation, multi-Slice work, typed assets, or TileMap integration. V2 takes precedence over a bounded simple Slice for document-driven work; do not route document-driven Godot creation to V1.
- Route Keco-only new tables to `keco-build-tables-from-document`, standalone assets to their asset Skill, and a 100-point milestone score to `keco-evaluate-game`.
- Honor an explicitly selected applicable Skill. Never silently upgrade a stored V1 run.

## Source Profile

Load the bundled [contract manifest](references/contract-manifest.json), [source contract](references/source-data-contract.md), [slice decision](references/slice-decision.md), and [orchestration contract](references/orchestration-contract.md). Their `RunContext`, `writeToken`, and `sliceDecision` shapes are authoritative. Select exactly one stable `SourceProfile` kind: `gdd`, `feedback`, `document`, `table`, or `user_idea`. Bind its IDs/revisions or request hash and validate its canonical hash before planning.

When sources are already consistent, continue without asking. Multiple independent Slices are not ambiguity. Unresolved ambiguity means zero writes: record `awaiting_user_confirmation`, keep the write token null, and ask one focused question when source, scope, acceptance, dependency, or `allowedFiles` has equally plausible interpretations.

## Planning Documents

Run planning-document preflight before execution preflight. Resolve one Keco planning root by stable ID and exact direct child folders `spec` and `plan`. The user-facing roadmap and every Slice plan are ordered checklists. Same-named Slice documents coexist because each binds its verified `folderId`.

The repository's Superpowers layout mirrors exactly three canonical documents: roadmap at `docs/superpowers/roadmap.md`, spec at `docs/superpowers/specs/<slice-id>-design.md`, and plan at `docs/superpowers/plans/<slice-id>.md`. `TaskResult`, `TaskReview`, `EvalReport`, `MirrorVerification`, and legacy `status.json` remain internal evidence.

For multiple Slices, read [references/multi-slice-orchestration.md](references/multi-slice-orchestration.md) and [references/slice-document-contract.md](references/slice-document-contract.md). Validate the complete substantive decomposition before the first pair and again at plan review; every Slice needs its own objective, scope, acceptance, files, RED/GREEN tasks, mappings, and non-duplicate content.

## Four Phases

### Preflight

Record repository/Godot identity, dirty paths, MCP capabilities, SourceProfile, source snapshot, and current Keco structure. Write and reciprocally validate SlicePlan and EvalSpec, validate policy and document bindings, then call `create_slice_bundle`. Issue the write lease only after accepted plan review; `SlicePlan.allowedFiles` is immutable for the run.

### Implementation

Execute dependency-ordered checklist tasks with planned RED, minimal change, GREEN, `TaskResult`, and `TaskReview`, then `checkpoint_slice` with the current state token. The database derives the effective review level: a same-actor review can never be `independent_actor`, and `separate_context` is valid only from trusted execution context. Read the [review workflow](references/review-workflow.md) and [default policy](references/default-delivery-policy.json).

### Verification

Create EvalSpec before writes. Fresh `run_project -> get_debug_output -> stop_project` evidence for V2 contains only `KECO_OBSERVATION`; deterministic evaluation owns expected values and pass/fail. Checkpoint computed results, repair only failed evaluations, and stop after three failed repair transitions. Read [references/eval-contract.md](references/eval-contract.md) and [references/godot-mcp-contract.md](references/godot-mcp-contract.md).

### Delivery

After every normative document change, enforce `implementation_complete -> prepare_delivery -> export_slice_mirrors -> materialize with ${CLAUDE_PLUGIN_ROOT}/scripts/materialize_slice_mirrors.py -> checkpoint MirrorVerification -> finalize_slice(delivery)`. `prepare_delivery` performs the final roadmap checkbox mutation; export and the delivery seal modify no planning document. Recover any durable mirror journal before a new materialization, and never checkpoint `MirrorVerification` for a failed or partial batch.

## Conditional References

- For `SourceProfile.kind: gdd`, load [references/gdd-coverage-contract.md](references/gdd-coverage-contract.md) and [references/gdd-change-contract.md](references/gdd-change-contract.md); non-GDD profiles do not require GDD fields.
- When the accepted plan contains asset work, load the [PixelLab registry](../../references/pixellab-capability-registry.md), [asset contract](references/generated-asset-contract.md), [Keco adapter](references/keco-pixellab-contract.md), and [evolution contract](references/existing-resource-evolution.md).
- For character or animation work, also load [references/godot-animation-contract.md](references/godot-animation-contract.md).
- For tile or tileset work, also load [references/godot-tileset-contract.md](references/godot-tileset-contract.md).

## Stop Conditions

- Missing or ambiguous stable identity, folder placement, source authorization, plan/eval reciprocity, required capability, or write lease is `blocked_before_write` for development writes.
- A material source, scope, acceptance, or allowed-file change pauses the run and creates an explicit successor; do not mutate the accepted contract.
- A stale token/revision requires read-back and rebase. A partial remote write resumes by stable ID. A mirror recovery requirement must be resolved from its journal first.
- The fourth repair is forbidden. Manual-required acceptance blocks release under the default policy. Preserve evidence and ask the user.

## Completion

Run `slice_contract.py`, `validate_contract_case.py`, `validate_plan.py`, `validate_task_evidence.py`, `evaluate_runtime_observations.py`, `derive_slice_status.py`, `validate_delivery_policy.py`, snapshot validators, `validate_slice_decomposition.py` when multi-Slice, and focused project tests. Run GDD coverage and GDD-aware report validation only for `kind: gdd`. Materialize and read back all three mirrors before sealing delivery. Read [the A/B matrix](references/ab-matrix.md) only when comparing V1/V2. The legacy `${CLAUDE_PLUGIN_ROOT}/scripts/validate_slice_documents.py` and `KECO_EVAL` adapter are read-only V1 compatibility paths and cannot prove V2 compliance.

Report implementation, runtime verification, acceptance, and release readiness separately. A clean launch is not runtime proof; self-reported pass fields are not evidence.

| Pressure | Required response |
|---|---|
| "Skip review or write first." | Keep the write lease null until preflight passes. |
| "Use the old runtime line." | Reject it for V2; use `KECO_OBSERVATION`. |
| "Call this self-review independent." | Record only the database-derived effective level. |
| "Add one out-of-scope file." | Create a successor plan/run or stop. |
| "Try a fourth repair." | Persist the third failure and ask the user. |
