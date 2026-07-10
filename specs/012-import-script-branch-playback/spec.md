# Feature Specification: Import Script — interactive branch playback & reliable prose→standard conversion

> Superseded by the approved [Import Script Story IR design](../../docs/superpowers/specs/2026-07-10-import-script-story-ir-design.md).

**Feature Branch**: `f/importscript-enhance`
**Created**: 2026-07-08
**Status**: Draft
**Input**: Review of the Import Script feature. Two problems confirmed by reading the code: (1) branching scripts render as one flat dump instead of an interactive visual-novel playthrough where the reader advances line-by-line and picks an option at each choice to jump into the matching branch; (2) the prose→standard-format conversion has a false-positive detection bug that skips the LLM conversion for ordinary prose.

## Overview

The Import Script feature (UI modal `ImportScriptModal.tsx` → `/api/import-script` → `scriptConversionService` + `scriptImportService`, plus the agent `import_script` tool) parses a script file into structured library rows. The parse/import layer is sound: options and jump targets ARE persisted (columns `Option0/Option0_Next … Option2/Option2_Next`, `Commands`, `Label`). The defect is in **presentation**: the "script view" (`VisualNovelScriptView.tsx`) reads only `label/type/name/content` and renders every row top-to-bottom (`:215`), so all branches (`O1`/`O2`/`O3`) are shown stacked at once and option/jump columns are ignored. There is no line-by-line advance and no "stop at a choice → pick → jump to the matching branch label" interaction.

Separately, `scriptConversionService.looksLikeStructuredScript` (`:100`) contains an over-broad regex `^[一-鿿A-Za-z0-9_\s]+[：:].+$` that matches any line containing a colon (e.g. `备注: xxx`). This makes ordinary prose be treated as already-standard, so the LLM conversion is skipped and the raw prose is parsed directly, producing garbage rows.

This spec covers both: an interactive VN player for the post-import script view (the primary ask), and a fix to the conversion detection. Following the project TDD rule, each behavioral fix gets a failing reproduction test first.

## Data model (confirmed, no schema change)

Verified by reading `postProcess.ts` and `types.ts`:

- **Choice-carrying row**: the dialogue/narration line that triggers a choice holds the options — `Option0/1/2` = option text, `Option0_Next/1_Next/2_Next` = `"Jump <label>"` (e.g. `"Jump O1"`) pointing at the target branch label (`postProcess.ts:95-101`).
- **Jump row**: a `（Jump Oend）` line writes `"Jump Oend"` into the `Commands` column (`postProcess.ts:183-186`).
- **Branch start row**: `O1 branch【O1｜scene】` produces a row whose `Label` = `"O1"`; the merge row's `Label` = `"Oend"` (`postProcess.ts` label handling; `Start` for the opening).
- **Ordering**: rows are ordered by `row_index` (`scriptImportService.ts:144`, `AssetRow.rowIndex`), so a linear scan reflects authoring order.
- **Column mapping**: `detectScriptColumns` (`tableStructure.ts:60`) currently maps only `Label/Type/Name/Content` display names to field keys. Option/Commands columns are NOT exposed to the view yet — this is the gap the player must close.

## User Scenarios & Testing *(mandatory)*

### Scenario 1 — Linear script plays line-by-line (Priority: P1)

**Given** an imported script with no choices, **When** the user opens the script view and presses advance (click / Enter), **Then** dialogue and narration reveal one line at a time in authoring order until the end, instead of the whole script showing at once.

### Scenario 2 — Choice point stops and offers options (Priority: P1)

**Given** the reader advances to a row that carries `Option0/1/2`, **When** that row is reached, **Then** playback pauses and renders the available options as clickable buttons; no branch content is shown until the reader chooses.

### Scenario 3 — Selecting an option jumps to the matching branch (Priority: P1)

**Given** the options are shown and each `Option{n}_Next` holds `"Jump <label>"`, **When** the reader clicks option *n*, **Then** the player jumps to the row whose `Label` equals `<label>` and continues line-by-line from there. Only the chosen branch is played; the other branches are not rendered inline.

### Scenario 4 — Jump/merge continues the path (Priority: P1)

**Given** a branch ends with a row whose `Commands` = `"Jump Oend"`, **When** the reader advances past it, **Then** the player jumps to the row with `Label` = `Oend` (the merge point) and continues, so all branches converge correctly.

### Scenario 5 — Prose is not misdetected as standard format (Priority: P1)

**Given** an ordinary prose paragraph containing an incidental colon (e.g. `备注: 今天很热`), **When** it is imported, **Then** it is NOT treated as already-standard; the LLM conversion runs (or the text is rejected with guidance), rather than being parsed raw into garbage rows.

### Scenario 6 — Replay / reset (Priority: P2)

**Given** a script has been played to an ending or partway down a branch, **When** the user chooses "restart", **Then** the player resets to `Start` and prior choices are cleared.

### Scenario 7 — Malformed jump does not crash (Priority: P2)

**Given** an `Option{n}_Next` / `Commands` jump target has no matching `Label` row (bad LLM output or hand-edit), **When** the reader triggers that jump, **Then** the player surfaces a non-fatal warning and stops gracefully at the current line instead of throwing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Extend `detectScriptColumns` (`tableStructure.ts`) to also expose keys for the option columns (`Option0/Option0_Next/Option1/Option1_Next/Option2/Option2_Next`) and `Commands`, mapped from the `SCRIPT_COLUMNS` display names used at import (`scriptImportService.ts`). `hasScriptColumns` semantics unchanged (still gated on name+content).
- **FR-002**: Build a branch index from the ordered rows: `Label → row position` (first row bearing each label). Used to resolve `"Jump <label>"` targets.
- **FR-003**: `VisualNovelScriptView` MUST become a stateful player: track a current position and a visited-lines list; advance on click/Enter; render only revealed lines.
- **FR-004**: At a row carrying any of `Option0/1/2`, playback pauses and renders each non-empty option as a button; clicking option *n* parses `Option{n}_Next` (`"Jump <label>"`), resolves the label via the branch index, and moves the current position there.
- **FR-005**: A row whose `Commands` contains `"Jump <label>"` MUST, on advance, move the current position to the resolved label row rather than falling through to the next physical row.
- **FR-006**: Branch content other than the chosen path MUST NOT be rendered inline. Only revealed (played) lines appear.
- **FR-007**: Provide a "restart" control that resets position to `Start` and clears choice/visited state.
- **FR-008**: Unresolved jump targets MUST NOT throw; surface a visible non-fatal warning and halt advance at the current line.
- **FR-009**: Fix `looksLikeStructuredScript` — remove/replace the over-broad colon regex (`scriptConversionService.ts:100`) so a prose line with an incidental colon is not classified as structured. Structured detection MUST still recognize genuine standard-format markers (`【…｜…】`, `（TypeX・…）`, `O#：`, branch/merge/jump lines, natural `- option`, `[Label]`).
- **FR-010**: Preserve the existing table view; the VN player is only the `scriptViewMode === 'script'` path. The table/script toggle (`LibraryTableTopBar`) behavior is unchanged.

### Non-Functional Requirements

- **NFR-001**: No database schema change; the player reads existing `library_asset_values` columns.
- **NFR-002**: Player logic (position/branch resolution) SHOULD be a pure, unit-testable helper separate from the React render, so branch traversal can be tested without the DOM.
- **NFR-003**: Changes localized to `VisualNovelScriptView.tsx` (+ a new helper module), `tableStructure.ts`, and `scriptConversionService.ts`. No API/route changes required for playback.
- **NFR-004**: Accessibility — option buttons are real focusable `<button>`s; advance works via keyboard (Enter/Space) as well as click.

## Success Criteria *(mandatory)*

- **SC-001**: A unit test over a fixture with `Start → choice(O1/O2/O3) → branches → Oend` proves: picking O2 yields the played sequence Start-lines → O2 branch lines → Oend lines, and O1/O3 lines never appear.
- **SC-002**: A unit test proves a `Commands: "Jump Oend"` row advances to the `Oend` label row.
- **SC-003**: A unit test proves an unresolved jump target returns a warning state and does not throw.
- **SC-004**: A failing-first jest test in `scriptConversionService` proves `canImportScriptDirectly` / `looksLikeStructuredScript` returns false for prose-with-colon, and true for real standard-format lines, after the fix.
- **SC-005**: Existing parser suites and E2E stay green; lint + build pass.

## Out of Scope

- Persisting playback progress across sessions.
- Editing the script from within the player (edits stay in the table view).
- Auto-advance / typewriter animation, audio (`Voice`) or background (`Bg`) rendering.
- The separate high/medium review findings (agent-tool `requiredPermission` mismatch, import transaction/rollback, `value_json` shape) — tracked separately, not part of this spec.
- Redesigning the agent `ScriptPreviewCard` into an interactive player (the confirmed interaction target is the post-import library script view).

## Implementation Sketch (non-binding)

1. **Test-first (conversion)**: add reproduction test for `looksLikeStructuredScript` prose-with-colon → fix regex → keep as guard. (`superpowers:test-driven-development` per project rules.)
2. **Player helper**: new pure module (e.g. `scriptPlayer.ts`) — `buildBranchIndex(rows, cols)`, `nextPosition(state, rows, cols, choice?)`, returning `{ revealed, atChoice, options, done, warning }`. Unit-test with fixtures (SC-001..003).
3. **Column mapping**: extend `detectScriptColumns` with option/commands keys (FR-001).
4. **View**: convert `VisualNovelScriptView` to drive the helper — render revealed lines with existing bubble renderers, render option buttons at choice points, add restart control.
5. Run jest (colocated + tests/), lint, build; verify existing script E2E.
