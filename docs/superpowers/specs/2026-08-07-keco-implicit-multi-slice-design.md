# Keco Implicit Multi-Slice Orchestration Design

## Goal

Allow Keco Godot Slice V2 to activate implicitly for development requests, discover a semantically relevant source document without requiring a fixed name, decompose its ideas into multiple small Slices, and execute them sequentially with Superpowers-style plans stored authoritatively in a Keco Project Folder.

## Scope

This change applies to Keco-driven Godot development requests that require persistent planning, multi-Slice decomposition, resource evolution, or runtime evaluation. Standalone art remains routed to its standalone workflow. A single simple Slice without persistent planning may remain on V1; V2 takes precedence when the request asks for document-driven decomposition or persistent Slice documents.

## Architecture

V2 becomes an implicit, document-driven orchestration entry point. The source document is selected by semantic discovery: read the current Keco Project document summaries, use the single clearly relevant candidate, and ask when candidates tie. The source document name is not fixed to `Feedback` or any other label.

The matching Keco Project contains a semantically discovered planning Folder. Its authoritative document set is:

```text
slice-index / roadmap
slice-001 spec
slice-001 plan
slice-001 status
slice-001 eval-report
slice-002 spec
slice-002 plan
slice-002 status
slice-002 eval-report
```

The roadmap records the source document, candidate Slices, priority, dependencies, allowed files, current Slice, and aggregate status. Each Slice keeps its own spec, bite-sized plan, status ledger, and final evaluation report. Local repository documents are validated mirrors only.

## Execution Flow

```text
INTAKE -> SOURCE_DISCOVERY -> SLICE_DECOMPOSITION -> WRITE_ROADMAP
  -> SELECT_NEXT_SLICE -> DESIGN -> WRITE_SPEC -> WRITE_PLAN -> PLAN_REVIEW
  -> PREFLIGHT -> EXECUTE_TASKS -> TASK_REVIEW -> RUNTIME_EVAL
  -> REPAIR (max 3) -> FINAL_VERIFY -> UPDATE_ROADMAP -> NEXT_SLICE
```

The roadmap is written and read back before Slice execution. Each Slice plan uses Superpowers-style tasks with exact files, dependencies, RED verification, minimal implementation, GREEN verification, and review evidence. The process executes all independent/ordered Slices sequentially. A Slice that remains unsuccessful after three repair iterations updates its status and eval-report, marks the roadmap paused, and stops the run for user direction; it is not silently skipped.

## Source Discovery

When the user omits a document name or ID, list current project document summaries and rank candidates using title, content summary, development terms, recency as supporting evidence, and project context. Automatically select only one clearly dominant candidate. Multiple equally plausible candidates produce `awaiting_user_confirmation`, keep `writeToken: null`, and perform zero writes. No relevant candidate is a blocker.

## Resource and PixelLab Boundaries

Asset tasks keep the existing Keco-first contract: discover a compatible asset registry by semantic schema, write and read back a `planned` row, call the live PixelLab operation, validate temporary output, upload and bind the complete Keco image object as `ready`, read it back, and materialize only authoritative Keco bytes in Godot. Existing resources are preferred in the order `reuse_exact`, `extend_compatible`, `migrate_additive`, `create_new`.

PixelLab generates art resources only. Godot remains responsible for map layout, TileMap composition, collision, walkability, navigation, gameplay logic, and runtime evidence.

## Status Contract

The roadmap aggregates Slice states such as `planned`, `in_progress`, `completed`, `paused`, and `superseded`. Each Slice status records task-level progress and repair iterations. A Slice is complete only when all tasks are complete and a read-back eval-report exists. The final report distinguishes `passed`, `partial`, `failed`, and `blocked_before_write`.

## Failure and Safety Rules

- No Keco, PixelLab, or Godot writes before source, Project, Folder, schema, plan, and write-token gates pass.
- Never use a folder from another Project or fall back to an untracked local plan as authority.
- Never create duplicate registries or resources when a compatible target exists.
- Preserve partial writes and retry binding by ID instead of regenerating or duplicating assets.
- Stop after the third failed repair iteration and ask the user.

## Verification

Add contract tests for implicit invocation, semantic source discovery, roadmap and per-Slice document structure, sequential execution, three-repair pause behavior, and V1/V2 routing. Run Skill validation, plugin validation, focused Jest tests, and reinstall the cache-busted plugin in both WSL and Windows before reporting completion.

