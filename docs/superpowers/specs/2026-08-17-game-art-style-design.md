# Game Art Style v1 Design

**Date:** 2026-08-17
**Status:** Approved by delegated architecture review
**Scope:** Add one built-in Pixel Art visual style to the existing Game Design System creation and version workspace without changing rule generation, immutable-version, retry, project-binding, Agent-policy, or Markdown-export semantics.

## Product Goal

Game Design System creation gains a visual-art decision that is readable during creation and inspectable after generation. Version 1 ships one official `Pixel Art` preset, fixed PixelLab-generated preview assets, and text-only project customization.

The feature is a visual specification layer, not a runtime asset generator. Creating a system never calls PixelLab. Preview images illustrate the official preset and are not exportable production game assets.

## User Experience

The embedded create flow becomes:

1. Foundation
2. Art Style
3. Sources
4. Review

The Art Style stage shows a locked official preset catalog containing one selected `Pixel Art` entry. The main pane shows the preset preview, version, concise specification, and these text-only customization inputs:

- custom direction;
- visual reference games, each with a game name and what to borrow;
- visual avoid guidance.

Visual reference games are separate from the existing top-level `referenceGames`, which remains gameplay-design evidence sent to the model.

The review stage summarizes the selected preset and normalized customization. Validation returns focus to the Art Style stage. A failed or retried durable generation job retains the exact submitted Art Style input.

After creation, the selected Game Design System workspace gains an `Art Style` tab between Overview and Rules. The tab reads the selected immutable version and shows:

- a fixed gameplay-map preview;
- a fixed character preview;
- optional supporting prop, effect, or UI examples when approved assets exist;
- preset identity and revision;
- canonical Pixel Art specification;
- the saved custom direction, visual references, and avoid guidance.

Art Style is read-only in v1. Legacy versions render a neutral `No art style specified` state. Missing preview assets leave the specification readable and show a local unavailable state instead of breaking the workspace.

## Ownership And Data Flow

`artStyle` is a sibling of `document` and `rules` on each immutable Game Design System version:

```ts
type GameDesignSystemVersion = {
  document: GameDesignDocument;
  rules: GameDesignRuleSet;
  artStyle: GameArtStyleSnapshot | null;
};
```

The model contract remains exactly `document + rules`. Art Style input is not inserted into model messages. The server validates the submitted preset identity and customization, loads the built-in preset revision, compiles a complete immutable snapshot, and persists it with the model output.

The existing project binding continues to pin one Game Design System `version_id`. There is no second Art Style binding or generation job.

Agent policy continues to consume pinned structured rules only. Art Style does not silently become system policy in v1. Existing rendered Markdown remains document-and-rules output; Art Style export is a non-goal for v1.

## Input And Snapshot Contracts

The client may submit only the selector and customization:

```ts
type GameArtStyleInput = {
  presetId: 'pixel-art';
  presetVersion: 1;
  customization: {
    direction?: string;
    referenceGames: Array<{
      name: string;
      borrow: string;
    }>;
    avoid?: string;
  };
};
```

The request schema is strict at every object level. The server rejects unknown preset IDs or versions, unknown keys, and any client-supplied compiled fields. The client cannot submit preview paths, canonical copy, palette values, asset hashes, or any other snapshot-owned value.

The stored snapshot is complete and independent from future registry changes:

```ts
type GameArtStyleSnapshot = {
  schemaVersion: 1;
  presetId: 'pixel-art';
  presetVersion: 1;
  title: 'Pixel Art';
  previewAssetSet: {
    id: 'pixel-art-v1';
    map: GameArtStylePreviewAsset;
    character: GameArtStylePreviewAsset;
    supporting: GameArtStylePreviewAsset[];
  };
  specification: {
    visualIdentity: string;
    pixelTechnique: string;
    shapeLanguage: string;
    paletteAndLighting: string;
    characterDirection: string;
    environmentDirection: string;
    propDirection: string;
    effectsDirection: string;
    uiHudDirection: string;
    animationDirection: string;
    accessibility: string;
  };
  customization: {
    direction: string;
    referenceGames: Array<{ name: string; borrow: string }>;
    avoid: string;
  };
};
```

Preview assets use this exact contract:

```ts
type GameArtStylePreviewAsset = {
  sourcePath: `public/game-art-styles/${string}`;
  publicPath: `/game-art-styles/${string}`;
  width: number;
  height: number;
  alt: string;
  sha256: string; // exactly 64 lowercase hexadecimal characters
  bytes: number;
  alpha: 'opaque' | 'transparent';
};
```

`sourcePath` identifies the checked-in repository file, while `publicPath` is the browser URL. Width, height, and bytes are positive integers. Preset files live under a never-overwritten path such as `public/game-art-styles/pixel-art/v1/`. A future replacement creates `v2`; it does not mutate `v1`.

The literal canonical Pixel Art v1 values are checked in at `docs/superpowers/specs/game-art-styles/pixel-art/v1/preset.json`. That file is the only runtime registry input and contains the exact specification copy, preview metadata, asset dimensions, hashes, and paths; implementations must not paraphrase or independently duplicate those values. The adjacent asset manifest is authoring provenance and CI cross-check evidence only. Neither the compiler nor the UI may read runtime values from the provenance manifest.

## Normalization And Limits

- Trim outer whitespace and normalize CRLF to LF.
- Preserve internal line breaks in direction and avoid fields while collapsing trailing spaces.
- Direction is optional and limited to 2,000 characters.
- Avoid is optional and limited to 1,000 characters.
- Visual reference games are limited to eight entries.
- Reference name is required when an entry is present and limited to 120 characters.
- Reference borrow guidance is required and limited to 500 characters.
- Remove fully empty reference rows.
- Deduplicate references case-insensitively by normalized game name while preserving the first occurrence order.
- The complete compiled snapshot is limited to 32 KiB.

## Creation And Inheritance Matrix

| Operation | Art Style result |
| --- | --- |
| New durable generated system | Requires reviewed `pixel-art` v1 input and stores the compiled snapshot |
| Retry/idempotent replay | Reuses the normalized job input and produces the identical snapshot |
| New version of the same system | Inherits the exact parent snapshot server-side |
| Copy existing system | Preserves the current source version snapshot, including `null` |
| Generate using a base system | The explicit current Art Style step wins; base-system Art Style is not inherited |
| Legacy or direct structured creation without Art Style | Stores `null` for compatibility |

The v1 workspace has no Art Style mutation endpoint. Document and Rules edits cannot alter Art Style.

## Persistence And Service Changes

Add nullable `art_style jsonb` to `game_design_system_versions` with object-or-null and 32 KiB constraints. Update:

- version read and write column lists;
- the immutable version creation RPC signature and insert;
- restrictive column-level authenticated grants;
- service parsing and compatibility hydration;
- detail and version API responses;
- copy, retry, and inheritance paths;
- content hashing to cover `{ document, rules, artStyle }`;
- generation-job input hashing to cover normalized Art Style input.

Existing version rows remain `null`; there is no data backfill to Pixel Art.

## Built-In Preset Registry

The registry is code-owned and immutable by identity. It maps `(presetId, presetVersion)` to canonical specification copy and a preview asset manifest. Registry resolution happens only on the server compiler. UI catalog data is derived from the same validated registry projection, avoiding a second editable source.

Unknown, unavailable, or retired preset revisions fail validation before the durable job starts. Already stored snapshots remain readable even if a preset is no longer offered for new creation.

## PixelLab Preview Assets

All preview assets are newly generated for this feature with PixelLab Pro. Existing repository artwork is not reused. Generation is an offline authoring step with this sequence:

1. Discover the live hosted MCP tool list and exact schemas.
2. Record prompts, dimensions, model operation, and expected outputs in an asset manifest.
3. Generate multiple map candidates from distinct prompts.
4. Independently review candidates for visual comfort, route readability, composition, Pixel Art craft, and absence of text or malformed content.
5. Use the approved map as a style reference for multiple character candidates.
6. Independently review character anatomy, adult silhouette, transparency, palette match, and visual comfort.
7. Generate supporting examples only when they materially improve preset understanding.
8. Validate PNG decoding, dimensions, alpha requirements, non-empty pixels, file size, and SHA-256.
9. Copy only approved outputs to `public/game-art-styles/pixel-art/v1/` and record provenance hashes.

The baseline safety direction excludes horror, gore, uncanny anatomy, oppressive enclosures, isolated circular arenas, threatening imagery, readable generated text, and dark desaturated mood.

## Error Handling

- Invalid or forged Art Style input returns a field-addressable 400 response before job creation.
- A generation retry never recompiles from mutable client state; it uses the persisted normalized job input.
- Unknown stored snapshots fail locally in the Art Style view while document and rules remain usable.
- Missing or failed preview images show per-asset unavailable states and retain alt text/specification content.
- Legacy `null` is an ordinary empty state, not an error.
- PixelLab is never called by product runtime, so provider availability cannot block user creation.

## Accessibility And Responsive Behavior

- The single preset is a real selected radio/listbox option with a visible locked-v1 note.
- Preview images have meaningful alt text and intrinsic aspect ratios.
- Text carries all canonical guidance; no requirement exists only inside an image.
- On narrow screens the catalog precedes the preview and the specification follows the gallery.
- Existing workspace tab scrolling and system-library drawer behavior remain intact.
- Fixed pixel assets render with intentional nearest-neighbor scaling only when enlarged by an integer-compatible preview container; otherwise the browser preserves their intrinsic aspect ratio without distortion.

## Testing

Unit and service coverage must include:

- compiler determinism and normalization limits;
- unknown preset and forged compiled-payload rejection;
- visual-reference separation from existing gameplay references;
- job idempotency and retry preservation;
- initial persistence and `{ document, rules, artStyle }` content hashes;
- ordinary child inheritance;
- copy and base precedence;
- legacy `null` hydration;
- RPC immutability, size constraints, and column visibility;
- preview manifest path, dimensions, hashes, and missing-asset fallback;
- Agent regression proving rule-policy injection is unchanged;
- Markdown regression proving existing export semantics are unchanged.

React and Playwright coverage must include:

- four-stage create navigation;
- selected and locked Pixel Art preset;
- field validation returning to Art Style;
- Review summary and exact submitted payload;
- values preserved across failed job and retry;
- Art Style tab for current and historical versions;
- legacy empty state;
- fixed preview load failure;
- desktop and mobile layout without horizontal overflow.

## Non-Goals

- Runtime or per-user PixelLab generation.
- User-uploaded or project-bound visual references.
- More than one preset.
- Art Style editing after creation.
- Art Style-specific diffs or merge conflicts.
- Art Style Markdown export.
- Agent enforcement or asset generation from Art Style.
- Treating preview images as production-ready game assets.

## Acceptance Criteria

The release is complete when a user can create a Game Design System through the four-stage flow with the Pixel Art preset and text customization, the resulting immutable version stores and returns the exact compiled snapshot, current and historical versions render newly generated fixed PixelLab character and map previews, legacy systems remain usable with a clear empty state, project binding and Agent rules behave exactly as before, and the focused unit, route, component, migration, and Playwright suites pass.
