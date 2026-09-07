---
name: keco-develop-godot-slice-v2
description: Use when a user asks for Keco-driven Godot planning, implementation, continuation, evaluation, typed assets, TileMap work, or multi-Slice delivery. This is the only active Godot Slice workflow.
---

# Keco Godot Slice V2

V2 is the canonical creation workflow for document-driven Godot creation.

This public entry is a thin router. Before expensive or mutating work, read the
[shared interaction contract](../../references/interaction-contract.md), then
summarize Goal, Source, Scope, Success, and Next in the user's language. Keep
progress to Completed, Current, Next, and Blocker; keep IDs, hashes, write
tokens, raw MCP arguments, and evidence in machine artifacts.

## Routing and lifecycle

Use V2 for every new Keco-driven Godot Slice request, including GDD, feedback,
table, ordinary document, and direct user idea sources. Routing is implicit and
document-driven. Select exactly one SourceProfile with `contractVersion: 2`;
no new run routes to a legacy workflow. Do not invoke the table-creation
Skill for a Godot Slice or this Skill for Keco-only tables or unrelated Godot
work. Keco-only tables, standalone assets, and independent EDD scoring keep
their specialized skills.
SourceProfile kinds are `gdd`, `feedback`, `document`, `table`, and `user_idea`.
For kind `gdd`, load `gdd-coverage-contract.md`; asset plans load
`generated-asset-contract.md`, animation plans load `godot-animation-contract.md`,
and tileset plans load `godot-tileset-contract.md`.

Run these existing phases in order, loading one module at a time:

1. Preflight: source identity, planning-root/folder bindings, GDD/non-GDD coverage,
   decomposition, SlicePlan/EvalSpec, repository identity, lease, snapshot.
2. Assets: PixelLab capability, provenance, resource evolution, typed packages.
3. Implementation: dependency-ordered RED/GREEN tasks, immutable `allowedFiles`,
   TaskResult/TaskReview, review levels, checkpoints, pause/resume, successors.
4. Verification: fresh runtime observations, locked EvalSpec, EvalReport, repair
   ceiling, and separate implementation/runtime/acceptance/release status.
5. Delivery: policy gates, roadmap preparation, mirror export/materialization,
   recovery, read-back, MirrorVerification, delivery seal.

The router owns applicability, phase order, RunContext routing, blocker/resume,
and user-visible progress. `orchestration-contract.md` owns lifecycle state,
write lease, transitions, artifact ledger, and delivery ordering. Preflight owns
source, decision, coverage/change, decomposition, and document contracts; other
details stay with their phase modules. Exactly three planning documents are bound:
roadmap, spec, and plan. They are authoritative ordered checklists in Keco and
the repository Superpowers layout; each Slice plan is an ordered checklist. The router is
self-contained and uses the bundled contract corpus.

Keep the write token (`writeToken`) null until source, folder, project, planning hierarchy,
SlicePlan, EvalSpec, and PlanReview gates pass. Unresolved ambiguity is
`blocked_before_write` with zero writes; already consistent sources continue without asking,
and multiple independent Slices are not ambiguity. A fourth repair is
forbidden and `manual_required` blocks release. Review levels are database-derived:
same-actor review cannot be `independent_actor`; `separate_context` requires trusted context.

The orchestration contract records effective review level. The immutable delivery
sequence is `implementation_complete -> prepare_delivery -> export_slice_mirrors ->
materialize -> MirrorVerification -> finalize_slice(delivery) -> delivery seal`.
Read the [orchestration contract](references/orchestration-contract.md), its
[historical comparison note](references/ab-matrix.md), and the current phase
module's references before phase work. Planning-document preflight precedes
execution preflight. Repository mirrors are
`docs/superpowers/roadmap.md`, `docs/superpowers/specs/<slice-id>-design.md`,
and `docs/superpowers/plans/<slice-id>.md`; internal evidence includes
`status.json`, TaskResult, TaskReview, EvalReport, and MirrorVerification.

## Completion

Run validators from their owning module and the end-to-end chain:
`SourceProfile -> Requirement Inventory -> roadmap -> spec -> plan -> SlicePlan
-> EvalSpec -> TaskResult -> TaskReview -> KECO_OBSERVATION -> EvalReport ->
MirrorManifest -> MirrorVerification -> delivery seal`. Runtime pass/fail is
computed only from KECO_OBSERVATION and EvalSpec. Never claim success from a
clean launch or self-reported fields.
