---
name: keco-godot-slice-verification
description: Verify Keco Godot Slice V2 runtime observations, EvalSpec assertions, reports, repairs, and status gates.
---

# Keco Godot Slice Verification

Read the [shared interaction contract](../../references/interaction-contract.md) before mutating work.

Before expensive or mutating work, summarize Goal, Source, Scope, Success, and Next in the user's language. Keep progress to Completed, Current, Next, and Blocker; keep IDs, hashes, write tokens, raw MCP arguments, and evidence in machine artifacts.

Own run_project -> get_debug_output -> stop_project evidence, KECO_OBSERVATION parsing, locked EvalSpec assertions, current build/snapshot binding, runtime batches, EvalReport, the three-repair ceiling, manual-required blocking, and separate lifecycle statuses.

## References

- [eval-contract.md](references/eval-contract.md)
- [godot-mcp-contract.md](references/godot-mcp-contract.md)

## Scripts

- evaluate_runtime_observations.py
- validate_eval_report.py
- derive_slice_status.py

Use contractVersion 2 and the canonical manifest/corpus. Preserve Keco authority, immutable plan bindings, and the interaction contract. Do not route new work to a legacy workflow.
