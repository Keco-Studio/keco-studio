# Map And Plan Version Separation

## Goal

Make generated map versions and editable plan versions independently numbered and
explicitly linked. A map image may be `Map V1` while the plan used to generate it
is `Plan V2`.

The UI must never infer a plan version from the map version number.

## Terminology

`Map`: the durable map project.

`Plan version`: an immutable snapshot of the map plan. Its sequence is scoped to
the map project and increments when a plan is explicitly saved.

`Map version`: an immutable generated map image and scene snapshot. Its sequence
is scoped to the map project and increments when a map generation is published.

`Binding`: the immutable association from one map version to the exact plan
version used for that generation.

`Draft`: editable plan state not yet saved as a plan version. It has no `Vn`
label.

## Data Model

Keep `map_projects` as the root entity. Introduce two independent version
collections:

```text
map_projects
  |- map_plan_versions
  |    |- plan_version_number
  |    |- plan JSON snapshot
  |    |- source document tuple
  |    `- immutable creation metadata
  |
  `- map_revisions (renamed in application vocabulary to map versions)
       |- map_version_number (the existing revision number, scoped to map)
       |- plan_version_id -> map_plan_versions.id
       |- scene and generated assets
       `- immutable creation metadata
```

The database migration adds `map_plan_versions` and a non-null
`plan_version_id` foreign key on schema-v3 `map_revisions`. A unique key on
`(map_project_id, plan_version_number)` and an index on the binding make both
history lookups deterministic.

Existing schema-v3 map revisions migrate to one plan version per distinct
revision plan snapshot. Each revision is then bound to that migrated plan
version. Existing `revision_number` remains the map version number, preserving
existing map image and asset identifiers.

## Write Flow

1. Editing changes only the active draft and retains optimistic-concurrency
   protection for that draft.
2. An explicit plan save creates the next immutable `Plan Vn` snapshot and makes
   it the active saved plan.
3. Generating a map requires an active saved plan version. It publishes the next
   immutable `Map Vn`, writes the generated image and scene, and records that
   map version's `plan_version_id`.
4. Re-generating the same plan creates a new map version linked to the same plan
   version. Editing and saving creates a new plan version without changing any
   existing map binding.

The map-generation request carries both IDs. The server validates that both
belong to the same map project and rejects stale or mismatched bindings.

## Read Flow And UI

The active selection is a map version, not a mutable revision number.

- The canvas badge reads `Map Vn` for the selected generated map.
- The left history menu lists generated entries as `MAP V1`, `MAP V2`, and so
  on. Selecting one loads its scene/image and its bound plan snapshot.
- The right inspector reads `Map plan details` and shows `Plan Vn` from the
  selected map version's binding.
- The plan resource card in the conversation also shows the selected map
  version's bound `Plan Vn`.
- An unsaved draft is labelled `Draft`; it must not reuse or advance either
  visible version sequence.

For example, selecting `MAP V1` may show `Map V1` on the canvas and `Plan V2`
in the inspector. This is valid whenever Map V1 was generated from Plan V2.

## Compatibility And Error Handling

The read service supports migrated schema-v3 records during rollout and treats
missing or cross-project plan bindings as invalid data rather than falling back
to a matching number. The workbench shows a recoverable error instead of a
potentially incorrect plan.

Concurrent plan saves use compare-and-swap. Concurrent generation requests bind
only to the saved plan ID supplied by the caller; a later plan save cannot
silently change an in-flight map version's source.

MCP and API responses expose both `mapVersionNumber` and `planVersionNumber`,
plus their immutable IDs. The legacy generic `revisionNumber` is removed from
new UI-facing contracts or retained only as a deprecated alias for
`mapVersionNumber` during a compatibility window.

## Tests

- Database migration tests cover backfill, uniqueness, foreign keys, and
  rejection of mismatched map/plan bindings.
- Service tests verify independent numbering, repeat generation from one plan,
  and historical loading of the precise bound plan.
- Workbench and chat tests assert `Map Vn` and `Plan Vm` labels are derived from
  separate fields and that selecting `MAP Vn` changes both snapshots together.
- End-to-end coverage creates Plan V2, generates Map V1 from it, and asserts
  the canvas/history/inspector display `Map V1` with `Plan V2`.

## Non-Goals

- Do not renumber existing generated maps.
- Do not alter image storage paths or asset content.
- Do not make historical map-to-plan bindings editable.
