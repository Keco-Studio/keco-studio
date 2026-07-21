# Simulation Demo Fidelity And Demo Data Design

**Date:** 2026-07-21
**Status:** Approved
**Target repository:** `keco-studio`
**Visual reference:** `keco-simulation-demo`

## Purpose

Correct the native `/simulation-system` integration so it preserves the source
demo's visual identity and remains immediately demonstrable without requiring a
prepared Studio project. This document supersedes the visual redesign and
Studio-only import assumptions in the earlier native integration design. The
native route, project-aware persistence, strict Studio adapter, and absence of an
iframe remain unchanged.

## Visual Fidelity

The checked-out `keco-simulation-demo` is the canonical reference. The native
workbench will preserve its simulator sidebar, step header, typography, colors,
spacing, cards, tables, arena, battle log, HP/MP display, hit movement, and
floating damage/heal feedback. The workbench may be scoped through CSS Modules
and fitted to the dashboard content area, but those implementation details must
not visibly redesign it.

Studio keeps its product-level `LeftNav`. Its resource sidebar and top bar remain
hidden on `/simulation-system`, leaving the demo shell to own the feature area.
Responsive changes may reflow content to prevent clipping, but must keep the same
visual language and workflow hierarchy.

## Import Sources

The Import workflow exposes two explicit paths:

1. **Use demo data** creates a session from the built-in character, skill, level,
   and skill-cost catalogs. It requires no Studio libraries and is intended for
   immediate demonstrations.
2. **Import Studio data** retains the existing project library selection, field
   mapping, strict validation, and atomic snapshot conversion.

Demo data is a temporary, visible source option rather than an invisible fallback
or permanent replacement for Studio data. Both paths create the same
`ImportedSimulationSnapshot` contract, so every downstream screen and the battle
engine remains source-agnostic.

## State And Persistence

Demo and Studio sessions use the existing versioned local repository. State stays
isolated by authenticated user and selected Studio project. Each imported snapshot
records its source identity and timestamp; refresh restores the active session and
last workflow screen. Simulation changes are not written to Supabase.

Starting a fresh import always creates a new session. An explicit re-import may
replace an existing session only when its ID is deliberately supplied.

## Error Handling

Demo snapshot creation is local and deterministic. Studio import continues to
report library, asset, and field-level errors without partially mutating session
state. Persistence errors remain visible in the simulation shell and do not erase
in-memory work.

## Verification

- Unit tests cover demo snapshot creation and ensure it contains the built-in
  catalog and rule tables.
- Workflow tests cover both demo and Studio import paths.
- Battle tests continue to verify deterministic engine behavior.
- Desktop and mobile review compares the native route with the source demo,
  including sidebar, header, all five screens, HP/MP, hit feedback, and overflow.
- Typecheck, lint, production build, and Playwright collection remain required.
  Full browser execution is recorded separately when host Chromium libraries are
  available.
