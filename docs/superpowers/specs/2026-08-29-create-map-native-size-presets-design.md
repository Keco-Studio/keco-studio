# Create Map Native Size Presets

**Date:** 2026-08-29

## Goal

Expand Create Map V3 from three output profiles to a practical catalog of
PixelLab-native size presets. Every accepted size is sent unchanged to
`create_image_pro`; Keco does not resize, crop, pad, or otherwise transform the
generated image.

## Provider Evidence

The live PixelLab MCP `tools/list` schema for `create_image_pro` reports integer
`width` and `height` fields with a minimum of 16 pixels. Its current field
description identifies `512x512` as the square maximum and `688x384` as the
16:9 maximum.

PixelLab's official V2 OpenAPI schema for `generate-image-v2` reports:

- width: 16 through 792 pixels;
- height: 16 through 688 pixels;
- the effective maximum depends on aspect ratio.

Create Map collision grids use 8-pixel cells, so every product preset must also
have width and height divisible by 8. The selected presets stay within the
provider's documented axis bounds and a conservative canvas area no larger
than the already supported `688x384` profile.

## Supported Presets

The catalog contains 17 exact width/height pairs:

| Orientation | Presets |
| --- | --- |
| Square | `256x256`, `384x384`, `512x512` |
| Landscape | `512x288`, `512x320`, `512x384`, `576x384`, `624x416`, `640x320`, `688x384` |
| Portrait | `288x512`, `320x512`, `384x512`, `384x576`, `416x624`, `320x640`, `384x688` |

The existing three presets remain supported. Ordering is stable: square,
landscape, then portrait; dimensions increase within each useful grouping.

## Design

### Product UI

The existing `Output profile` select remains the only size control. It lists
all 17 exact presets and continues to write the selected pair into
`plan.map.width` and `plan.map.height`. There is no custom-size input.

### Validation Ownership

The TypeScript `DIRECT_MAP_PROFILES` catalog remains the browser and planner
authority. Pair validation must compare exact pairs rather than independently
validating width and height, so values from two different presets cannot be
combined.

Runtime boundaries that cannot import the browser catalog keep explicit mirrors:

- the PixelLab Edge Function submission guard;
- the PostgreSQL V3 payload validator;
- the GDD map brief contract and compiler prompt.

Focused parity tests enumerate the same 17 pairs at each boundary. This makes a
future one-layer-only edit fail in CI instead of reaching paid generation.

### Data Flow

1. Direct Create Map planning or GDD map compilation chooses one preset.
2. Browser and server validation accept only an exact catalog pair.
3. The complete V3 Plan and matching Scene are persisted.
4. Pre-generation validation runs before fee confirmation and provider contact.
5. The Edge Function sends the same width and height to `create_image_pro`.
6. Generated PNG dimensions must exactly match the approved Plan before the
   asset can become `ready`.

### Failure Behavior

An unsupported or mismatched pair remains a validation failure with the stable
`unsupported_profile` issue in application code or `FIELD_VALIDATION_FAILED`
through MCP/database boundaries. It must not be converted into the generic
`MAP_GENERATION_FAILED` error and must not start a paid provider request.

Provider capability drift still fails closed as `pixellab_capability_missing`.
No fallback model, resize operation, retry, or nearest-size substitution is
introduced.

## Affected Areas

- `src/features/create-map/model/directMapSchema.ts`
- `src/features/create-map/components/DirectMapPlanInspector.tsx` through its
  existing catalog import
- `src/lib/server/createMapPlanner.ts`
- `src/lib/gdd-generation/maps/contracts.ts`
- `src/lib/gdd-generation/maps/compiler.ts`
- `supabase/functions/pixellab-map/direct-map.ts`
- a new forward-only Supabase migration replacing the V3 payload validator's
  supported-pair predicate
- focused unit, Edge Function, migration, GDD, and end-to-end expectations

Existing migrations are historical records and will not be edited.

## Verification

Tests must prove:

- all 17 presets pass `MapPlanV3` validation;
- representative unsupported, out-of-bound, non-preset, and mixed-pair values
  fail with `unsupported_profile`;
- the output selector renders all presets and persists the exact selected pair;
- the planner and GDD compiler expose only catalog values;
- the database validator accepts every catalog pair and rejects other pairs;
- the Edge Function forwards each allowed pair unchanged and rejects other pairs
  before provider submission;
- Scene, generated image, and collision-grid dimensions must still match the
  selected Plan exactly;
- existing `512x512`, `688x384`, and `384x688` workflows do not regress.

No paid PixelLab generation is required for unit verification. A live paid
acceptance run, when separately authorized through the existing fee-confirmation
flow, may be used to verify newly added profiles against production provider
behavior.

## Out Of Scope

- arbitrary width/height inputs;
- image resizing, cropping, padding, or upscaling;
- alternative PixelLab models or REST fallbacks;
- changing generation pricing or confirmation behavior;
- changing collision-grid cell size;
- generating a map as part of this implementation.
