# Source, Data, And Snapshot Contract

## SourceProfile and priority

Select exactly one version-2 `SourceProfile`: `gdd`, `feedback`, `document`, `table`,
or `user_idea`. Document profiles record project/document IDs, epoch, revision,
and content hash; table profiles record table ID, schema hash, selected row IDs/hashes,
and content hash; user ideas record request hash and bounded excerpt. Every profile records project ID,
capture time, selection evidence, and canonical `sourceProfileHash`.
Resolve material
conflicts as current user instruction, newest explicit Keco feedback, GDD
goals/acceptance, Keco table values, then current Godot behavior. Record
repository and Godot identity in `SourceSnapshot`; an identity change creates a
successor run.

## Semantic source discovery

Arbitrary source document names are supported: do not require a fixed Feedback
name, prefix, date, or folder. Verify a supplied ID belongs to the Project and
read it in full; with only a name, resolve duplicates. With no identity, page
`list_project_structure`/`list_documents`, use `semantic_search` with `source:
documents` when needed, and rank by semantic relevance, user wording,
GDD/feedback/requirements content, Project context, and revision evidence.
Recency supports but cannot select alone. Exactly one clearly dominant candidate: automatically select and record it.
Tied candidates require one focused question and zero writes; set
`sourceDecision: awaiting_user_confirmation` and keep `writeToken: null`. No
relevant candidate stops before writes. After acceptance, read the complete
authoritative content needed for decomposition; a display name never establishes
development input.

## Project, data, and snapshot

Before `WRITE_SPEC`, resolve the canonical Keco Project and planning root by
stable IDs; record `kecoProjectId`, `kecoFolderId`, `kecoSpecFolderId`, and
`kecoPlanFolderId`, folder names, document IDs, and revisions, then exactly one direct `spec` and `plan` child. Wrong parent,
duplicate, ambiguous root, or failed read-back is a pre-write blocker. Use exact semantic field labels,
stable scalar match keys, compatible-table reuse, additive schema changes,
and non-destructive writes; never automatically delete or change populated field
types destructively. Resolve labels and reference UUIDs from fresh schemas before
each write, upsert by stable key, stop on failure, and reread before retry. Keep
Development Slices, Evaluation Cases, and Evaluation Runs separate.

## Snapshot

Export only fresh Keco read-back as deterministic JSON with schema version,
project/source revisions, sorted tables, per-file and aggregate hashes; validate
before implementation. Snapshot files are read-only; never update Keco from edited local JSON. Godot reports the aggregate hash in every `KECO_OBSERVATION`.
