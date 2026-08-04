# Simulation Global TopBar

## Goal

Make Simulation use the same functional Studio TopBar and global search as the
Script workspace. Remove the separate decorative search and avatar from the
Simulation workbench header while retaining Simulation workflow navigation.

## Current State

- Script routes keep the shared `TopBar` mounted by `DashboardLayout`.
- Simulation routes hide the shared `TopBar`.
- `SimulationHeader` renders a Simulation-only search placeholder and avatar.
  The placeholder is not an input and does not provide global search behavior.

## Design

`DashboardLayout` will render the shared `TopBar` on Simulation routes. It will
continue to hide the Studio project sidebar and Agent chat panel there, leaving
the Simulation workbench responsible for its own sidebar and content.

`SimulationHeader` will retain its project breadcrumb on Import and its workflow
step navigation on subsequent screens. Its local search placeholder, profile
avatar, and their unused styles will be removed. This prevents duplicate search
and profile controls below the shared TopBar.

The shared TopBar remains the single owner of global search state, result
loading, filtering, navigation, focus handling, and responsive presentation.
No Simulation data or workflow state moves into the Studio layout.

## Responsive Behavior

The shared TopBar keeps its existing responsive behavior. The Simulation
workflow header keeps its existing horizontal overflow and mobile wrapping,
with the removed action area no longer reserving space.

## Scope

Expected production changes are limited to:

- `src/components/layout/DashboardLayout.tsx`
- `src/components/simulation/workbench/SimulationHeader.tsx`
- `src/components/simulation/workbench/SimulationWorkbench.module.css`

No search API, route, Simulation provider, workflow, sidebar, or persistence
changes are included.

## Verification

- Add or update focused coverage proving Simulation renders the shared TopBar.
- Confirm the Simulation-local search placeholder and avatar are absent.
- Run the focused tests, TypeScript checking for the affected application, and
  `git diff --check`.
