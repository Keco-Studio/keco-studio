# Existing Resource Evolution

Every new feature starts with discovery of compatible existing resources. The default operation is `reuse_exact`, then `extend_compatible`, then `migrate_additive`; `create_new` is allowed only when the discovery record proves that no compatible target exists or the user explicitly requests isolation.

The stable key is the join between an existing resource and its next additive revision; resolve it before any write.

## Keco tables and rows

1. Read current table names, semantic fields, stable match keys, row keys, and revisions from fresh Keco schemas.
2. Select the same-purpose table by stable semantic match, not by name alone.
3. Reuse the existing table ID and field IDs; add only compatible fields and upsert rows by the existing stable key.
4. Put additive changes in the DataPlan and preserve all unknown fields, rows, references, and user values.
5. Create a new table only with an explicit `noCompatibleTarget` reason and a recorded discovery snapshot.

Never create a second `Generated Assets`, `UI Assets`, `Development Slices`, or runtime configuration table merely because a new asset kind appears. Extend the table schema or use the existing parent/child asset tables. Never merge incompatible semantics silently; stop for a new decision instead.

## Godot resources and nodes

- Reuse an existing `SpriteFrames` resource and append missing animation states when sheet IDs, frame geometry, and naming policy are compatible.
- Reuse an existing `AnimatedSprite2D` node and add only missing state wiring; preserve node path, scripts, transforms, and user-authored animations.
- Reuse an existing `TileSet` and `TileMapLayer` when tile size and layout identity match; add terrain/atlas data additively and preserve existing sources.
- Create a new resource or node only when the target is absent, incompatible, or explicitly isolated by the SlicePlan. Record the exact reason and superseded path.

## Decision record

Every AssetPlan and SlicePlan records:

```yaml
evolution:
  strategy: reuse_exact|extend_compatible|migrate_additive|create_new
  targetTableId: existing-or-null
  targetResourcePaths: []
  stableMatchKey: Asset Key
  discoveryEvidence: []
  noCompatibleTarget: false
  reason: existing animation resource accepts a new state
```

If the target schema, resource type, tile layout, or stable key is ambiguous, set the decision to `awaiting_user_confirmation`, keep the write token null, and perform zero writes.
