# Game Art Open Design Refresh

**Date:** 2026-08-18  
**Status:** Approved for implementation  
**Scope:** Rework the Game Art creation stage and read-only Art Style workspace view so the visual language is presented with an Open Design-style overview-first hierarchy, without changing persistence, generation, or API contracts.

## Product Goal

Game Art should feel like a visual design system rather than a specification dump. Users should understand the style from a strong visual board first, then inspect concise principles and project-specific customization. Creation must remain efficient for entering direction and references.

## Design Direction

Use a shared visual language between two modes:

- **Creation mode:** a compact studio workbench. The preview is the primary surface on the left; project-specific inputs sit alongside it on the right.
- **Browse mode:** an editorial style board. The preview and a short “Visual DNA” summary lead; canonical guidance is grouped into progressive-disclosure sections; saved customization is clearly separated at the end.

The implementation keeps the existing Keco light palette, typography, borders, and blue selection accent. It reduces divider density and removes the requirement that all canonical copy be visible at once. It does not introduce new dependencies, mutate the `GameArtStyleSnapshot`, or change generation behavior.

## Creation Experience

The existing four-stage flow stays intact. The Art Style stage changes as follows:

1. A two-column workbench places the visual board first and the customization controls second on desktop. The visual board contains a wide map preview, a contained character preview, the preset identity, and a short explanation of the preset.
2. Canonical specification is grouped into four labeled sections: `Visual identity`, `Craft`, `World`, and `Production`. Each section has a short summary and can expand to reveal its details. The first section is open initially; expansion is local UI state only.
3. Custom direction, visual references, and avoid guidance remain the same fields and validation rules. Their labels and counter text remain accessible. Reference rows remain removable and addable, but are visually quieter than the preview.
4. The existing catalog rail remains a selected, locked preset indicator. It is compact and no longer competes with the preview for the first visual read.

On narrow screens the order is preset identity, map preview, character preview, grouped specification, then customization controls. Preview frames use stable aspect ratios and bounded heights so the transparent character image cannot create a full-screen empty checkerboard panel.

## Browse Experience

The existing Art Style tab remains in the workspace and remains read-only. Its content becomes:

1. A visual board with the map as the dominant image and the character in a bounded companion panel.
2. A `Visual DNA` summary row containing four short, high-signal values derived from the canonical specification: identity, palette/lighting, shape language, and pixel technique.
3. A compact section navigation row for `Visual identity`, `Craft`, `World`, and `Production`. The navigation scrolls to grouped content and does not create a second route or tab system.
4. Grouped canonical guidance rendered as readable prose. Each group can be collapsed; the first group is open by default. The full text remains in the DOM when expanded and is never represented only by an image.
5. Saved customization rendered in a distinct, lower-priority section with direction, visual references, and avoid guidance.

Legacy versions continue to show the existing neutral “No art style specified” state. Missing preview images continue to show local unavailable states while all text remains readable.

## Component Boundaries

- `GameArtStylePreview` owns the shared visual board, preset identity, asset failure fallback, and grouped specification presentation. It accepts existing preset/snapshot props and adds display-only callbacks/state as needed.
- `GameDesignSystemCreatePage` owns stage navigation and customization form state. It composes the preview in workbench mode and keeps submit payloads unchanged.
- `GameDesignSystemWorkspace` owns the Art Style tab and version selection. It composes the preview in browse mode and does not duplicate snapshot fields.
- `GameDesignSystemsPage.module.css` owns responsive layout, stable preview dimensions, grouping, and visual hierarchy. No new global CSS or design dependency is introduced.

## Acceptance Criteria

- Desktop creation shows the map as the first visual anchor, controls remain usable without scrolling through the full specification, and all existing field validation continues to work.
- Desktop browse view reads as a visual board before a specification list; the four summary values are visible before detailed guidance.
- Mobile creation and browse views have no horizontal overflow, no character preview taller than its bounded panel, and no overlapping controls.
- Preview load failures and legacy null snapshots preserve their existing semantics.
- Existing component, route, and e2e tests continue to pass, with focused assertions added for the grouped/summary content and responsive structure.
- No API, database, generation prompt, or immutable snapshot contract changes are made.

## Non-Goals

- Adding new art presets or generating assets at runtime.
- Editing Art Style after a version is created.
- Rewriting the broader Game Design System workspace or navigation.
- Copying Open Design branding or introducing a separate design system.
