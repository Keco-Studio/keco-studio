# Project Game Assets Design

## Goal

Add a Keco-native Game Assets area below Settings in the project sidebar. The
area must present the project's authoritative game materials in a reference-like
classification sidebar and a searchable file list, while preserving Keco's
existing navigation, typography, spacing, permissions, and visual language.

## Scope

### In scope

- Add a `Game assets` project shortcut below `Settings`.
- Add the route `/{projectId}/admin/assets`.
- Add a two-column asset workspace:
  - Keco-styled category navigation with counts.
  - Searchable/filterable grid or list of asset records.
- Add asset detail preview with stable identity, source, status, dimensions,
  hash, and an ephemeral preview URL when available.
- Add multi-file manual upload UI and wire image uploads through the existing
  Keco image upload protocol (`prepare_image_uploads`/PUT/`complete_image_uploads`)
  and project table persistence.
- Read generated map assets, character/animation assets, and GDD map artifacts
  from existing authoritative tables and expose them through one normalized
  project asset API.
- Keep provider URLs and signed URLs ephemeral; the UI must use stable IDs,
  storage paths, and SHA-256 values for identity.

### Out of scope

- Replacing the existing Create Map or Character/Animation generation flows.
- Adding a new provider webhook or changing PixelLab lifecycle semantics.
- Converting non-image source files into Keco image fields.
- Deleting generated provider records or storage objects from this first slice.
- Building a standalone asset product/navigation rail.

## User experience

The project sidebar keeps its current structure and adds:

```text
Recent
Settings
Game assets
```

`Game assets` is active for `/{projectId}/admin/assets`. The page uses the
existing project shell and top bar. The content area has a narrow category rail
and a flexible file area.

Categories are semantic, not provider-specific:

- All assets
- Characters
- Animations
- Maps
- UI
- Effects
- Other

Each category displays a count. The file area provides:

- Search by display name, format, source, or stable asset ID.
- Status filter: all, ready, in progress, failed, blocked.
- Grid/list toggle.
- `Upload assets` action for editor/admin users.
- Empty, loading, partial, and error states in Keco's existing row/card style.

The detail panel shows a preview where a fresh signed URL can be generated,
plus source (`manual`, `gdd`, `map-generation`, `character-generation`, or
`animation-generation`), status, dimensions, file type/size, SHA-256, and
stable IDs. It must state when a preview is unavailable without treating that
as loss of the authoritative asset record.

## Data model and aggregation

The browser consumes a project-scoped API response shaped as:

```ts
type ProjectGameAsset = {
  id: string;
  projectId: string;
  name: string;
  category: 'character' | 'animation' | 'map' | 'ui' | 'effect' | 'other';
  format: string;
  mimeType: string | null;
  status: 'ready' | 'queued' | 'generating' | 'failed' | 'blocked' | 'planned';
  source: 'manual' | 'gdd' | 'map-generation' | 'character-generation' | 'animation-generation';
  storagePath: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  hasTransparency: boolean | null;
  fileSize: number | null;
  previewUrl: string | null;
  previewExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  sourceRef: { kind: string; id: string };
};
```

The server aggregates only records belonging to the requested project:

- Manual image rows are read from a dedicated compatible image asset registry
  table selected by semantic fields. The first implementation may use the
  existing image-valued table-row contract, but must not assume a fixed table
  name.
- Map records come from `map_projects`/`map_revisions`/`map_assets` and are
  included even when their status is not terminal.
- Character and animation records come from `character_assets` and their latest
  `character_generation_attempts` row.
- GDD map artifacts are joined to `map_assets`; the map asset is the authority
  for ready bytes while the artifact supplies GDD provenance.

The API creates a signed URL only for a ready private-storage object and only
for the response. It never persists the URL. It must validate project ownership
or accepted collaborator access before querying or signing.

## Upload behavior

Manual upload is intentionally limited to supported image files in this first
slice, matching Keco's current upload protocol. The client:

1. Validates extension, MIME type, and 5 MiB limit.
2. Calls `prepare_image_uploads` with metadata only.
3. PUTs exact bytes to each returned signed target.
4. Calls `complete_image_uploads` with returned image paths.
5. Persists each complete verified image object into the selected compatible
   project asset registry row.
6. Refreshes the normalized asset list and verifies the row read-back.

Each item has independent progress and error state. A failed item can be
retried without regenerating or duplicating successfully completed items.

## Permissions

- Viewers can browse categories, list records, search, filter, and preview.
- Editors/admins can upload.
- The API repeats authorization at request time; client role state is only a
  presentation hint.
- No delete action is exposed in this slice because generated records and their
  private storage objects require lifecycle-specific cleanup semantics.

## Error and consistency behavior

- The API returns partial aggregation warnings per source instead of hiding all
  assets when one optional source table is unavailable.
- A signed URL failure leaves the asset record visible with `previewUrl: null`.
- Stale or malformed source rows are skipped with a bounded warning; stable
  source IDs are never guessed.
- Upload preparation/completion failures are item-scoped and surfaced in the
  upload drawer.
- The UI distinguishes `ready`, active, failed, and blocked states and offers
  retry only for manual upload items in the current session.

## Files and boundaries

- `src/app/(dashboard)/[projectId]/admin/assets/page.tsx`: route shell.
- `src/components/admin/GameAssetsPage.tsx`: client workspace state and
  interactions.
- `src/components/admin/GameAssetsPage.module.css`: Keco-native layout and
  responsive styles.
- `src/lib/services/gameAssetsService.ts`: server aggregation, normalization,
  category mapping, and signed preview URLs.
- `src/app/api/projects/[projectId]/game-assets/route.ts`: authorized GET/POST
  boundary for listing and manual image write-back orchestration.
- `src/components/layout/components/SidebarProjectQuickNav.tsx`: sidebar item.
- `src/components/admin/AdminTabs.tsx`: settings-area tab/section navigation.
- `src/components/layout/TopBar.tsx`: title/route recognition if required by
  current toolbar branching.

## Acceptance criteria

1. `Game assets` appears immediately below Settings for every project and has a
   selected state only on the asset route.
2. A viewer can load the page and see category counts and normalized asset
   records without receiving write controls.
3. An editor/admin can upload one or more supported images, see per-item
   progress, and see the completed files after a fresh read-back.
4. A generated map or character record appears with its real stable ID, status,
   hash, dimensions, and source; the page does not invent a duplicate row.
5. Ready private assets preview through an expiring signed URL; the URL is not
   persisted in client/server records as identity.
6. Search, category filtering, status filtering, grid/list switching, empty,
   loading, partial-warning, and error states work on desktop and narrow views.
7. Existing Settings, sidebar, upload, map, character, and GDD tests remain
   green, plus focused tests cover normalization, project isolation, category
   counts, and upload item failure handling.
