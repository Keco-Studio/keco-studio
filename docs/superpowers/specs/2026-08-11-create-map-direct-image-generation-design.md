# Create Map Direct Image Generation Design

**Date:** 2026-08-11

**Status:** Approved for implementation planning

**Supersedes:** `2026-08-10-create-map-v2-layered-generation-design.md` for newly created maps and new generation jobs

## Summary

Create Map will stop generating terrain, path, and obstacle resources for Keco-side background composition. DeepSeek will produce a complete map plan whose `description` is already the final PixelLab prompt. After review and persistence, Keco will pass the plan fields directly to PixelLab `create_image_pro`, technically validate the returned image, store it privately, and display it in the workbench.

The generated map is one baked image. Roads, terrain, buildings, vegetation, water, and decorative objects are pixels in that image rather than independently movable visual assets. Gameplay overlays such as collision regions, spawn points, and interaction markers remain Keco-owned data, but direct image generation does not infer or generate them.

## Goals

- Let DeepSeek plan the complete visual map in one provider-ready description.
- Let the plan choose a supported output size and optional reference images.
- Use PixelLab's current highest-quality general image operation, `create_image_pro`.
- Send the approved plan fields to PixelLab without a layout-blueprint step or prompt rewrite.
- Validate and privately persist one complete opaque map image.
- Display the verified result in the Create Map workbench.
- Preserve generation identity, stale-result protection, retries, and saved-map restore.

## Non-Goals

- Terrain or path tileset generation.
- Atlas normalization or connectivity-mask composition.
- Keco-side background rasterization.
- Separate visual assets for trees, buildings, roads, bridges, or props.
- Automatic semantic image review by another vision model.
- Automatic collision, navigation, spawn, or interaction extraction from the image.
- Silent fallback to PixelLab Pixen, Pixflux, map-object, or tileset operations.

## Product Flow

```text
free-form description + optional Document + optional references
  -> DeepSeek creates MapPlan V3
  -> user reviews and edits the final PixelLab description, dimensions, and references
  -> user saves the Plan
  -> Keco publishes an immutable generation revision
  -> user explicitly confirms the paid generation
  -> Keco calls PixelLab create_image_pro with the Plan fields
  -> Keco polls get_image
  -> Keco validates, stores, hashes, and reads back the returned PNG
  -> the verified map image is installed and displayed in the workbench
```

Keco does not generate a layout blueprint and does not compile, summarize, expand, translate, or otherwise rewrite the approved `description` between Plan review and PixelLab submission.

## MapPlan V3

New direct-image maps use `schemaVersion: 3`. The plan contains the complete provider input and a small amount of Keco-owned display metadata.

```ts
type MapPlanV3 = {
  schemaVersion: 3;
  name: string;
  summary: string;
  map: {
    width: number;
    height: number;
  };
  description: string;
  references: Array<{
    assetId: string;
    sha256: string;
    role: 'content' | 'layout';
    usage: string;
  }>;
  styleReference: null | {
    assetId: string;
    sha256: string;
    copy: Array<'color_palette' | 'outline' | 'detail' | 'shading'>;
  };
  generation: {
    provider: 'pixellab';
    operation: 'create_image_pro';
    noBackground: false;
    seed: number | null;
  };
};
```

### Plan Rules

- `description` is the exact PixelLab description and must be non-empty and at most 2,000 characters.
- DeepSeek should write the provider description in concise English even when the source request is in another language.
- The description covers the entire visible map: projection, composition, terrain, routes, landmarks, structures, vegetation, lighting, palette, pixel-art treatment, and important exclusions.
- The description must not contain URLs, credentials, provider instructions, or dynamic Keco UI text.
- `generation.operation` is fixed to `create_image_pro` and `noBackground` is fixed to `false`.
- A plan may contain at most four labelled content/layout references and at most one style reference.
- Reference records store Keco asset identity and hashes, never signed URLs or base64 payloads.
- References must be user-selected or source-authorized assets. DeepSeek cannot invent asset IDs or hashes.
- Width and height are selected by the plan but must match a provider-supported direct-map profile.

The initial supported profiles are `512x512`, `688x384`, and `384x688`. This avoids silent resizing and keeps provider behavior explicit. Additional profiles may be added only after live schema and paid-output verification.

## Planner

The planner receives:

- the user's map request;
- optional authorized Document Markdown;
- the metadata for user-selected reference assets;
- the supported direct-map profiles.

DeepSeek returns a complete `MapPlanV3` through a required structured tool call. Normalization may repair representation details such as trimming strings or canonicalizing an enum, but it must not compose a second provider prompt. Invalid output receives one correction attempt with the complete validation issues.

Plan review exposes `description`, size, references, style-copy choices, and seed. Camera angle and projection live only in the final description so they cannot disagree with a second structured field. The user edits `description` directly; the saved value remains byte-for-byte identical to the value submitted to PixelLab, apart from JSON transport encoding.

## PixelLab Invocation

The Edge Function discovers the live `create_image_pro` and `get_image` schemas before submission. Missing or incompatible capabilities block the asset; they do not trigger a lower-quality fallback.

The provider arguments are a direct mapping:

```ts
{
  description: plan.description,
  width: plan.map.width,
  height: plan.map.height,
  no_background: false,
  reference_images: resolvedReferences,
  style_image_url: resolvedStyleReference,
  style_copy: plan.styleReference?.copy ?? null,
  seed: plan.generation.seed,
}
```

`resolvedReferences` contains at most four labelled, temporary HTTPS URLs and their approved `usage`. Keco resolves these URLs server-side from the recorded asset IDs and hashes immediately before provider submission. The style reference is resolved in the same way. Temporary URLs are never written to the Plan, revision, asset metadata, provider state, or logs.

At direct-map sizes, PixelLab normally returns one candidate. If the live response contains multiple candidates, Keco deterministically selects the first provider-ordered candidate and records only the candidate index, not the provider response body or download URL.

## Persistence

V3 adds one durable asset kind, `map_image`. A generation revision creates exactly one primary `map_image` plan.

The asset records:

- map revision ID;
- generation ID;
- Plan fingerprint;
- exact provider operation and live schema fingerprint;
- approved dimensions and seed;
- reference asset IDs and hashes;
- status and bounded error code;
- private storage path, SHA-256, width, height, and opacity result.

The asset lifecycle is:

```text
planned -> queued -> generating -> ready
                            \-> failed
                            \-> blocked
```

`validating` is an Edge/client phase while the completed provider result is downloaded, checked, stored, and read back. It is not a durable database status: the asset remains `generating` until the verified storage transition atomically changes it to `ready`.

Publishing retains the existing immutable generation-revision and next-editable-draft pattern. A retry creates a new provider attempt for the same immutable Plan identity. A user-requested regenerate after a ready result creates a new generation revision so the accepted prior image remains recoverable.

## Technical Image Validation

The first version performs technical validation only. It does not use a vision model to decide whether the picture semantically matches the Plan.

Before an image becomes ready, Keco verifies:

- the payload is a decodable PNG within the configured byte limit;
- width and height exactly match the approved Plan;
- the image is non-empty and contains meaningful pixel variation;
- the map is fully opaque because `no_background` is false;
- the response and download URL satisfy existing HTTPS and size restrictions;
- upload to the private bucket succeeds;
- read-back bytes match the uploaded bytes;
- the stored SHA-256 matches the validated bytes;
- durable JSON contains no credentials, temporary URLs, base64 data, or raw provider bodies.

Validation failure leaves the map image unbound and retryable. The previous ready generation, if any, remains visible and recoverable.

## Frontend

### Plan Review

The workbench shows:

- map name and summary;
- width and height;
- the complete editable PixelLab description;
- selected content/layout references with their usage;
- the optional style reference and style-copy controls;
- seed control;
- validation issues, save state, and generation cost confirmation.

The existing schematic terrain/path/obstacle canvas and inspectors are removed from the V3 path because their geometry no longer drives generation.

### Generation

The resource panel becomes a single-map progress panel:

```text
Ready to generate
Awaiting confirmation
Submitting
Generating
Validating
Ready
Failed / Blocked
```

Only the explicit confirmation action can move a planned image into a paid provider request. Retry is shown for `failed` or retryable `blocked` results. Regenerate is shown for a ready result and creates a new generation revision.

### Result

Once ready, the central canvas displays the exact privately stored image through a short-lived signed URL. Image loading uses the existing generation/revision epoch protections so an old signed URL or stale poll cannot replace the current map.

The initial V3 result view displays only the locked map image. Keco-owned gameplay overlays such as collision regions and markers are not PixelLab inputs or independently generated visual assets; displaying or editing them on V3 maps is separate future work.

## V2 Compatibility

- Existing V2 revisions and assets are not rewritten or deleted.
- Newly created maps use V3 direct-image generation.
- A schema-version router keeps existing V2 maps readable through their current scene renderer in read-only compatibility mode.
- V2 maps cannot continue a V2 resource generation from the V3 generation panel.
- Converting a V2 map to V3 requires an explicit future action that creates a new V3 Plan and revision; there is no automatic migration.

## Errors

- Invalid DeepSeek Plan: return bounded validation issues and make one correction attempt.
- Unsupported dimensions: reject the Plan or user edit before save/generation; never silently resize.
- Missing reference or hash mismatch: block before paid submission.
- Missing `create_image_pro`: mark `pixellab_capability_missing`; do not fall back.
- Quota exhaustion: show a bounded billing/quota error without losing the saved Plan.
- Rate limit or transient upstream failure: preserve the asset for retry.
- Provider rejection: preserve the sanitized provider category and a user-actionable message.
- Poll timeout: stop client polling while preserving durable provider identity for resume.
- Invalid PNG, dimensions, opacity, or read-back: mark validation failure and do not bind the image.
- Stale revision, generation, request, or signed-image completion: discard it without changing current state.

## Verification

### Unit

- MapPlan V3 schema, supported profiles, prompt length, fixed provider fields, and reference limits.
- DeepSeek structured output, optional Document behavior, correction retry, and exact description preservation.
- Direct provider argument mapping with no prompt rewrite.
- Reference authorization, hash binding, and temporary URL exclusion.
- generation identity, stale completion, retry, regenerate, and restore behavior.
- frontend Plan review and single-map status states.

### Edge And Database

- live `create_image_pro` and `get_image` discovery with captured schemas;
- exact submit and poll mappings;
- provider errors, quota errors, and timeouts;
- PNG decode, exact dimensions, opacity, nonblank validation, upload, hash, and byte-for-byte read-back;
- V3 RLS and immutable revision behavior;
- absence of credentials, raw provider responses, base64 data, and temporary URLs in durable storage.

### Browser

- description-only V3 Plan creation;
- optional Document and reference selection;
- Plan editing and save gating;
- explicit paid confirmation;
- progress, failure, retry, and regenerate states;
- verified map rendering on desktop and mobile;
- save, refresh, and restore;
- stale open, poll, and signed-image protection;
- V2 compatibility routing.

### Live Acceptance

Run one paid `create_image_pro` generation using an approved V3 revision. Confirm the live schema fingerprint, exact submitted dimensions and description, reference behavior when configured, returned PNG validation, private storage binding, front-end rendering, restore behavior, and sanitized durable metadata. Delivery is incomplete until this live acceptance passes.

## Delivery Boundary

This design is complete when new maps use the direct-image V3 path, the old resource decomposition is no longer invoked for V3, a technically verified image is displayed and restorable, and one live paid PixelLab generation passes. Semantic vision-model review and automatic gameplay-overlay extraction remain separate future work.

## Verification Record (2026-08-11)

Task 10 added mocked browser coverage and live acceptance tooling without issuing a paid request.

- RED: the initial one-test Playwright scaffold failed because the Project source query intercept did not yet match the V3 browser request, so the required Project option never appeared. This established that the workflow depended on the new V3 mock wiring.
- Mocked browser GREEN: `8 passed` in Chromium. The suite covers description-only planning, optional Document and uploaded references, exact prompt persistence, one `map_image`, paid confirmation, `submit -> poll -> validate`, validation failure/retry, immutable regeneration, refresh/restore, stale-open rejection, V2 read-only routing, and desktop/mobile layout evidence.
- Focused Jest GREEN: `37` suites and `245` tests passed through `npm run test:create-map-v3`.
- Static GREEN: focused ESLint completed with zero errors, `npm run typecheck` completed with zero errors, and `git diff --check` completed with zero errors.
- Mocked output: exactly one opaque `512x512` `map_image` using `create_image_pro`; the mock verifies a 64-character SHA-256 value and private storage-shaped binding. This is not live provider evidence.
- Screenshots: `test-results/e2e-specs-create-map-v3-Cr-a1999--desktop-and-mobile-layouts-chromium/create-map-v3-1440x900.png` and `test-results/e2e-specs-create-map-v3-Cr-a1999--desktop-and-mobile-layouts-chromium/create-map-v3-390x844.png`.
- Live capability discovery: blocked with `pixellab_not_configured`; no live schema fingerprints are available.
- Paid/browser acceptance: not run. Live dimensions, hash prefix, private read-back, and restored-browser screenshot remain blocked on an explicit authenticated editor, authoritative V3 map/revision IDs, PixelLab credentials, and `KECO_ACCEPTANCE_CONFIRM_PAID=YES`.
