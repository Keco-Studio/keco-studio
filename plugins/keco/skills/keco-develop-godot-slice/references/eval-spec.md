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
      - keco-eval-json
      - debug-output
    passRule: all
    manualRequired: false
```

Each requirement needs at least one evaluation. Each implementation file in the SlicePlan must serve an evaluation or a direct dependency.

## Types

| Type | Use | Preferred evidence |
|---|---|---|
| `state` | Values, inventory, dates, persistence | Parsed `KECO_EVAL` JSON from `get_debug_output` |
| `flow` | Dialogue, scene transition, death, reincarnation | Project-side bounded harness emitting ordered `KECO_EVAL` records; otherwise manual evidence |
| `regression` | Existing adjacent behavior | Same deterministic scenario used before |
| `visual` | Visibility, clipping, layout, appearance, UI style consistency | Generated-file checks plus manual inspection; this Godot MCP has no screenshot tool |
| `experience` | Pacing, clarity, feel | Explicit rubric and manual evidence |

Do not convert subjective experience into an objective pass. Do not infer a value from a screenshot when structured state exists.

## Evidence And Scoring

An evaluation passes only when every `passRule` condition has direct evidence from a fresh `run_project` execution and the game reports the expected snapshot hash in a `KECO_EVAL` record. Record expected and actual values. Treat parse success, write responses, ordinary debug prose, a clean launch, or a single function return as insufficient when the requirement describes a full player flow.

This Godot MCP provides no input injection, runtime-state query, time-step control, or screenshot tool. A project-side test/debug scene may exercise a named flow and emit `KECO_EVAL` records. Otherwise set `manualRequired: true`, retain only the evidence actually collected, and do not claim black-box input or visual coverage.

For PixelLab outputs, file type, dimensions, alpha, non-empty pixels, reference hashes, and output hash are automated evidence. Style consistency with the existing UI, readability in context, and integrated appearance remain `manualRequired: true`. A successful `create_s_xl_image_pro` response never passes a visual evaluation by itself.

After a repair, rerun the failed evaluation and every regression whose state owner, scene, input, or data table changed.
