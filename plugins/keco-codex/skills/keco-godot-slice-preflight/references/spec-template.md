# Slice Spec: `<slice-id>`

## Slice Identity

- sliceId: `slice-001`
- sourceMappings: `source-001`
- planRevision: `sha256:0000000000000000000000000000000000000000000000000000000000000000`

## Objective

One bounded, independently demonstrable outcome for this Slice.

## Scope

Included behavior and concrete exclusions.

## Technical Contract

### Inputs

| inputId | name | source | type | required | constraints | default |
| --- | --- | --- | --- | --- | --- | --- |
| input-player-command | command | player input | enum | yes | `move_up|move_down|move_left|move_right` | none |

### Outputs

| outputId | name | type | shape | guarantees |
| --- | --- | --- | --- | --- |
| output-player-position | playerPosition | Vector2 | `{x:number,y:number}` | clamped to arena bounds |

### Parameters & Boundaries

| parameterId | name | type | allowed range or enum | boundary behavior |
| --- | --- | --- | --- | --- |
| parameter-speed | speed | number | `0 < speed <= 240` | reject non-positive or over-limit values |

### Module Interfaces

| interfaceId | provider | consumer | operation/signature | protocol or data contract |
| --- | --- | --- | --- | --- |
| interface-movement | PlayerController | ArenaState | `move(command: MoveCommand): MoveResult` | synchronous, deterministic |

### Error & Exception Scenarios

| errorId | condition | detection | response | observable result |
| --- | --- | --- | --- | --- |
| error-invalid-command | command is outside the enum | input validation | ignore command and emit diagnostic | position is unchanged; error is logged |

### State & Invariants

| invariantId | state or transition | invariant |
| --- | --- | --- |
| invariant-position-bounds | any movement transition | position remains within arena bounds |

## Acceptance Mapping

| acceptanceId | behavior | sourceMapping | evalId |
| --- | --- | --- | --- |
| acceptance-move | valid command moves player | source-001 | eval-001 |

## Out of Scope

- Multiplayer authority and persistence are excluded from this Slice.
