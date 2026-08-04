# Keco Data Design And Snapshot Contract

Use this contract in `DESIGN_DATA` and `EXPORT_SNAPSHOT`. Keco is authoritative; exported Godot JSON is a generated read-only projection.

## DataPlan

```yaml
version: 1
sourceSnapshot: SourceSnapshot
tables:
  - key: activities
    tableId: existing-uuid-or-null
    name: Activities
    operation: create-or-update
    sourceEvidence: []
    matchField: Activity ID
    fields:
      - key: activity-id
        label: Activity ID
        dataType: string
        required: true
        operation: keep
        sourceEvidence: []
    rows:
      - key: rest
        operation: create-or-update
        values:
          activity-id: rest
        references: {}
        sourceEvidence: []
blockers: []
warnings: []
```

Use plan-local lower-case hyphen keys and keep returned Keco UUIDs in a separate execution map. Every table and row requires a stable scalar match key. Preserve source evidence for tables, fields, rows, and relationships.

## Allowed Operations

- Create a domain table when no same-purpose table exists.
- Add compatible optional or required fields when all existing rows can satisfy them.
- Create or update rows by a stable match field.
- Add relationships after stable target table and row identities exist.
- Update table-owned values when a higher-priority source changes them.

Never automatically delete a table, field, or row. Never destructively change a populated field type. Never replace a compatible existing table merely to simplify execution. Put these needs in `blockers` and stop before writes.

Stop on the first Keco write failure. Retain completed IDs and re-read state before any retry. Do not delete partial work as rollback.

## Development Records

Maintain three tables with stable keys, creating them only when absent:

| Table | Match field | Purpose |
|---|---|---|
| Development Slices | Slice ID | Objective, state, source revisions, commit, snapshot hash |
| Evaluation Cases | Eval ID | Preconditions, action, expected result, evidence and pass rule |
| Evaluation Runs | Run ID | Actual result, evidence summary, commit, hash and iteration |

Keep these records separate from runtime configuration.

## Normalized Export Input

Write one normalized JSON input for `scripts/export_keco_snapshot.py`. Include `schemaVersion`, project identity, a caller-supplied stable `capturedAt`, source revisions, and sorted domain tables. Reference values use:

```json
{"targetTableKey":"resources","targetRowKeys":["food"]}
```

The exporter writes `manifest.json` and `tables/<table-key>.json`. Validate with `scripts/validate_snapshot.py` before editing gameplay code. Do not hand-edit generated output. If local output differs from a valid fresh export, replace it from Keco; never update Keco from local JSON.
