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

Inside `tableShell`, below the top bar: a horizontal split (`tableBodySplit`) containing:

1. Primary column (`flex: 1; min-width: 0`) with the existing `tableContainer`.
2. When open: `AssetDetailDrawer` as a sibling, `flex-shrink: 0`, width 400px, stretched height.

Remove `detailDrawerOverlay`. Drawer is `position: relative` (not `fixed` / full viewport).

## Visual

- Background: muted slate (e.g. `#F8FAFC`), not pure `#ffffff`.
- Left border `#e2e8f0`; no large drop shadow.
- Inputs remain readable (slightly lighter/white fields OK on muted panel).
