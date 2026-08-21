# GDS and Create Map MCP Contract

This contract is self-contained for the Keco MCP `0.4.0` Game Design System
(GDS) and Create Map V3 tools. Treat returned IDs as opaque stable identities.
Never guess an ID from a title.

## Endpoint Context

The account endpoint discovers projects with `list_projects`. Every Map tool and
the three project-binding GDS tools require `projectId` there. The legacy
project endpoint is already bound to one project: omit `projectId` because its
schemas reject it. Owned-system GDS tools never take `projectId` in either mode.

Viewer access exposes Map reads only: `list_maps`, `read_map`, and
`get_map_generation`. A write tool may be absent when no writable project is
available. Tool discovery is authoritative.

## GDS Tools

- `list_game_design_systems`: optional `limit` (1-100) and opaque `cursor`.
  Follow `nextCursor` while `hasMore` is true.
- `read_game_design_system`: `systemId`. Returns system identity, current
  version, and bounded version history.
- `read_project_game_design_system`: account `{ projectId }`; legacy `{}`.
- `get_game_design_system_generation`: `generationJobId`. Jobs move through
  `queued` or `running` to `completed` or `failed`. A completed job returns
  `design_system_id` and `output_version_id`.
- `create_game_design_system`: `title`, optional `summary`, and complete
  `rules`. `rules` is `{ schemaVersion: 1, genres, philosophies, suitableFor,
  rules, tableGuidance }`. Each rule has `id`, `kind` (`principle`,
  `constraint`, `pattern`, `anti_pattern`, or `check`), `title`, `statement`,
  `appliesWhen`, `severity` (`required`, `recommended`, or `warning`), and
  optional `rationale` and `evidence`. Each table guidance item has `table`,
  `purpose`, and `fields`.
- `generate_game_design_system`: `title`, `genres`, `philosophies`,
  `referenceGames`, `artStyle`, and `idempotencyKey`; optional `description`,
  `suitableFor`, `baseSystemId`, and `pastedMarkdown`; up to ten `references`
  shaped as `{ kind: "document" | "table", projectId, resourceId }`. A
  reference game is `{ name, reference, avoid }`. `artStyle` is
  `{ presetId, presetVersion, customization: { direction?, referenceGames,
  avoid? } }`, where each customization reference is `{ name, borrow }`.
- `create_game_design_system_version`: `systemId`, `parentVersionId`,
  `expectedCurrentVersionId`, UUID `idempotencyKey`, and at least one of
  `document`, `rules`, or nullable `artStyle`. A document can contain
  `gameBackground` and requires `designIntent`, `playerFantasy`, `coreLoop`,
  `decisionStructure`, `systemBoundaries`, `progressionEconomy`,
  `contentModel`, `difficultyBalance`, and `experiencePresentation` when used.
- `set_project_game_design_system`: account adds `projectId`; both modes pass
  `designSystemId` and `versionId`.
- `clear_project_game_design_system`: account `{ projectId }`; legacy `{}`.

Reuse an idempotency key only for byte-equivalent intent. On
`IDEMPOTENCY_CONFLICT`, `GDS_JOB_CONFLICT`, or `VERSION_STALE`, stop and read
current state. There is no GDS delete tool. After every mutation, poll a
returned job to terminal state and use a fresh read to verify system, version,
and project binding IDs.

## Create Map V3 Tools

- `list_maps`: account `{ projectId }`; legacy `{}`.
- `read_map`: `mapId`, plus account `projectId`. Returns identity, full V3
  `plan`, `scene`, source document ID, and generation state.
- `create_map_draft`: UUID `idempotencyKey`, `description`, nullable
  `documentId`, up to four `referenceIds`, nullable `styleReferenceId`,
  `referenceRoles`, `referenceUsage`, and `styleCopy`; account adds `projectId`.
  Either a non-empty description or document ID is required. Roles are
  `content` or `layout`; style-copy values are `color_palette`, `outline`,
  `detail`, and `shading`.
- `update_map_draft`: `mapId`, `revisionId`, current integer `saveVersion`, and
  complete `plan` and `scene`; account adds `projectId`.
- `prepare_map_generation`: `mapId`, `revisionId`, current `saveVersion`, plus
  account `projectId`. It freezes the exact revision and returns
  `nextDraftRevisionId`, `assetId`, `generationId`, `planFingerprint`,
  `feeNotice`, `confirmationPurpose`, `confirmationExpiresAt`, and a secret
  `confirmationToken` bound to the asset's current `attemptCount`. It does not
  contact the provider.
- `start_map_generation`: exact `mapId`, `revisionId`, `assetId`,
  `generationId`, 64-character `planFingerprint`, returned
  `confirmationToken`, and literal `confirmPaidGeneration: true`; account adds
  `projectId`.
- `get_map_generation`: the same immutable identity without confirmation fields;
  account adds `projectId`. This is a provider-free database read.
- `advance_map_generation`: the same identity; account adds `projectId`. This
  writer-only tool may resolve an old queued outcome, poll an existing provider
  job, or validate its completed output. It never submits a new paid job.

The V3 Plan is complete, not a patch: `{ schemaVersion: 3, name, summary, map:
{ width, height }, description, references, styleReference, generation }`.
References contain `assetId`, SHA-256 `sha256`, `role`, and `usage`.
`generation` is `{ provider: "pixellab", operation: "create_image_pro",
noBackground: false, seed }`.

The V3 Scene is complete, not a patch: `{ schemaVersion: 3, size, mapImage,
collisionGrid, canvas }`. `mapImage` is null or `{ assetKey: "map-image",
sourceRevisionId, width, height, locked: true }`. `collisionGrid` is null or
`{ version: 1, cellSize: 8, columns, rows, cells, imageSha256 }`. `canvas` is
`{ zoom, panX, panY }`.

## Paid Generation State Machine

The initial request to create a map is intent, not paid confirmation.

1. Read and review the exact draft Plan and Scene.
2. Call `prepare_map_generation` without provider contact.
3. Show `feeNotice` to the user and wait for a later explicit confirmation.
4. Call `start_map_generation` only with the exact returned immutable identity,
   token, and literal confirmation.
5. Editors/admins call `advance_map_generation` and then the provider-free
   `get_map_generation` read through `planned`, `queued`, or `generating` until
   terminal `ready`, `failed`, or `blocked`. Viewers only read persisted state.
6. On `ready`, call `read_map` again and verify the stored identity and image.

A replay of the same confirmed start returns the existing operation. Failed,
rate-limited, and quota-blocked resubmissions require another prepare, fee
notice, later confirmation, and a purpose-bound `retry` start. A confirmation
token is valid only for its bound `attemptCount`; after the attempt advances,
the old token cannot submit again. Never log
or persist the confirmation token, bearer credentials, provider payload, or
signed image URL. An unknown provider submission outcome is not a normal retry:
call prepare again, show the new fee notice, and obtain another later explicit
confirmation before a `replace-unknown` start.

Stable Map errors include `IDEMPOTENCY_CONFLICT`, `MAP_CREATION_IN_PROGRESS`,
`MAP_REVISION_STALE`,
`MAP_CONFIRMATION_REQUIRED`, `MAP_CONFIRMATION_EXPIRED`,
`MAP_CONFIRMATION_MISMATCH`, `MAP_GENERATION_BLOCKED`,
`MAP_GENERATION_FAILED`, `PROVIDER_RATE_LIMITED`, `PROVIDER_QUOTA_EXCEEDED`,
`FIELD_VALIDATION_FAILED`, and `UPSTREAM_UNAVAILABLE`. Re-read state after a
conflict. MCP exposes no map deletion, direct PixelLab operation, Godot scene
mutation, or public publication guarantee.
