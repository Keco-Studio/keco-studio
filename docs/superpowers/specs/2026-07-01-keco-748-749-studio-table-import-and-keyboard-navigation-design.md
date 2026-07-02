# KECO-748/749 Studio Table Import And Keyboard Navigation Design

**Date**: 2026-07-01
**Status**: Draft reviewed
**Scope**: `keco-studio` only

## Goals

- KECO-748: Design-document table generation must distinguish extracting existing tables from generating tables from prose.
- KECO-748: When a document contains explicit tables plus unrelated/story prose, the default behavior is to extract the explicit tables and avoid inventing rows from surrounding prose unless the user explicitly asks for generation.
- KECO-748: When the source is unrelated or has insufficient table/design evidence, the agent must not create low-quality tables; it should tell the user that generation quality is poor and is not recommended.
- KECO-749: When one table cell is selected but not in edit mode, ArrowUp/ArrowDown/ArrowLeft/ArrowRight move the selected cell like a spreadsheet.

## Non-Goals

- Do not modify `keco-simulation`.
- Do not add a deterministic document-to-Excel parser in this change.
- Do not override arrow keys while a cell editor, input, select, textarea, contenteditable element, modal, or dropdown is active.

## Design

### KECO-748

The agent prompt and design-document handoff message are the control point. The uploaded document still goes through `buildDesignMessage`, then the agent decides which tools to call.

The handoff message and system prompt must define these modes:

- Extraction mode: if explicit tables are present, preserve table headers and rows. Use surrounding prose only as context for table names or obvious field labels. Do not convert unrelated prose into extra rows.
- Generation mode: infer tables from story/design prose only when the user explicitly asks to generate/infer/build from prose.
- Quality gate: if the document has no reliable table evidence and no clear design entities, do not call write tools. Explain that the generated table would be low quality and ask for a clearer table/schema or explicit generation instruction.

### KECO-749

Add a pure navigation helper for selected cells:

- Input: current selected cell set, visible rows, visible properties, arrow key.
- Output: next single-cell selection or `null` when navigation should not handle the event.
- Boundary behavior: clamp at first/last row and first/last visible column.
- Multi-selection behavior: use the top-left selected cell as the anchor.

`useCellSelection` exposes `handleSelectedCellArrowNavigation`. `LibraryAssetsTable` registers a keydown listener and calls it only when not editing and not focused inside text/input/select/contenteditable UI.

## Self-Review

- Spec coverage: both Jira bugs are covered in `keco-studio`; no `keco-simulation` work is included.
- Existing behavior risk: prompt changes constrain agent writes but keep existing setup/query tools. Navigation only handles arrow keys for table selection outside editing controls.
- Interface consistency: helper uses existing `CellKey`, `AssetRow`, and `PropertyConfig` conventions.
