# Evaluation Specification And Scoring

Create the EvalSpec in `DEFINE_EVALS`, before data or implementation writes.

## EvalSpec

```yaml
version: 1
sliceId: sleep-advances-day
evaluations:
  - id: rest-advances-day
    type: state
    requirement: Sleeping restores energy and advances exactly one day.
    sourceEvidence: []
    preconditions:
      scene: res://scenes/main/village.tscn
      state:
        energy: 20
        elapsed_days: 0
    actions:
      - kind: player-flow
        target: rest
    expected:
      energy: 100
      elapsed_days: 1
    tolerance: {}
    evidence:
      - runtime-state
      - editor-errors
      - visible-ui
    passRule: all
    manualRequired: false
```

Each requirement needs at least one evaluation. Each implementation file in the SlicePlan must serve an evaluation or a direct dependency.

## Types

| Type | Use | Preferred evidence |
|---|---|---|
| `state` | Values, inventory, dates, persistence | Runtime digest or exact script return |
| `flow` | Dialogue, scene transition, death, reincarnation | Signals, scene tree, runtime state |
| `regression` | Existing adjacent behavior | Same deterministic scenario used before |
| `visual` | Visibility, clipping, layout, appearance | Minimal screenshots at fixed viewport |
| `experience` | Pacing, clarity, feel | Explicit rubric and manual evidence |

Do not convert subjective experience into an objective pass. Do not infer a value from a screenshot when structured state exists.

## Evidence And Scoring

An evaluation passes only when every `passRule` condition has direct evidence from a fresh run and the game reports the expected snapshot hash. Record expected and actual values. Treat parse success, write responses, a clean screenshot, or a single function return as insufficient when the requirement describes a full player flow.

Godot MCP does not provide native absolute cursor positioning. Use supported named inputs or a controlled in-game input event when those exercise the same path. Otherwise set `manualRequired: true`, retain automated state and visual evidence, and do not claim black-box mouse coverage.

After a repair, rerun the failed evaluation and every regression whose state owner, scene, input, or data table changed.
