# Character Animation MCP Design

**Date:** 2026-08-27
**Status:** Approved design

## Goal

Add a Keco MCP workflow that creates a canonical pixel-art character from text
and then creates reusable animation spritesheets from that character. PixelLab
generation, polling, validation, and persistence run on Keco's servers. The MCP
client never calls PixelLab directly and does not need a local generation
pipeline.

## Product Contract

The workflow has two explicit paid stages:

```text
character description
  -> reviewed character asset draft
  -> paid character generation
  -> verified canonical character PNG
  -> reviewed animation asset draft
  -> paid animation generation
  -> verified horizontal spritesheet
```

The canonical character is the identity anchor for every animation. An
animation describes how that character moves; it does not recreate the
character from text. Multiple `idle`, `walk`, `run`, `attack`, or other clips
may reference the same ready character asset.

The two stages remain separate provider jobs because animation requires the
actual generated character image and each stage may consume provider credits.
Keco must show and confirm each paid operation independently.

## Scope

Version 1 supports:

- text-to-character generation through PixelLab's typed `character-pro`
  capability;
- text-directed animation through PixelLab's typed `animate-character-v3`
  capability;
- one persisted PNG for a canonical character;
- one horizontal PNG spritesheet for each animation asset;
- private Keco storage, signed previews, durable provider state, and retries;
- account MCP endpoints with explicit `projectId` and legacy project-bound MCP
  endpoints without `projectId`;
- read access for viewers and generation access for project editors/admins.

Version 1 does not add a Keco frontend, write Godot resources, materialize files
locally, generate eight-direction rotations, accept arbitrary remote URLs, or
accept a local path as an animation source.

## Unified Asset Model

Characters and animations share one external API and one core asset model. A
strict discriminated plan distinguishes their semantics.

```ts
type CharacterAssetPlanV1 =
  | {
      schemaVersion: 1;
      kind: 'character';
      name: string;
      description: string;
      perspective: 'topdown' | 'platformer' | 'isometric';
      facing: 'front' | 'back' | 'left' | 'right';
      width: number;
      height: number;
      transparent: true;
    }
  | {
      schemaVersion: 1;
      kind: 'animation';
      name: string;
      sourceCharacterAssetId: string;
      sourceCharacterSha256: string;
      motionDescription: string;
      frameWidth: number;
      frameHeight: number;
      frameCount: 4 | 6 | 8 | 10 | 12 | 14 | 16;
      fps: number;
      loop: boolean;
    };
```

Provider-specific argument names are not persisted in the plan. The server
adapter maps the semantic plan to the freshly verified provider contract. It
maps `front/back/left/right` to PixelLab `south/north/west/east`, persists the
verified provider `character_id`, and uses that identity for animation.
Supported dimensions and frame bounds are constants shared by TypeScript,
MCP, and SQL validation.

Canonical character output is square: width and height must match and be one
of `32`, `64`, `96`, or `128`. Animation frame width and height may each be
`16` through `256`, inclusive, and must be divisible by 4 because the provider
may return a larger per-frame canvas such as 136 pixels.

An animation draft may reference only a `ready` character asset in the same
project. Keco stores the source character's SHA-256 in the animation plan. A
changed or missing source hash makes the animation draft stale instead of
silently animating different bytes.

## Persistence

Create a private `character-assets` storage bucket and two project-owned tables.

`character_assets` stores:

- project and creator identity;
- `kind`, name, and optional `source_character_asset_id`;
- the complete semantic plan, `save_version`, and canonical plan fingerprint;
- draft lifecycle state and an idempotency key/input hash;
- timestamps and the latest successful generation attempt reference.

`character_generation_attempts` stores:

- asset identity, immutable generation ID, fingerprint, and attempt number;
- `character-pro` or `animate-character-v3` capability identity;
- provider transport, operation, job ID, and schema fingerprint;
- `planned`, `queued`, `generating`, `ready`, `failed`, or `blocked` status;
- bounded public error code without raw provider payloads;
- private storage path, SHA-256, dimensions, transparency, and typed output
  metadata;
- created and updated timestamps.

The storage path is deterministic and project scoped:

```text
<projectId>/<assetId>/<generationId>/<sha256>.png
```

RLS follows existing project ownership and accepted-collaborator rules. Only
editors/admins may mutate drafts or start generation. Viewers may list, read,
and observe generation state. Signed URLs, provider credentials, confirmation
tokens, and raw provider payloads are never persisted in plans or metadata.

Deleting a project must enqueue every character asset path in the existing
recoverable storage cleanup outbox before database cascade deletion.

## MCP Contract

Expose one unified set of tools:

- `list_character_assets`
- `read_character_asset`
- `create_character_asset_draft`
- `update_character_asset_draft`
- `prepare_character_asset_generation`
- `start_character_asset_generation`
- `get_character_asset_generation`
- `advance_character_asset_generation`

`create_character_asset_draft` accepts the appropriate strict plan fields plus
a UUID idempotency key. Replaying the same key with identical input returns the
same draft; changed input returns `IDEMPOTENCY_CONFLICT`.

`update_character_asset_draft` uses `saveVersion` compare-and-swap. It may edit
only a draft without a started generation. Stale writes return
`CHARACTER_ASSET_REVISION_STALE`.

`prepare_character_asset_generation` validates the current draft, resolves a
fresh provider operation profile, freezes the plan fingerprint, and returns the
fee notice plus a short-lived confirmation token. It does not contact a paid
generation endpoint.

`start_character_asset_generation` requires the exact asset, generation,
fingerprint, attempt count, token, and literal `confirmPaidGeneration: true`.
Replaying the same confirmed start returns the existing attempt and never
submits twice.

`advance_character_asset_generation` polls or validates an existing provider
job only. It never creates a new provider job. `get_character_asset_generation`
is provider-free and returns only persisted state.

Tool results return durable IDs, plans, status, typed output metadata, and a
short-lived preview URL for ready assets. They do not return raw PixelLab
responses or credentials.

## Provider Boundary

Implement character and animation generation in a dedicated
`pixellab-character` Edge Function. Do not add character semantics to
`pixellab-map`.

The adapter owns two typed capabilities:

- `character-pro`, exact live `create_character` MCP transport in `pro` mode;
- `animate-character-v3`, exact live `animate_character` MCP transport in `v3`
  mode with `get_character` retrieval.

The adapter validates live tool schemas and fails closed with
`PROVIDER_CAPABILITY_MISSING` before paid confirmation when the deployed
provider contract is unavailable or incompatible.

The animation adapter discovers the live PixelLab MCP tool and poll operation,
validates their schemas, records schema fingerprints, and maps only declared
fields. It must not fall back to generic Pixflux/Bitforge generation or invent
an unsupported operation.

For animation, the server binds the same-project ready source hash to the
provider character ID stored by character generation. No source URL is exposed
to the MCP client.

## Output Validation

Provider completion is not success. Before marking an attempt `ready`, the
server downloads bounded bytes and validates:

- PNG signature, structure, supported dimensions, and maximum byte size;
- non-empty visible pixels;
- required alpha for canonical characters;
- SHA-256 and the deterministic storage path;
- the source character identity and hash for animation;
- animation width equals `frameWidth * frameCount`;
- animation height equals `frameHeight`;
- positive bounded `fps`, stable animation name, and planned `loop` metadata.

Godot can later use the horizontal sheet directly with `AtlasTexture`. When the
provider returns separate frame files, Keco packs them left-to-right on the
server; the MCP still returns one sheet.

The server uploads validated bytes to private storage, reads the stored object
back, verifies its hash and metadata, and only then atomically transitions the
attempt and asset to `ready`.

## Paid Confirmation And Recovery

Character and animation generation each use the existing purpose-bound signing
infrastructure with distinct purposes. A token binds project, asset, generation,
plan fingerprint, attempt count, and expiry.

The state sequence is:

```text
DRAFT -> PREPARE -> SHOW_FEE_NOTICE -> USER_CONFIRM -> START -> POLL -> VALIDATE -> READY
```

Rules:

- the original creation request is intent, not paid confirmation;
- editing a draft invalidates every earlier confirmation;
- a failed, rate-limited, quota-blocked, or validation-failed resubmission
  requires a new prepare call, a newly shown fee notice, and later confirmation;
- a submission timeout with unknown provider outcome becomes `blocked` and is
  never automatically retried;
- provider authentication and missing capability failures are configuration
  errors, not retryable generation failures;
- polling is idempotent and cannot increment the attempt count;
- a ready character remains immutable as an animation source.

Stable public errors include project authorization, idempotency conflict, stale
draft, confirmation required/expired/mismatched, source character unavailable,
provider capability missing, provider authentication failed, rate limiting,
quota exhaustion, blocked unknown outcome, invalid output, and temporary
upstream failure. Public messages never echo prompts, signed URLs, tokens, or raw
provider errors.

## MCP Registration

Register the tools in account and legacy project modes alongside the existing
GDS and Map tools. Add list/read/get to the read operation class. Add
create/update/prepare/start/advance to the write operation class. Viewer tool
discovery exposes only list, read, and get.

The MCP App bridge calls a dedicated authenticated Keco application route and
keeps the account `projectId` versus legacy bound-project behavior identical to
Create Map.

## Testing

Automated verification covers:

1. strict character and animation plan schemas in app, MCP, and SQL boundaries;
2. idempotent draft creation and stale update rejection;
3. same-project, ready-status, and exact-hash animation source enforcement;
4. viewer/editor/admin tool discovery and authorization;
5. prepare without provider generation contact;
6. token binding, expiry, changed-plan rejection, and replay-safe start;
7. provider capability discovery and semantic argument mapping;
8. character REST and animation MCP mocked submit/poll contracts;
9. rate limit, quota, provider authentication, invalid output, and unknown
   submission outcome handling;
10. PNG alpha, byte limit, dimensions, non-empty pixels, SHA-256, and horizontal
    spritesheet geometry;
11. private storage read-back, RLS, signed preview, and project cleanup outbox;
12. MCP public result shaping and secret/raw-provider redaction;
13. existing Create Map, image upload, MCP telemetry, and project deletion
    regressions.

Normal tests and capability probes never spend provider credits. A real paid
acceptance script is opt-in through explicit environment flags and must use a
controlled project. It performs character generation first, waits for a ready
canonical PNG, then separately confirms and generates one short looping
animation.

## Alternatives Considered

### Separate character and animation MCP domains

Rejected. The two outputs have different plan variants but share permissions,
draft lifecycle, paid confirmation, provider state, persistence, and read
semantics. Separate tool families and tables would duplicate the state machine.

### Generalize `map_assets`

Rejected. Map revisions, collision state, storage paths, and provider invariants
are map-specific. Expanding them would increase migration and regression risk
without improving the character workflow.

### Store generated files only in ordinary Keco library rows

Rejected. Library rows do not provide the provider attempt identity, paid
confirmation binding, unknown-outcome recovery, or immutable source hash needed
for reliable animation generation.

### Generate every animation directly from text

Rejected. It cannot reliably preserve the character's face, clothing, palette,
equipment, scale, and silhouette across clips. The canonical character is the
required identity anchor.

## Non-Goals

- A user-facing character workbench or preview editor.
- Generic image generation or substitution with non-character capabilities.
- Skeleton-keyframe animation.
- Eight-direction character rotation generation.
- Automatic generation of multiple actions in one paid call.
- Packing separate provider frame files into a sheet.
- Godot `SpriteFrames`, `.tres`, or `AnimatedSprite2D` materialization.
- Public asset URLs or public publication semantics.
- Migrating existing map assets or ordinary Keco library images.
