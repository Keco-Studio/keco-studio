---
name: keco-godot-slice-preflight
description: Run Keco Godot Slice V2 preflight for source identity, planning documents, coverage, decomposition, and snapshot validation.
---

# Keco Godot Slice Preflight

Read the [shared interaction contract](../../references/interaction-contract.md) before mutating work.

Before expensive or mutating work, summarize Goal, Source, Scope, Success, and Next in the user's language. Keep progress to Completed, Current, Next, and Blocker; keep IDs, hashes, write tokens, raw MCP arguments, and evidence in machine artifacts.

Own SourceProfile selection, source hashes, planning-root and direct-child folder discovery, roadmap/spec/plan bindings, GDD Requirement Inventory, non-GDD rationale, multi-Slice decomposition, SlicePlan/EvalSpec validation, repository identity, dirty paths, write-lease gates, and fresh Keco snapshot export/validation. Run the scripts in this module before any development write.

## References

- [contract-manifest.json](references/contract-manifest.json)
- [orchestration-contract.md](../keco-develop-godot-slice-v2/references/orchestration-contract.md)
- [source-data-contract.md](references/source-data-contract.md)
- [slice-decision.md](references/slice-decision.md)
- [slice-document-contract.md](references/slice-document-contract.md)
- [multi-slice-orchestration.md](references/multi-slice-orchestration.md)
- [gdd-coverage-contract.md](references/gdd-coverage-contract.md)
- [gdd-change-contract.md](references/gdd-change-contract.md)

## Scripts

- validate_run_context.py
- validate_contract_case.py
- validate_plan.py
- validate_gdd_coverage.py
- validate_slice_decomposition.py
- export_keco_snapshot.py
- validate_snapshot.py
- slice_contract.py

Use contractVersion 2 and the canonical manifest/corpus. Preserve Keco authority, immutable plan bindings, and the interaction contract. Do not route new work to a legacy workflow.
