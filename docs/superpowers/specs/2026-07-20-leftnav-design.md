# LeftNav (Framework rail) — Design

Date: 2026-07-20  
Scope: `keco-studio` dashboard shell only. Does not change project-tree Sidebar behavior beyond coexisting beside it.

## Goal

Add a far-left product icon rail matching the Framework / LeftNav design, so users can switch between Keco Studio and the embedded keco-simulation-demo without changing the rest of the dashboard UI.

## Non-goals

- Implementing actions for the 3rd (list) and 4th (box) nav icons
- Changing keco-simulation-demo itself
- Merging LeftNav into the existing project-tree `Sidebar`
- Replacing TopBar / ChatPanel / auth shell

## Layout

`DashboardLayout` becomes:

```
[LeftNav | project-tree Sidebar (existing rules) | main (TopBar + content)]
```

- LeftNav sits to the left of the existing project-tree `Sidebar`.
- Project-tree Sidebar keep-or-hide rules stay as today (including hide on `/simulation-system` when embed is configured). LeftNav does **not** follow that hide rule.
- TopBar, content, ChatPanel, AgentImportBridge unchanged aside from horizontal space taken by LeftNav.

### Visual tokens (from design)

| Property | Value |
|----------|--------|
| Width (expanded) | ~60px (design: 60.5px; implement as 60px unless fractional width is required) |
| Height | Fill viewport |
| Background | `#FAFAFA` (surface/tertiary) |
| Right border | `0.5px solid rgba(17, 17, 17, 0.2)` |
| Item gap | `4px` vertical |
| Active item | Light purple circular/pill background + purple icon (match design) |

## Collapse / expand

- Bottom control: double-chevron `<<` collapses LeftNav.
- When collapsed: hide the rail; show a small `>>` control on the left edge of the page to expand again.
- Persist expanded/collapsed in `localStorage` (key e.g. `keco.leftnav.collapsed`).
- Default: expanded.

## Icons and navigation

Top to bottom:

| Slot | Icon | Behavior |
|------|------|----------|
| Brand | Blue stylized **K** | Non-interactive brand mark |
| 1 (default) | Grid (2×2) | Active when pathname is **not** under `/simulation-system`. Click navigates away from simulation back into Studio (prefer `/projects` if currently on `/simulation-system`; otherwise no-op if already in Studio). |
| 2 | Lightning | Click `router.push('/simulation-system')`. Active when pathname starts with `/simulation-system`. Active styling matches design (purple). |
| 3 | List (three lines) | No-op for now (visually present; not interactive / aria-disabled). |
| 4 | Box / drawer | No-op for now (same as 3). |
| Bottom | `<<` / `>>` | Collapse / expand only |

Selection is derived from the route, not from local “selected index” state.

Icons: inline SVG matching the design screenshot (do not introduce a new icon package for these).

## Simulation embed / env

Reuse existing `/simulation-system` iframe route (`SimulationSystemEmbed`).

1. Point env at the demo Vite app:
   - `NEXT_PUBLIC_SIMULATION_ENABLED=true`
   - `NEXT_PUBLIC_SIMULATION_ORIGIN=http://localhost:5173`
2. **iframe `src`**: load the origin root only (`http://localhost:5173/`), **do not** append Studio’s `/simulation-system/...` pathname. keco-simulation-demo is a root SPA and has no matching path segments.
3. Keep same-origin self-embed guard and “not configured” fallback; update example text/ports from 3001 → 5173 where they describe the local demo setup.
4. Local run: Studio (`:3000`) + `keco-simulation-demo` (`:5173`).

Optional follow-up (out of scope unless needed during implementation): if product later needs deep-linking into demo routes, add an explicit path-mapping helper; do not silently reintroduce pathname passthrough for the demo origin.

## Component plan

| Piece | Location |
|-------|----------|
| `LeftNav` | `src/components/layout/LeftNav.tsx` + `LeftNav.module.css` |
| Wire-in | `DashboardLayout.tsx` / `DashboardLayout.module.css` |
| Embed src fix | `SimulationSystemEmbed.tsx` (+ fallback copy) |
| Config | `.env.local` origin → `http://localhost:5173` (local); document in fallback if needed |

Collapse state lives in `LeftNav` (or a tiny hook next to it). No new global context required unless wiring becomes awkward.

## Error / edge cases

- Embed not configured: navigating to item 2 still goes to `/simulation-system`; page shows existing fallback UI.
- Origin equals Studio origin: existing self-embed guard blocks recursive iframe.
- Collapsed + refresh: restore from `localStorage`.
- Items 3–4: keyboard focus may skip or announce disabled; must not navigate.

## Testing (lightweight)

- Unit or component-level: active class follows pathname; collapse toggles and persists (mock `localStorage`).
- Manual: expanded rail matches design; item 1 default on Studio routes; item 2 opens iframe of `http://localhost:5173/`; `<<` / `>>` round-trip; project-tree Sidebar still hides on simulation when configured.

## Approach chosen

Independent `LeftNav` beside existing `Sidebar` (Approach A). Rejected merging into project-tree Sidebar and rejected a cross-app microfrontend shell.
