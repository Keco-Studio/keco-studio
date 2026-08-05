# Keco Godot Skill V1/V2 A/B Report

## Scope

This is an offline contract and pressure comparison. It does not claim a live Keco, PixelLab, or Godot run. The original skill remains `keco-develop-godot-slice`; the manual candidate is `keco-develop-godot-slice-v2`. V2 is self-contained on Windows and does not require the Superpowers plugin.

## Baseline RED observations

Under urgency, sunk-cost, and "continue anyway" pressure, the baseline tends to treat repository edits, PixelLab responses, or a clean Godot launch as progress toward a pass. The original skill documents the correct stop policy, but its long single ledger leaves more room for an agent to cross stages before a reviewer catches it.

## V2 GREEN contract

| Scenario | V1 documented behavior | V2 required behavior | Evidence |
|---|---|---|---|
| Godot unavailable, urgent request | stop policy exists but can be rationalized | `blocked_before_write`, write token stays null, zero service writes | skill + pressure fixture |
| PixelLab output before planned row | Keco-first asset contract | temporary-only result; planned row read-back is a hard gate | asset contract |
| Dependency outside allowed files | return to planning | task stops and plan is invalid until explicit re-plan | orchestration contract |
| Clean launch without `KECO_EVAL` | manual/unsupported caveat | cannot pass; report blocked/manual evidence | Godot contract |
| PixelLab operation mismatch | hard-coded legacy operation | official 15-capability registry resolves a live MCP tool as `exact`, `fallback`, or `unavailable` | PixelLab registry |
| Small-task review cost | two reviews implied per task | RED/GREEN per task; independent review at plan/high-risk/final checkpoints | local adaptation |

## Result

The v2 artifacts are present and statically testable. Live runtime confidence remains `blocked` until Windows has the refreshed plugin and the user runs a real Keco + PixelLab + Godot chain. This report intentionally does not convert static contract checks into runtime success.
