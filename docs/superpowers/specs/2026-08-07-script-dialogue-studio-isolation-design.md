# Script Dialogue UX And Studio Script Isolation Design

Date: 2026-08-07
Status: Draft (awaiting user review of written spec)

## Summary

Improve the Script workspace dialogue and flow-chart presentation, and isolate document-derived script (`conversation`) libraries from Studio so they are generated and opened only in Script.

## Goals

- In Script plot-node dialogue, show branch choice buttons matching library player mode.
- Center Type 4 / plain scene lines in the visual-novel dialogue view.
- Fit the Script flow chart so all nodes are visible horizontally without left-right scrolling, while keeping vertical scroll and manual zoom.
- Remove Studio's Generate conversation entry and stop Studio from listing or opening `document_export_type === 'script'` libraries.

## Non-Goals

- Removing script libraries from the database or dropping the `'script'` export type.
- Removing Generate conversation from the Script workspace.
- Changing Generate table behavior.
- Replacing the custom SVG flow chart with React Flow.
- Redesigning the left/right Script split layout (dialogue pane vs flow chart pane stay as they are).
- Changing Agent autoExecute / conversation-option tooling unrelated to branch `OptionN` buttons.

## Approach

Minimal reuse of existing components (Approach 1):

- Extend `VisualNovelScriptView` plot-node mode for choices and scene centering.
- Add fit-to-width + scale viewport behavior inside `FlowChartPanel`.
- Filter and redirect at Studio UI boundaries; keep Script generation and data pipelines intact.

---

## 1. Script Dialogue Area

### Scene centering

- Type `4` / `plain` presentation aligns to center (scene title and scene description).
- Types `1` / `2` / `3` keep left/right speaker bubble alignment.
- Type `5` fullscreen remains centered.
- Shared presentation lives in `visualNovelPresentation` and `VisualNovelScriptView` styles, so library player and Script stay consistent.

### Branch buttons in plot-node mode

- Script continues to use `mode="plot-node"`: show all rows for the selected plot node at once.
- When the selected node contains rows with filled `OptionN` text, render the same `choicePanel` / `choiceButton` UI used in player mode at the bottom of the dialogue list.
- Do not show the player Restart toolbar in plot-node mode.
- Choosing an option resolves `OptionN_Next` to a target Label. Because the target often lives in another plot node, do **not** run in-filtered-row player advancement. Instead, notify `ScriptSplitView` via callback so it selects the plot node that owns the target Label and refreshes the left pane.
- If there are no options, render no choice panel.

### Key touchpoints

- `VisualNovelScriptView.tsx` / `.module.css`
- `visualNovelPresentation.ts` (+ unit tests)
- `ScriptSplitView.tsx` (choice → plot selection wiring)

---

## 2. Flow Chart Fit And Zoom

### Behavior

- On library enter, library switch, graph layout change, or flow panel resize: compute a scale from container width so every node fits horizontally (fit width).
- Set `overflow-x: hidden` so horizontal panning/scrolling is gone.
- If scaled height still exceeds the viewport, allow vertical scrolling only.
- Preserve Ctrl/⌘ + wheel (or equivalent) manual zoom. After manual zoom-in that clips horizontally, still hide horizontal scroll; the user can zoom back out. Switching library resets to fit.
- Do not introduce React Flow. Implement with CSS `transform: scale` and `transform-origin` on the existing canvas inside `FlowChartPanel`, replacing the current `centerScrollElement` left/right centering scroll.
- Agent story-graph preview highlighting remains unchanged.

### Key touchpoints

- `FlowChartPanel.tsx`
- `ScriptSplitView.module.css` (`.flowBody` overflow)

---

## 3. Studio Isolation Of Script Libraries

### Remove Studio generation entry

- Remove "Generate conversation" from the Studio document context menu and its `generate-conversation` handler path.
- Keep "Generate table".
- Keep Script sidebar "Generate conversation" (`exportType: 'script'`), which opens the Script workspace after import.

### Hide and redirect in Studio

- Filter Studio sidebar trees, folder counts, drag targets, and search lists so libraries with `document_export_type === 'script'` never appear.
- When Studio library route `/{projectId}/{libraryId}` targets a script library, redirect to `/script-system/{projectId}/script/{libraryId}` instead of opening the Studio table page.
- Do not delete existing script libraries or change DB constraints. Agent story-graph and MCP readers continue to access script libraries by id.

### Agent boundary

- On Studio routes, `generate_from_document` with `exportType: 'script'` is rejected with guidance to generate from Script.
- On Script routes, script generation remains available.

### Key touchpoints

- `ContextMenu.tsx`
- `useSidebarContextMenuActions.ts`
- Studio sidebar library listing / filtering
- Studio library page guard / redirect
- Agent `generate-from-document` Studio-context guard
- Script context menu and import path (unchanged functionally)

---

## Testing

### Dialogue

- Type 4 / plain scene lines are centered; speaker bubbles still left/right.
- Plot node with `OptionN` shows choice buttons matching player styling.
- Choosing an option selects the plot node for the target Label.
- Plot node without options shows no choice panel and no Restart toolbar.

### Flow chart

- Wide graphs fit width with no horizontal scrollbar.
- Tall graphs remain vertically scrollable.
- Resize and library switch re-fit.
- Manual zoom works; library switch resets fit.
- Preview highlight still works.

### Studio isolation

- Studio document menu has no Generate conversation; Generate table still works.
- Studio sidebar never lists script libraries.
- Direct Studio URL to a script library redirects into Script.
- Script Generate conversation still creates and opens a script library.
- Studio Agent cannot complete script export; Script Agent can.

## Acceptance Criteria

- Script plot-node dialogue shows player-style branch buttons when options exist, and scene (Type 4) content is centered.
- Script flow chart shows all nodes without horizontal scrolling after automatic fit, with optional manual zoom and vertical scroll when needed.
- Studio no longer offers Generate conversation and no longer shows or opens script-derived libraries; Script remains the only UI surface for those libraries and that generation entry.
