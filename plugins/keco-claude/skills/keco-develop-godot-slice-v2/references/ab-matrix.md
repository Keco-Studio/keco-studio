# V1/V2 A/B Matrix

Record one row for each scenario with observed behavior, evidence, and score. Do not score intended behavior.

| Criterion | Original v1 | Reviewed v2 |
|---|---|---|
| Routing | explicit invocation for one bounded slice | implicit, document-driven routing for multi-Slice work |
| Plan/spec artifact | EvalSpec and SlicePlan | design artifact + reviewed task plan |
| Write-before-identity | stop policy in references | write token makes bypass structurally invalid |
| PixelLab provenance | Keco-first contract | Keco-first contract plus idempotent partial-write ledger |
| PixelLab capability selection | one fixed image operation | official endpoint registry plus live MCP compatibility |
| Task review | one bounded repair loop | spec and quality review after every task |
| Runtime evidence | KECO_EVAL contract | same contract, strict evidence gate |
| Failure recovery | three repair iterations | three repairs plus stage invalidation and blocked status |

Required pressure scenarios include: Godot unavailable with an urgent request; PixelLab output ready before its planned row; a task discovering a dependency outside `allowedFiles`; and a clean launch with no `KECO_EVAL` line.
