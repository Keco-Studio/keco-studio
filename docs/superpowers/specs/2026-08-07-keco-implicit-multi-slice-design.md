# Keco Implicit Multi-Slice Orchestration Design

## Goal

Allow Keco Godot Slice V2 to activate implicitly for development requests, discover a semantically relevant source document without requiring a fixed name, decompose its ideas into multiple small Slices, and execute them sequentially with one clear Superpowers-style spec/plan pair per Slice.

## Scope

This change applies to Keco-driven Godot development requests that require persistent planning, multi-Slice decomposition, resource evolution, or runtime evaluation. Standalone art remains routed to its standalone workflow. A single simple Slice without persistent planning may remain on V1; V2 takes precedence when the request asks for document-driven decomposition or persistent Slice documents.

## Architecture

V2 becomes an implicit, document-driven orchestration entry point. The source document is selected by semantic discovery: read the current Keco Project document summaries, use the single clearly relevant candidate, and ask when candidates tie. The source document name is not fixed to `Feedback` or any other label.

The repository uses the existing Superpowers planning directories. Its user-facing document set is:

```text
docs/superpowers/specs/<slice-id>-design.md
docs/superpowers/plans/<slice-id>.md
```

For multiple Slices, the roadmap is another plan in `docs/superpowers/plans/`.
Each Slice keeps one paired spec and plan; the plan checklist is the progress
view. Status, evaluation, and collaboration evidence remain internal machine
artifacts rather than additional user-maintained documents.

## Execution Flow

```text
INTAKE -> SOURCE_DISCOVERY -> SLICE_DECOMPOSITION -> WRITE_ROADMAP
  -> SELECT_NEXT_SLICE -> DESIGN -> WRITE_SPEC -> WRITE_PLAN -> PLAN_REVIEW
  -> PREFLIGHT -> EXECUTE_TASKS -> TASK_REVIEW -> RUNTIME_EVAL
  -> REPAIR (max 3) -> FINAL_VERIFY -> UPDATE_ROADMAP -> NEXT_SLICE
```

The roadmap plan is written before Slice execution. Each Slice plan uses
checkbox tasks with exact files, dependencies, RED verification, minimal
implementation, and GREEN verification. The process executes all independent
or ordered Slices sequentially. A Slice that remains unsuccessful after three
repair iterations is marked paused in internal evidence and the roadmap plan,
then stops for user direction; it is not silently skipped.

## Source Discovery

When the user omits a document name or ID, list current project document summaries and rank candidates using title, content summary, development terms, recency as supporting evidence, and project context. Automatically select only one clearly dominant candidate. Multiple equally plausible candidates produce `awaiting_user_confirmation`, keep `writeToken: null`, and perform zero writes. No relevant candidate is a blocker.

## Resource and PixelLab Boundaries

Asset tasks keep the existing Keco-first contract: discover a compatible asset registry by semantic schema, write and read back a `planned` row, call the live PixelLab operation, validate temporary output, upload and bind the complete Keco image object as `ready`, read it back, and materialize only authoritative Keco bytes in Godot. Existing resources are preferred in the order `reuse_exact`, `extend_compatible`, `migrate_additive`, `create_new`.

PixelLab generates art resources only. Godot remains responsible for map layout, TileMap composition, collision, walkability, navigation, gameplay logic, and runtime evidence.

## Status Contract

The roadmap checkbox is the visible Slice state: unchecked means planned or in
progress, and checked means completed. Internal projections may retain
`planned`, `in_progress`, `completed`, `paused`, `superseded`, `evalResult`, and
repair data. A Slice is complete only when all plan tasks are checked and the
internal verification passes.

## Failure and Safety Rules

- No Keco, PixelLab, or Godot writes before source, Project, Folder, schema, plan, and write-token gates pass.
- Never use a folder from another Project or fall back to an untracked local plan as authority.
- Never create duplicate registries or resources when a compatible target exists.
- Preserve partial writes and retry binding by ID instead of regenerating or duplicating assets.
- Stop after the third failed repair iteration and ask the user.

## Verification

Add contract tests for implicit invocation, semantic source discovery, roadmap and per-Slice document structure, sequential execution, three-repair pause behavior, and V1/V2 routing. Run Skill validation, plugin validation, and the focused plugin Jest tests before reporting completion.
