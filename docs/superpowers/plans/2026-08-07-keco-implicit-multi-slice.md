# Keco Godot Slice V2 Planning Model

This plan records the completed simplification of Slice planning. The paired
design spec is
`docs/superpowers/specs/2026-08-07-keco-implicit-multi-slice-design.md`.

## User-Facing Documents

- [x] Use one spec per Slice: `docs/superpowers/specs/<slice-id>-design.md`
- [x] Use one plan per Slice: `docs/superpowers/plans/<slice-id>.md`
- [x] Use another ordinary plan for a multi-Slice roadmap when needed
- [x] Keep each plan's task list as Markdown checkboxes in dependency order

## Progress Rules

- [x] Mark a finished task with `- [x]` after implementation and verification
- [x] Treat the checked plan as the only user-facing progress record
- [x] Keep `status.json`, `eval-report`, hashes, and runtime evidence internal
- [x] Create a new paired spec/plan revision when scope or acceptance changes

## Implementation

- [x] Update the Codex V2 contracts and routing instructions
- [x] Update the Claude V2 contracts and README
- [x] Add contract tests for the shared layout and checkbox model
- [x] Run the plugin test suite: 6 suites, 144 tests passed
