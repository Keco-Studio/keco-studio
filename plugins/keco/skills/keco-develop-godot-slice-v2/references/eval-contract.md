# EvalSpec Contract

Create EvalSpec before any Keco, PixelLab, or Godot write. Every implementation file serves at least one evaluation. Each evaluation names a stable ID, source requirement, deterministic preconditions, action, expected values and tolerances, evidence, pass rule, and `manualRequired` state.

Use `state` for exact values, `flow` for bounded transitions, `regression` for adjacent behavior, `visual` for appearance/layout, and `experience` for subjective pacing/readability. State and flow pass only with fresh structured `KECO_EVAL` evidence. Visual and experience checks may remain `manual_required`; do not turn screenshots, file parsing, or agent judgment into objective runtime proof.

After repair, rerun the failed evaluation and every affected regression. Keep the acceptance criteria fixed. A report may be `passed` only when every required evaluation has direct evidence from a fresh run and the current snapshot hash; otherwise use `partial`, `failed`, or `blocked_before_write`.
