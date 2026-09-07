---
name: keco-godot-slice-preflight
description: Run Keco Godot Slice V2 preflight for source identity, planning documents, coverage, decomposition, and snapshot validation.
---

# Keco Godot Slice Preflight

Read the [shared interaction contract](../../references/interaction-contract.md) before expensive or mutating work.
Summarize Goal, Source, Scope, Success, and Next
in the user's language; keep progress to Completed, Current, Next, and Blocker.
Machine artifacts retain IDs, hashes, write tokens, raw MCP arguments, and evidence. Preflight owns SourceProfile selection and hashes,
planning-root/direct-child discovery, roadmap/spec/plan bindings, GDD
Requirement Inventory, non-GDD rationale, multi-Slice decomposition,
SlicePlan/EvalSpec validation, repository identity, dirty paths, write-lease
gates, and fresh Keco snapshot export/validation.

## Conditional references

- [contract-manifest.json](references/contract-manifest.json)
- [orchestration-contract.md](../keco-develop-godot-slice-v2/references/orchestration-contract.md)
- [source-data-contract.md](references/source-data-contract.md)
- [slice-decision.md](references/slice-decision.md)
- [slice-document-contract.md](references/slice-document-contract.md)
- [spec-template.md](references/spec-template.md)
- [plan-template.md](references/plan-template.md)
- [multi-slice-orchestration.md](references/multi-slice-orchestration.md)
- [gdd-coverage-contract.md](references/gdd-coverage-contract.md)
- [gdd-change-contract.md](references/gdd-change-contract.md)

Always load source-data and slice-decision; GDD sources add gdd-coverage and
gdd-change, multiple Slices add multi-slice-orchestration, planning mutation adds
slice-document, and Spec/Plan authoring loads its canonical template. The
orchestration contract and contract manifest remain shared owners.

## Responsibilities inside Preflight

Requirement Extractor, Slice Decomposer, and Slice Contract Planner are prompt
responsibilities inside this existing phase, not new Skills, phases, model calls, or artifacts. Extractor produces the versioned Requirement Inventory; Decomposer
produces the existing roadmap and Slice decision; Planner produces the existing
spec, plan, SlicePlan, and EvalSpec. Keep exact mappings, locked EvalSpec,
templates, validators, and blocker behavior from the owning references.

## Validators

Run these existing scripts before any development write: `validate_run_context.py`,
`validate_contract_case.py`, `validate_plan.py`, `validate_gdd_coverage.py`,
`validate_slice_decomposition.py`, `export_keco_snapshot.py`,
`validate_snapshot.py`, and `slice_contract.py`. Use `contractVersion: 2`, the
canonical manifest/corpus, Keco authority, immutable plan bindings, and the
interaction contract. Do not route new work to a legacy workflow.
