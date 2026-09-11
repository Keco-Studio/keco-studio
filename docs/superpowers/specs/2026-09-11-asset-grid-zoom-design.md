# Asset Explorer Grid With Wheel Zoom

## Goal

Give a library a Windows File Explorer-like asset browsing mode without changing
the existing asset data source or editing behavior. The first version should be
easy to compare with the current table and should preserve the existing
`AssetTableIcon.svg` for assets without a usable image preview.

## User Experience

- The library table gains a grid/list toggle; grid is the default for the new
  explorer presentation while list keeps the current table.
- Grid items use a stable square preview area, the existing asset icon when no
  image value is available, the asset name, and (at larger zoom levels) a small
  selection of non-empty fields.
- Wheel events over the grid change tile size in bounded steps. Scrolling up
  makes tiles larger and reveals more metadata; scrolling down makes tiles
  smaller and shows only the preview and name.
- The grid is virtualized so only the visible tile rows plus overscan mount in
  the DOM. Filtering, optimistic updates, selection, detail drawer, and asset
  mutations continue to use the same resolved rows as the table.
- Zoom is local to the page session and resets when the library component is
  remounted. No database or schema changes are required.

## Architecture

- Add a focused `LibraryAssetsGrid` component next to `LibraryAssetsTableBody`.
- Keep `LibraryAssetsTable` responsible for shared row resolution, filtering,
  selection, detail navigation, and view selection.
- Add a small pure zoom helper so wheel-to-level behavior can be unit tested.
- Reuse the existing row asset icon and media metadata parsing. Image values
  are rendered only when they contain a safe HTTP(S), data, or blob URL.

## Verification

- Unit tests cover zoom clamping/step behavior and preview URL extraction.
- Typecheck and the focused unit tests must pass.
- Run a production build before handoff when the local environment permits it.
