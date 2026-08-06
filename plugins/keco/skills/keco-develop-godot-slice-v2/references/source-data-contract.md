# Source, Data, And Snapshot Contract

## Source priority

Resolve material conflicts in this order: current user instruction, newest explicit Keco feedback, current GDD goals and acceptance criteria, Keco table values, then current Godot behavior. Record document revisions, table IDs, field IDs, row IDs, Git commit, branch, dirty paths, Godot version, main scene, canonical path, and addon status in `SourceSnapshot`. If a selected revision changes, invalidate the ledger and restart at `BASELINE`.

## DataPlan

Use plan-local lower-case keys, but send only exact semantic field labels across the Keco MCP boundary. Resolve field labels and reference target row UUIDs from fresh schemas before every write. Use stable scalar match keys for every table and row. Discover and reuse compatible existing tables, fields, references, and rows before considering creation; extend schemas additively and upsert by stable key. Never automatically delete tables/fields/rows or destructively change a populated field type. Stop on the first write failure, retain IDs, and re-read before any retry.

Maintain separate development records: `Development Slices` keyed by `Slice ID`, `Evaluation Cases` keyed by `Eval ID`, and `Evaluation Runs` keyed by `Run ID`. Do not put evaluation state into runtime configuration tables.

## Snapshot

Export only fresh Keco read-back into deterministic JSON with schema version, project identity, capture time, source revisions, sorted tables, per-file hashes, and aggregate hash. Validate with the existing snapshot scripts before implementation. Generated snapshot files are read-only; never update Keco from edited local JSON. The running Godot project must report the loaded aggregate hash in each `KECO_EVAL` record.
