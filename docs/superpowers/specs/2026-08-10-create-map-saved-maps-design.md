# Create Map Saved Maps Design

## Goal

Make persisted Create Map projects discoverable and reopenable after a browser refresh. A user can browse recent maps across every Keco Project they can access, choose one explicitly, and restore its current editable workspace together with the latest generated PixelLab resources.

## Scope

This change covers:

- a compact Saved Maps list in the Create Map left panel;
- the 50 most recently updated accessible maps across all Projects;
- explicit click-to-open behavior after refresh;
- restoration of Map Plan, Map Scene, draft identity, source selection, generation state, and signed image URLs;
- safe switching between saved maps without losing an in-flight autosave or mixing assets between maps.

It does not add deletion, renaming, search, pagination, revision history, version comparison, deep links, automatic last-map restoration, map export, or changes to the existing persistence schema.

## Saved Maps List

The list appears as an unframed `Saved Maps` section in the left panel between the source controls and workflow. It uses the existing compact content-list styling rather than cards.

Each row displays:

- map name as the primary label;
- owning Keco Project name as secondary context;
- relative or compact last-updated time;
- a loading or selected state when applicable.

The list is ordered by `map_projects.updated_at DESC`, limited to 50 rows, and includes every map visible through existing Row Level Security. Refreshing Create Map shows the list but leaves the initial local preview in place until the user clicks a row.

While the active draft is dirty, creating, or saving, map rows are disabled. The user can switch after the autosave reaches `saved`. Clicking the already open map is a no-op.

## Data Contracts

`createMapService` gains a bounded saved-map summary query returning:

- map ID;
- Keco Project ID and name;
- map name;
- current Revision ID;
- updated timestamp.

The query reads `map_projects` and its related `projects` row through the authenticated Supabase client. Existing RLS remains the authority for visibility; no service-role list endpoint or new database policy is introduced.

Opening a map returns one workspace payload:

- current draft identity;
- validated current `MapPlan` and `MapScene`;
- source Project ID and Document ID;
- latest Revision for that map that owns asset rows;
- those asset records.

The current Revision remains the editable source of truth even when it has no assets. Generation assets normally belong to its published parent Revision, so the loader selects the highest `revision_number` belonging to the map that has asset rows. It never substitutes an older Revision's Plan or Scene for the current draft.

Both Plan and Scene pass through their existing strict schemas before reaching React state. Malformed persisted payloads fail the open operation rather than entering the editor.

## Workspace Restoration

The open action loads all required data before replacing visible workspace state. Once the payload is complete, the workbench atomically:

1. sets the source Project and Document selections;
2. replaces the Plan and creates a fresh editor state from the loaded Scene;
3. clears selection, Undo, Redo, mask, and transient generated-image caches;
4. installs the loaded draft identity and saved payload baseline;
5. hydrates generation rows from the latest asset-owning Revision;
6. creates fresh private-storage signed URLs and loads the corresponding browser images.

`useMapDraft` owns installing a loaded identity and resetting its `lastSaved` baseline so opening a map cannot autosave the previous workspace into the new map.

`useMapGeneration` owns restoring its target Revision, matching persisted asset records to the loaded Plan's asset definitions, deriving the phase, and resolving signed URLs. If the map has no generated assets, it returns to the normal `idle` / `unplanned` state.

Async opens use a monotonically increasing request token. If the user starts a second open before the first finishes, only the newest result may update state. Old signed-URL or image-load completions are ignored after a map switch.

## Error Handling

- List failure shows a compact retryable error in the Saved Maps section and does not affect the editor.
- Open failure leaves the current Plan, Scene, draft identity, and generation state unchanged.
- A missing current Revision, malformed Plan or Scene, inaccessible source Project, or RLS denial produces a clear load error.
- A missing asset Revision is valid and restores the map with unplanned resources.
- Failure to sign one generated asset URL preserves that asset's persisted status but reports it as unavailable for rendering; other assets still load.
- Map switching is disabled during dirty, creating, saving, or conflict states. A conflict must be resolved through the existing Reload or Save as new revision actions first.

## Testing

Development follows red-green cycles covering:

- service summary ordering, 50-row bound, Project labels, and RLS-scoped visibility;
- selection of the current Revision for Plan/Scene and the newest asset-owning Revision for resources;
- strict validation of loaded Plan and Scene;
- draft installation without an accidental autosave;
- generation hydration, phase derivation, fresh signed URLs, and no-assets fallback;
- list rendering, disabled switching during autosave, selected/loading states, and failed-open preservation;
- stale request and stale image-load rejection;
- browser refresh followed by opening an existing real map and rendering its retained PixelLab resources.

Real-data verification uses the retained maps and private PNG objects already in local Supabase. It must not delete or regenerate them.

## Acceptance Criteria

- Refreshing `/create-map` shows up to 50 recent accessible maps across Projects without opening one automatically.
- Each row identifies both the map and its owning Project.
- Clicking a row restores the saved Plan, Scene, source selections, editable objects, and obstacles.
- The latest generated assets for that map receive fresh signed URLs and render without leaking images from the previously open map.
- A map without generated assets opens with `Not prepared` resources and remains generatable.
- Dirty or saving work cannot be replaced by a map switch.
- Failed and stale opens never partially replace the active workspace.
- Existing autosave, generation, drag interaction, Create Map unit tests, typecheck, and local real-data records remain intact.
