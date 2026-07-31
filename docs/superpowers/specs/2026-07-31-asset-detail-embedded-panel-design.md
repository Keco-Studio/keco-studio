# Asset detail embedded panel

**Date:** 2026-07-31  
**Status:** Approved for implementation  
**Scope:** Library asset detail panel — embed beside table, soften appearance, keep 400px width

## Goals

- Replace fixed overlay drawer + dimmed backdrop with an embedded right panel.
- Left table flex-shrinks to remaining width when the panel is open.
- Soften the panel’s bright white (muted surface, light divider; no heavy shadow).
- Keep panel width at **400px** (unchanged from current drawer).

## Non-goals

- Changing field editing / save behavior inside the panel.
- Resizable panel width.
- Closing on every outside click (close via ×; opening another row’s detail switches content).

## Layout

Portal the drawer into `#library-asset-detail-slot` on the library page `mainContent` — **same flex sibling level as Version History** (`height: calc(100vh - 4rem)`, sticky). Table stays in `tableContainer` and shrinks via `flex: 1`.

Keep panel width at **400px**. White surface + soft blue header (aligned with version history chrome), not grey card fill.

## Visual

- Background: white panel with soft blue header tint.
- Left border soft blue; no large drop shadow.
- Inputs remain readable on the white panel.
