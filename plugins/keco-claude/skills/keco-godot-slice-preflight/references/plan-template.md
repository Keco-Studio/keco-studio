# Slice Plan: `<slice-id>`

## Implementation Strategy

Describe the implementation order, the selected Godot/runtime boundary, and how each step consumes and produces the Spec interfaces.

## Dependency Graph

````text
```text
task-001 -> task-002 -> task-003
```
````

## Risk Register

| riskId | impact | likelihood | trigger | mitigation | fallback |
| --- | --- | --- | --- | --- | --- |
| risk-input-lag | high | medium | input event arrives during scene transition | queue one event and test transition boundary | discard event with diagnostic |

## Execution Constraints

- allowedFiles: `game/player.gd`, `tests/player_test.gd`
- prohibitedChanges: generated assets and unrelated scenes
- runtimeLimits: 60 fps target; movement command processed once per frame

## Task Checklist

- [ ] task-001: Define movement command and validation
  - Files: `game/player.gd`, `tests/player_test.gd`
  - Consumes: `input-player-command`
  - Produces: `interface-movement`, `output-player-position`
  - Depends on: none
  - Source mappings: `source-001`
  - Serves evaluations: `eval-001`
  - RED: `pytest tests/player_test.py -k invalid_command` (expected: fails)
  - GREEN: `pytest tests/player_test.py -k invalid_command` (expected: passes)
  - Verification: assert invalid commands leave position unchanged and emit one diagnostic
  - Review: spec required; quality required

## Delivery Checklist

- [ ] implementation complete
- [ ] runtime verification complete
- [ ] acceptance complete
- [ ] manual review policy satisfied
- [ ] package gate complete
- [ ] roadmap and mirrors sealed
