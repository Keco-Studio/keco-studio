# Map And Plan Version Separation

## Goal

Make generated map versions and saved plan versions independently numbered and
explicitly linked. A map image may be `Map V1` while later saved plans are
`Plan V2` and `Plan V3` without additional map images.

The UI must never infer a plan version from a map version number.

## Terminology

`Map`: the durable map project.

`Plan version`: an immutable snapshot of the map plan. Its sequence is scoped
to the map project and increments only when the user saves from the Plan UI.

`Map version`: an immutable generated map image and scene snapshot. Its sequence
is scoped to the map project and increments when a map generation is published.

`Binding`: the immutable association from one map version to the exact saved
plan version used for its generation.

`Draft`: the current editable map-revision payload. It persists through
autosave but has no visible `Plan Vn` label.

## Data Model

Keep `map_projects` as the root entity. Add immutable plan snapshots while
retaining `map_revisions` as the existing draft and generated-map storage:

```text
map_projects
  |- map_plan_versions
  |    |- plan_version_number
  |    |- plan JSON snapshot and source tuple
  |    `- immutable creation metadata
  |
  `- map_revisions
       |- map_version_number, present only for generated maps
       |- plan_version_id -> map_plan_versions.id
       |- mutable draft payload or immutable generated-map snapshot
       `- scene and generated assets
```

The migration creates `map_plan_versions`, adds nullable `map_version_number`
and `plan_version_id` to schema-v3 `map_revisions`, and adds uniqueness for
`(map_project_id, plan_version_number)` and non-null map version numbers. A
generated revision must have both a map version number and plan version ID.

Existing generated schema-v3 revisions are backfilled in chronological revision
order as `Map Vn`; their current `plan` payload is copied into a corresponding
immutable plan snapshot and then bound. Existing drafts remain editable and do
not receive visible Plan or Map version numbers until the user saves or
generates.

## Write Flow

1. Editing and autosaving retain their current 750ms debounced, compare-and-swap
   persistence on the active Draft. Autosave never creates a Plan version.
2. The Plan UI's explicit `Save plan` command validates the current Draft,
   stores the next immutable `Plan Vn` snapshot, and records the Draft save
   version used for that snapshot.
3. Generation is enabled only when the current Draft has not changed since its
   selected saved Plan snapshot. It creates the next `Map Vn`, stores the Plan
   snapshot ID on that generated revision, and then creates the next editable
   Draft as today.
4. Editing the next Draft and pressing `Save plan` creates `Plan Vn+1` even when
   no map is generated. Saving additional plans therefore does not advance the
   Map sequence.

The generation request carries the selected `planVersionId`. The server verifies
that it belongs to the map project and that its JSON payload equals the current
Draft before allocating the map version number.

## Read Flow And UI

The active selection is a generated map version and its immutable plan binding.

- The canvas badge reads `Map Vn` for the selected generated map.
- The left history menu lists generated entries as `MAP V1`, `MAP V2`, and so
  on. Selecting one loads its image and its bound plan snapshot in read-only
  mode.
- The right inspector reads `Map plan details` and shows the linked `Plan Vn`.
- The plan resource card in the conversation also shows the selected map
  version's bound `Plan Vn`.
- The active unsaved state is labelled `Draft`. Its explicit Save plan action is
  the only UI path that advances Plan numbering.

For example, `Plan V1` can generate `Map V1`; later `Plan V2` and `Plan V3` may
exist without a Map V2. Selecting `MAP V1` always shows its bound `Plan V1`.

## Compatibility And Error Handling

The read service verifies that the bound plan belongs to the same map project.
Missing or mismatched bindings produce a recoverable error rather than falling
back to a matching number.

Draft compare-and-swap remains unchanged. The save-plan and generation RPCs use
the Draft's expected save version; generation additionally rejects a saved plan
whose payload no longer matches the Draft. New UI-facing read models expose
both version numbers and immutable IDs.

## Tests

- Database migration tests cover backfill, uniqueness, and rejection of
  cross-project Plan bindings.
- Service tests verify explicit plan saves, independent Map numbering, and
  historical loading of the precise bound plan.
- Workbench and chat tests assert `Map Vn` and `Plan Vm` labels are derived from
  separate fields and that selecting `MAP Vn` changes both snapshots together.
- End-to-end coverage saves Plan V1, generates Map V1, then saves Plan V2 and
  Plan V3 without generating images; it asserts that history still loads
  `Map V1` with `Plan V1`.

## Non-Goals

- Do not alter image storage paths or asset content.
- Do not create map versions from autosave or Plan saves.
- Do not make historical Map-to-Plan bindings editable.
