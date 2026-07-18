# Table reference navigation stays on library table

Date: 2026-07-18  
Status: Approved (approach 1, row-only highlight)

## Goal

Clicking a document **table-row** resource reference must open the **library assets table** (same UI as browsing the library), scroll to the referenced asset, and briefly highlight **the whole row**. It must **not** open the asset detail page.

Document-block references are unchanged.

## Behavior

1. Resolved table-row `href` becomes: `/{projectId}/{libraryId}?asset={assetId}`
2. Library page reads `asset` query param (UUID only).
3. When table data is ready:
   - Virtualized list scrolls so the row is centered/visible
   - Row gets a temporary highlight class (~2s), then clears
   - No cell highlight, no selection change, no navigation to `/{assetId}`
4. If the asset id is missing from loaded rows after timeout: toast `Referenced content is unavailable`

## Out of scope

- Changing reference picker / stored JSX attributes (`displayFieldId` remains for labels)
- Document-block navigation
- Permanently selecting the row

## Implementation notes

- Update `resolveTableReferences` href generation (+ unit/export tests)
- Library page + `LibraryAssetsTable` accept optional referenced asset id and drive scroll/highlight
- Reuse row DOM hook `data-row-id` and patterns similar to find-replace scroll
