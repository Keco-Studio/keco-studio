# Table cell click-to-expand (replace overflow tooltip)

**Date:** 2026-07-31  
**Status:** Approved for planning  
**Scope:** Library assets table body text cells — remove hover overflow tooltip; click expands row height so wrapped text shows in full

## Problem

Long text in `TextCell` is truncated with ellipsis. Hover shows an Ant Design `Tooltip` with the full value. Users want to read truncated text by expanding the row (taller, wrapped) on click instead of a floating tooltip.

## Goals

- Remove hover full-text tooltips from asset table text cells.
- On click of a text cell whose content is truncated: select the cell and expand that row so text wraps within the existing column width and the full value is visible.
- Collapse when the selection leaves the row, or when the user clicks the same expanded cell again (toggle).
- Keep double-click edit, fill handle, context menu, and collaboration affordances unchanged.

## Non-goals

- Changing table header ellipsis tooltips (`EllipsisTextWithTooltip`).
- Changing formula-expression tooltips, detail-drawer tooltips, or the “View asset details” button `title`.
- Expanding Enum / Boolean / Media / Formula display cells in this change (only `TextCell`).
- Permanently resizing columns, or writing expand height into persisted `rowHeights` from `useTableResize`.
- Hover-based expand.

## Behavior

### Truncation (default)

Unexpanded text cells keep current ellipsis styling (`overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`).

### Expand

Trigger: single click on a `TextCell` whose displayed text overflows its box.

Effects:

1. Existing cell-selection logic still runs (option 1: click both selects and expands).
2. That row enters an ephemeral expanded state.
3. Text in expanded-row cells wraps (`white-space: normal`; ellipsis off for the expanded presentation).
4. Row height grows with content. Virtualization already uses `measureElement`; remeasure after expand/collapse so scroll metrics stay correct.

If the clicked cell is not overflowing, only selection runs (no expand).

### Collapse

Either of:

1. Selection moves to another row, or the selection is cleared → collapse the previously expanded row.
2. User clicks the same already-expanded cell again → toggle collapse (selection may remain per existing selection rules; row height returns to non-expanded).

Only one row is expanded at a time.

### Persistence and manual row height

Expanded height is session UI state only. Do not commit it into `useTableResize` / localStorage `rowHeights`.

If the row already has a custom `--row-height` from manual resize, expand still allows content-driven growth for the ephemeral state; after collapse, restore the prior custom-height styling behavior (same as today when not expanded).

### Editing

Double-click to edit is unchanged. Entering edit mode does not require expand. Leaving edit mode does not force expand.

## Approach (chosen)

**Ephemeral expanded-row state** tied to selection / toggle, driven by CSS wrap on the row (or cells in that row), not by writing measured px into persisted resize state.

Rejected alternatives:

- Writing fit height into `rowHeights` (conflicts with manual resize persistence).
- Expanding only the selected cell without growing the whole row (uneven row chrome).

## Implementation sketch

### State

- Track something like `expandedRowId: string | null` (and optionally the `propertyKey` that triggered expand for same-cell toggle).
- Own it near existing selection state (`useCellSelection` or table body) so click handlers can set/clear it alongside `selectedCells`.

### `TextCell`

- Remove Ant Design `Tooltip` wrappers used for overflow full text.
- Remove overflow-only machinery that exists solely to feed that tooltip (`isOverflowing` + `ResizeObserver`), unless still needed to decide whether click should expand — keep a lightweight overflow check on click (or keep observer if cheaper than measuring on every click).
- On click path: after/with selection, if text overflows and row is not expanded for this cell → expand; if already expanded for this cell → collapse; if overflowing click on a different cell in another row → move expand to that row.

### CSS (`LibraryAssetsTable.module.css`)

- Add a row (or cell) modifier for expanded state that allows wrap and natural height.
- Ensure expanded rows are not forced to a single-line height; reconcile with `.rowCustomHeight` / `--row-height` so ephemeral expand wins while active.
- Remove unused `.cellTextWithTooltip` / `.cellTextTooltip` styles if nothing references them after the change.
- Drop `cursor: help` on truncated cell text if it only signaled tooltip affordance.

### Virtualization

- After expand/collapse, ensure the virtualizer remeasures the affected row (`measureElement` / `measure()` as already patterned in the table body).

## Testing

- Unit or component: overflowing `TextCell` click expands row / wraps; non-overflowing click does not; second click on same expanded cell collapses; selecting another row collapses.
- Assert no overflow tooltip title is rendered for truncated text cells.
- Smoke: double-click still enters edit; first-column detail button still works.

## Success criteria

- No hover full-text tooltip on library table text cells.
- Truncated text becomes fully readable via click → taller wrapped row.
- Collapse works via other-row selection / clear, and via re-click toggle.
- Manual persisted row heights and double-click edit remain correct.
