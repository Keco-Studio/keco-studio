# Keco Slice V2 Planning Detail Contract

## Goal

Make every new or updated Keco Godot Slice V2 spec/plan pair precise enough to
implement without inference. The pair must state its inputs, outputs, parameter
boundaries, module interfaces, state invariants, exception behavior, task
dependencies, risks, and verification points in both human-readable Markdown
and machine-validatable data.

## Scope

This change applies to the Keco Godot Slice V2 planning lifecycle and its
repository mirrors:

```text
<planning-root>/
|-- spec/<slice-id>
`-- plan/<slice-id>

docs/superpowers/specs/<slice-id>-design.md
docs/superpowers/plans/<slice-id>.md
```

It covers the planning-document templates, the V2 `SlicePlan` contract, the
Markdown decomposition validator, the TypeScript/Python boundary validators,
the shared contract manifest and conformance corpus, and their Codex/Claude
plugin copies.

Existing historical documents and already accepted runs are not migrated or
revalidated. The stronger contract applies when a new V2 pair is created or an
existing pair is materially updated and accepted as a new plan revision.

## Non-Goals

- Changing the public V2 routing, source-profile kinds, Keco folder hierarchy,
  write-lease lifecycle, or delivery order.
- Replacing Keco as the authority for planning documents.
- Adding game-specific fields to Slices that do not use input, collision,
  animation, resource, or other corresponding behavior.
- Moving runtime status, TaskResult, TaskReview, EvalReport, hashes, or write
  tokens into user-facing planning documents.
- Automatically repairing vague historical plans.

## Current Gap

V2 already validates `SourceProfile`, `allowedFiles`, task ordering, RED/GREEN
commands, review requirements, and reciprocal Eval mappings in JSON. The
Markdown pair is checked only for broad headings, checkbox tasks, concrete
files, and RED/GREEN lines. A plan can therefore pass while leaving the
contract between a spec's behavior and a plan's implementation implicit. The
same information can also diverge between the Keco JSON payload and its local
Superpowers mirror.

## Design

### Two-Layer Contract

The accepted V2 bundle has two layers with one source of truth per concern:

1. `SlicePlan` JSON is the machine boundary. It contains the structured
   technical contract and task interfaces used by MCP, SQL, and offline
   validators.
2. The paired Markdown spec and plan are the user-facing projection. They use
   fixed headings and table columns so a validator can parse their IDs and
   compare them to the JSON payload.

The existing `schemaVersion: 2` and `contractVersion: 2` remain unchanged.
Technical-detail fields are required for all new or materially updated V2
plans; no compatibility branch is added for older documents.

### Spec Markdown Contract

Each Slice spec must contain the following headings. Heading matching is
case-insensitive and ignores punctuation, but each heading may occur only once.
The section body must contain at least one row with the required columns. An
empty table, prose-only section, or placeholder is invalid.

````markdown
## Slice Identity

- sliceId: `slice-001`
- sourceMappings: `source-001`
- planRevision: `sha256:...`

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
````

The following rules are normative:

- IDs are lower-case stable identifiers matching the V2 identifier grammar and
  are unique across the relevant section. `inputId`, `outputId`,
  `parameterId`, `interfaceId`, `errorId`, `invariantId`, and `acceptanceId`
  are the cross-document keys.
- `type`, `shape`, `constraints`, `operation/signature`, `protocol`,
  `response`, and `observable result` must be concrete non-empty values. A
  boundary must express a numeric range, an enum, a finite set, or an explicit
  unbounded rule; `any`, `TBD`, `TODO`, `as needed`, and `handle normally` are
  rejected.
- Required inputs must state either a default or `none`; optional inputs must
  state the default that is used when omitted.
- Every acceptance row must cite at least one `sourceMapping` and one `evalId`.
  Every EvalSpec evaluation must be cited by an acceptance row and served by a
  plan task.
- The spec's `sliceId`, source identity, plan revision, and allowed-file set
  are compared with the accepted plan and source profile. Markdown is a mirror,
  not an alternate scope.

### Plan Markdown Contract

Each Slice plan must begin with the implementation-planning sections below and
then contain one task block per JSON task, in dependency order.

````markdown
## Implementation Strategy

Describe the implementation order, the selected Godot/runtime boundary, and
how each step consumes and produces the Spec interfaces.

## Dependency Graph

```text
task-001 -> task-002 -> task-003
```

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
````

The task block is the Markdown projection of one JSON task. Its `Files`,
`Consumes`, `Produces`, `Depends on`, `Source mappings`, `Serves evaluations`,
RED/GREEN commands, and `Verification` values must match the corresponding
JSON fields. Task IDs must be unique, dependencies must form an acyclic
topological order, and every allowed file must be owned by at least one task.

### Structured SlicePlan Additions

The V2 `SlicePlan` gains a required `technicalContract` object. It is strict;
unknown keys are rejected. The shape is:

```yaml
technicalContract:
  inputs:
    - id: input-player-command
      name: command
      source: player input
      type: enum
      required: true
      constraints: move_up|move_down|move_left|move_right
      default: none
  outputs:
    - id: output-player-position
      name: playerPosition
      type: Vector2
      shape: "{x:number,y:number}"
      guarantees: clamped to arena bounds
  parameters:
    - id: parameter-speed
      name: speed
      type: number
      bounds: "0 < speed <= 240"
      boundaryBehavior: reject non-positive or over-limit values
  interfaces:
    - id: interface-movement
      provider: PlayerController
      consumer: ArenaState
      operation: "move(command: MoveCommand): MoveResult"
      protocol: synchronous, deterministic
  errors:
    - id: error-invalid-command
      condition: command is outside the enum
      detection: input validation
      response: ignore command and emit diagnostic
      observable: position is unchanged; error is logged
  invariants:
    - id: invariant-position-bounds
      state: any movement transition
      rule: position remains within arena bounds
  acceptance:
    - id: acceptance-move
      behavior: valid command moves player
      sourceMappings: [source-001]
      evalIds: [eval-001]

tasks:
  - id: task-001
    files: [game/player.gd, tests/player_test.gd]
    dependsOn: []
    servesEvaluations: [eval-001]
    sourceMappings: [source-001]
    consumes: [input-player-command]
    produces: [interface-movement, output-player-position]
    verification:
      assertions:
        - invalid commands leave position unchanged
        - one diagnostic is emitted
      observationPaths: [/player/position, /diagnostics/count]
    red:
      command: pytest tests/player_test.py -k invalid_command
      expected: fails
    green:
      command: pytest tests/player_test.py -k invalid_command
      expected: passes
    review:
      minimumLevel: self
```

The exact field names and value types are part of the contract. Collections are
non-empty where shown and all IDs are unique. `tasks[].consumes` may reference
input, parameter, interface, or invariant IDs; `tasks[].produces` may reference
output, interface, error, invariant, or acceptance IDs. Every technical ID
must be consumed by at least one task or acceptance mapping, so unused contract
rows cannot silently survive planning.

### EvalSpec Relationship

The existing EvalSpec remains the executable assertion contract. Its
`evaluations[].evalId` values must equal the IDs cited in
`technicalContract.acceptance[].evalIds` and in at least one task's
`servesEvaluations`. Evaluation assertion paths must be covered by the
acceptance behavior and task verification text. The validator checks IDs and
mapping presence; it does not infer runtime values from prose.

### SourceProfile Relationship

The existing source-profile rules remain authoritative. Every acceptance row
must cite a source mapping that is valid for the selected profile. GDD plans
continue to use the requirement inventory and reciprocal requirement mappings;
non-GDD plans continue to use `sourceProfileHash` and `nonGddRationale`. A
technical contract cannot introduce an uncited normative behavior for a GDD
source.

## Validation Architecture

### Markdown Validator

`validate_slice_decomposition.py` parses both Markdown documents and rejects:

- missing, duplicated, or empty technical sections;
- malformed table headers or rows;
- placeholder, generic, or boundary-free descriptions;
- missing acceptance-to-source/Eval mappings;
- missing strategy, dependency graph, risk, constraint, verification, or
  delivery sections;
- task blocks whose IDs, files, dependencies, mappings, RED/GREEN commands, or
  verification differ from the paired structured plan;
- duplicate or semantically indistinguishable Slices whose technical contracts
  are the same after ID normalization.

The decomposition bundle gains `planJsonPath` and `sourceProfilePath` fields so
the validator can load the exact structured artifacts used by
`validate_plan.py`. A bundle that supplies only Markdown is invalid for V2.

### JSON and Boundary Validators

`validate_plan.py` and `slice-v2-contract.ts` validate the same strict
`technicalContract` and task fields. The SQL/MCP schema uses the same additive
fields and rejects malformed payloads before acquiring or using a write lease.
The contract manifest records the field limits and a new reason code,
`SLICE_TECHNICAL_CONTRACT_INVALID`, for all technical-detail failures. Existing
scope failures remain `SLICE_PLAN_SCOPE_INVALID`; Eval reciprocity remains
`SLICE_EVAL_BINDING_INVALID`.

The conformance corpus includes accepted and rejected pairs for every new
boundary. TypeScript, Python, and database tests must classify each case with
the same accept/reject result and reason code.

### Cross-Document Consistency

Validation order is:

1. Validate SourceProfile and compute its canonical hash.
2. Validate structured SlicePlan and EvalSpec shape and reciprocal mappings.
3. Parse Spec and Plan Markdown.
4. Compare identity, source mappings, plan revision, allowed files, technical
   IDs, task fields, dependencies, Eval IDs, and verification references.
5. Run multi-Slice distinctness checks over normalized technical sections.

Any mismatch is a pre-write failure. The validator reports the first stable
reason code and includes the affected ID in the bounded diagnostic; it never
silently repairs one representation from the other.

## Failure and Recovery Rules

- Missing technical detail keeps `writeToken` null and blocks `create_slice_bundle`.
- A malformed or contradictory update creates no partial Keco document writes.
- A source, scope, acceptance, allowed-file, or technical-contract change
  after plan acceptance creates a successor plan revision under existing V2
  optimistic concurrency rules.
- Runtime evidence and repair limits are unchanged; technical-contract
  failures are planning failures, not repair iterations.
- Codex and Claude copies must be byte-equivalent for shared validators,
  references, templates, manifest, and conformance cases.

## Verification Plan

Tests are organized around the contract boundary rather than keyword counts:

1. Valid structured plan, Spec, Plan, and EvalSpec pass all validators.
2. Each required Spec section and each required Plan section fails when absent,
   empty, generic, or malformed.
3. Numeric, enum, finite-set, and explicit-unbounded parameter boundaries are
   accepted; missing or vague boundaries are rejected.
4. Input/output/interface/error/invariant IDs are rejected when unreferenced,
   duplicated, or referenced by an unknown task.
5. Task consumes/produces, files, dependencies, source mappings, Eval IDs,
   verification, and RED/GREEN values must match Markdown and JSON exactly.
6. Unknown Eval IDs, reverse mapping gaps, dependency cycles, and unowned files
   fail with stable existing reason codes.
7. Semantically duplicate multi-Slice technical contracts are rejected even if
   Slice IDs and prose are changed.
8. TypeScript, Python, SQL, Codex, and Claude conformance tests agree for every
   valid and invalid corpus case.
9. Historical fixture paths remain readable for non-mutating legacy tests, but
   every newly authored V2 fixture includes the technical contract.

## Acceptance Criteria

- A new V2 Slice cannot pass planning preflight without concrete inputs,
  outputs, parameter boundaries, module interfaces, exception responses,
  invariants, acceptance mappings, implementation strategy, dependencies,
  risks, constraints, and per-task verification.
- An engineer can implement each task using only its task block plus the
  referenced Spec rows, without inventing a function signature, data shape,
  boundary behavior, or failure response.
- Keco, repository Markdown mirrors, Python, TypeScript, and SQL either accept
  or reject the same bundle for the same reason.
- No historical Slice document or accepted run is rewritten by this change.
