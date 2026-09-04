---
name: keco-develop-godot-slice-v2
description: Use when a user asks for Keco-driven Godot planning, implementation, continuation, evaluation, typed assets, TileMap work, or multi-Slice delivery. This is the only active Godot Slice workflow.
---

# Keco Godot Slice V2

This public entry is a thin orchestrator. V2 is the canonical creation workflow. Before expensive or mutating work, read the [shared interaction contract](../../references/interaction-contract.md) and summarize Goal, Source, Scope, Success, and Next in the user's language. Keep progress to Completed, Current, Next, and Blocker.

Keep IDs, hashes, write tokens, raw MCP arguments, and evidence in machine artifacts.

## Routing and lifecycle

Use V2 for every new Keco-driven Godot Slice request, including GDD, feedback, table, ordinary document, and direct user idea sources. Routing is implicit and document-driven. The user does not need to name this Skill. Keco remains authoritative. Select exactly one SourceProfile and use contractVersion: 2; no new run routes to a legacy workflow. Do not invoke keco-build-tables-from-document for a Godot Slice, and do not invoke this Skill for Keco-only table creation or Godot work unrelated to Keco. Keco-only tables, standalone assets, and independent EDD scoring keep their existing specialized skills.

SourceProfile kinds are gdd, feedback, document, table, and user_idea. GDD plans load gdd-coverage-contract.md; asset plans load generated-asset-contract.md; animation plans load godot-animation-contract.md; tileset plans load godot-tileset-contract.md.

The selected SourceProfile kind: gdd uses gdd-coverage-contract.md; feedback, document, table, and user_idea use non-GDD rationale.

Run phases in order and load one module at a time:

1. keco-godot-slice-preflight: source identity, planning-root/folder bindings, GDD or non-GDD coverage, decomposition, SlicePlan/EvalSpec, repository identity, write lease, and snapshot.
2. keco-godot-slice-assets: PixelLab capability resolution, provenance, resource evolution, character/animation/SpriteFrames, tileset/TileMap, and typed package validation.
3. keco-godot-slice-implementation: dependency-ordered RED/GREEN tasks, immutable allowedFiles, TaskResult/TaskReview, review levels, checkpoints, pause/resume, and successor runs.
4. keco-godot-slice-verification: fresh runtime observations, locked EvalSpec assertions, EvalReport, repair ceiling, and separate implementation/runtime/acceptance/release status.
5. keco-godot-slice-delivery: policy gates, roadmap preparation, mirror export/materialization, journal recovery, read-back, MirrorVerification, and delivery seal.

The orchestrator owns routing, phase transitions, RunContext, blocker/resume behavior, successor runs, and user-visible progress. It does not duplicate artifact schemas. Keep the write lease null until preflight and accepted plan review pass; a material scope change creates a successor. A fourth repair is forbidden and manual_required blocks release.

The immutable delivery sequence is implementation_complete -> prepare_delivery -> export_slice_mirrors -> materialize -> MirrorVerification -> finalize_slice(delivery). A same-actor review can never be independent_actor; separate_context requires trusted context.

## Shared contracts

The canonical manifest and conformance corpus live in contracts/keco-slice-v2/. Module references provide focused guidance and must remain semantically identical in Codex and Claude. Every artifact declares its documented schema version and binds planRevision as a canonical SHA-256 digest. Plan and EvalSpec mappings are bidirectional; runtime pass/fail is computed only from KECO_OBSERVATION and EvalSpec.

The repository mirrors docs/superpowers/specs/<slice-id>-design.md and docs/superpowers/plans/<slice-id>.md. RunContext, writeToken, and sliceDecision are authoritative. Read references/slice-decision.md and the focused module references before phase work.

The roadmap, spec, and plan are authoritative ordered checklists.
Exactly three planning documents are bound: roadmap, spec, and plan.
Internal evidence includes status.json, TaskResult, TaskReview, EvalReport, and MirrorVerification.
Phases: Preflight, Implementation, Verification, Delivery.
Run planning-document preflight before execution preflight.
When identity or scope is unclear use blocked_before_write with zero writes. The effective review level is recorded in the bundled ledger; already consistent sources continue without asking. Unresolved ambiguity is blocked; multiple independent Slices are not ambiguity and are handled by the self-contained Superpowers layout and interaction checkpoint.

Read the [orchestration contract](references/orchestration-contract.md) and the [historical comparison note](references/ab-matrix.md) when routing or auditing a run.

Phase-specific contracts live with their owning modules: [preflight](../keco-godot-slice-preflight/SKILL.md), [assets](../keco-godot-slice-assets/SKILL.md), [implementation](../keco-godot-slice-implementation/SKILL.md), [verification](../keco-godot-slice-verification/SKILL.md), and [delivery](../keco-godot-slice-delivery/SKILL.md). The orchestrator keeps only routing and lifecycle references.

## Completion

Execute the validators from their owning module, then run the end-to-end chain SourceProfile -> SlicePlan -> EvalSpec -> TaskResult -> TaskReview -> KECO_OBSERVATION -> EvalReport -> MirrorManifest -> MirrorVerification. Report implementation, runtime, acceptance, and release readiness separately. Never claim success from a clean launch or self-reported fields. Retired V1 routes and validators are not part of the active workflow.
