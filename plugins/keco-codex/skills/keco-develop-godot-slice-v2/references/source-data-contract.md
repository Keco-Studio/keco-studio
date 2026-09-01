# Source, Data, And Snapshot Contract

## Source priority

Resolve material conflicts in this order: current user instruction, newest explicit Keco feedback, current GDD goals and acceptance criteria, Keco table values, then current Godot behavior. Record document revisions, table IDs, field IDs, row IDs, Git commit, branch, dirty paths, Godot version, main scene, canonical path, and addon status in `SourceSnapshot`. If a selected revision changes, invalidate the ledger and restart at `BASELINE`.

## Semantic source document discovery

Arbitrary source document names are supported. Do not require a fixed `Feedback` name, prefix, date format, or folder label. When the user supplies a stable `documentId`, verify that it belongs to the selected Project and read it in full. When the user supplies only a name, resolve duplicates before continuing. When the user supplies no document identity, call `list_project_structure` and page through `list_documents`, use `semantic_search` with `source: documents` when summaries are insufficient, then rank current candidates by semantic development relevance, user wording, GDD/feedback/requirements content, Project context, and revision evidence.

Recency or the latest timestamp is supporting evidence, not a selector alone. When exactly one candidate is clearly dominant, automatically select it and record its ID, title, revision, content hash, and selection evidence in `SourceSelection`. For tied candidates, set `sourceDecision: awaiting_user_confirmation`, keep `writeToken: null`, ask one focused question with at most three choices, and perform zero writes. If no relevant candidate exists, report the missing source and stop before writes.

After accepting the source, read the complete content needed for decomposition. Do not infer that a document is development input from its display name alone.

Before `WRITE_SPEC`, resolve the canonical Keco Project by stable project ID. User-facing Slice planning documents are repository files under `docs/superpowers/specs/` and `docs/superpowers/plans/`; do not create a Keco document named `spec/<sliceId>` or `plan/<sliceId>`, and do not require a Keco planning folder for them. Discover a Keco folder only when the selected Slice needs Keco data or internal runtime evidence, and record its identity separately in `SourceSnapshot` and `RunContext`.

## DataPlan

Use plan-local lower-case keys, but send only exact semantic field labels across the Keco MCP boundary. Resolve field labels and reference target row UUIDs from fresh schemas before every write. Use stable scalar match keys for every table and row. Discover and reuse compatible existing tables, fields, references, and rows before considering creation; extend schemas additively and upsert by stable key. Never automatically delete tables/fields/rows or destructively change a populated field type. Stop on the first write failure, retain IDs, and re-read before any retry.

Maintain separate development records: `Development Slices` keyed by `Slice ID`, `Evaluation Cases` keyed by `Eval ID`, and `Evaluation Runs` keyed by `Run ID`. Do not put evaluation state into runtime configuration tables.

## Snapshot

Export only fresh Keco read-back into deterministic JSON with schema version, project identity, capture time, source revisions, sorted tables, per-file hashes, and aggregate hash. Validate with the existing snapshot scripts before implementation. Generated snapshot files are read-only; never update Keco from edited local JSON. The running Godot project must report the loaded aggregate hash in each `KECO_EVAL` record.
