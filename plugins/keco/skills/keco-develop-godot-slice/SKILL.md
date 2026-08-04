---
name: keco-develop-godot-slice
description: Use when a user explicitly asks to implement or continue one Godot gameplay slice from Keco project GDDs, feedback, or tables and evaluate the running result; not for Keco-only table creation, analysis-only requests, asset generation, running existing tests only, or Godot work unrelated to Keco design sources.
---

# Develop A Godot Slice From Keco

## Overview

Turn Keco design sources into one bounded, evaluated Godot gameplay slice. Keep Keco authoritative, define evaluations before implementation, and use Godot MCP runtime evidence instead of ad hoc tool calls or visual guesses.

## Required Workflow

Copy and track this checklist:

```text
Keco Godot slice progress:
- [ ] CONNECT and DISCOVER
- [ ] RESOLVE_SOURCES and SELECT_SLICE
- [ ] DEFINE_EVALS and DESIGN_DATA
- [ ] EXPORT_SNAPSHOT and validate it
- [ ] IMPLEMENT and VERIFY_STATIC
- [ ] EVALUATE_RUNTIME and repair bounded failures
- [ ] REPORT exact evidence and retained work
```

1. Read all six files in `references/` completely before calling Keco or Godot tools: [source-priority.md](references/source-priority.md), [slice-plan.md](references/slice-plan.md), [data-plan.md](references/data-plan.md), [eval-spec.md](references/eval-spec.md), [godot-mcp-policy.md](references/godot-mcp-policy.md), and [recovery-policy.md](references/recovery-policy.md).
2. Execute this state machine in order: `CONNECT -> DISCOVER -> RESOLVE_SOURCES -> SELECT_SLICE -> DEFINE_EVALS -> DESIGN_DATA -> EXPORT_SNAPSHOT -> IMPLEMENT -> VERIFY_STATIC -> EVALUATE_RUNTIME -> REPAIR -> REPORT`.
3. Verify both MCP connections and stable Keco/Godot project identities before any write. Stop with zero writes when either identity is unavailable or mismatched.
4. Select one bounded slice. An explicit invocation authorizes that slice without a second confirmation; do not expand its scope.
5. Create the EvalSpec before changing Keco data or Godot files. Every implementation change must serve one accepted evaluation.
6. Design required Keco tables and rows through the DataPlan. Never automatically delete tables, fields, or rows, perform destructive type conversions, or copy local runtime state back into Keco.
7. After every successful Keco write sequence, paginate-read all affected tables again and refresh their IDs, revisions, updated timestamps, field labels, row values, and reference UUIDs. Only then export normalized data with `scripts/export_keco_snapshot.py`, validate it with `scripts/validate_snapshot.py`, and require the running game to expose the loaded snapshot hash.
8. Implement only `SlicePlan.allowedFiles`. Use Godot MCP in the fixed order from `godot-mcp-policy.md` and collect structured runtime evidence.
9. Repair only failed evaluations for at most three repair iterations. Rerun affected regressions after every repair.
10. Persist exact results and report failures, manual requirements, partial Keco writes, original dirty files, snapshot hash, and Godot evidence. Never infer success from writes, parsing, or screenshots alone.

## Routing Boundary

Do not invoke `keco-build-tables-from-document` from this workflow. Route Keco-only new-table requests to that Skill. Route analysis-only work and Godot work unrelated to Keco to their general workflows.

## Common Mistakes

| Mistake | Correction |
|---|---|
| Implement before defining observable success | Return to `DEFINE_EVALS` |
| Treat current code as newer design authority | Apply the source priority contract |
| Duplicate Keco values as GDScript constants | Regenerate and load the snapshot |
| Judge values from screenshots | Read runtime state |
| Continue repairing without a bound | Stop after three repair iterations |
| Claim mouse coverage without absolute input evidence | Mark the evaluation `manual_required` |
