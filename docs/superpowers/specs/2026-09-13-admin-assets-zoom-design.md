# Admin Assets Gallery Zoom

## Goal

Add the same Windows Explorer-style resource sizing interaction to `/admin/assets` while preserving its existing justified image gallery, aspect-ratio handling, upload flow, filters, and detail panel.

## Design

The existing shared presentation helpers remain the source of truth for bounded size levels and wheel direction. `GameAssetsPage` owns a local size index because its gallery layout is different from `LibraryAssetsGrid`.

- Reuse `ASSET_GRID_SIZES` and `nextAssetGridSize` from `assetGridPresentation`.
- Map the selected size level to the gallery's target row height.
- Keep each asset's measured or persisted aspect ratio unchanged; only row height and derived tile widths change.
- Attach a non-passive wheel listener to the gallery container. Ordinary wheel events continue scrolling. `Ctrl/Cmd + wheel` calls `preventDefault()` and changes one bounded size level per gesture.
- Render the existing `- / size label / +` controls at the lower-right of the file area.
- Keep controls available while the detail panel is open and avoid changing upload, selection, category filtering, or detail behavior.

## Verification

- Unit coverage verifies the target row-height mapping and bounded wheel-size transitions.
- Browser coverage verifies ordinary scrolling, `Ctrl/Cmd + wheel` without page zoom, the size controls, image aspect-ratio preservation, selection, and detail opening on `/admin/assets`.
- Run the focused unit tests, lint, typecheck, build, and the focused Playwright flow before handoff.
