# GDD Development Context And Art Consistency

**Date:** 2026-09-08
**Status:** Proposed for implementation

## Goal

Make document-driven game development consume the exact Game Design System and
art-style snapshot that produced a GDD, expose the GDD's referenced image assets
with explicit usage semantics, and carry those inputs through real map and
character generation interfaces.

This work has two separate success conditions:

1. **Asset reuse:** an existing image is reused or derived from according to its
   stable identity, intended role, and runtime compatibility.
2. **Style consistency:** newly generated images receive the correct historical
   art-style context and are evaluated against observable visual constraints.

Neither condition is evidence for the other. Reusing an image does not prove
style consistency, and passing an art-style hash does not prove the generated
pixels match the style.

## Current State

Generated GDDs already retain the necessary provenance internally:

- the generation job is pinned to one `design_system_id` and `version_id`;
- the immutable job input contains the complete `GameArtStyleSnapshot`;
- the generated Document stores `gdd_generation_job_id`;
- Document metadata records `designSystemId`, `versionId`, and `jobId`;
- GDD map artifacts retain their source GDS version, Map Brief, style contract,
  map revision, and generated map asset.

The missing boundary is the GDD-to-development read path. MCP `read_document`
returns Markdown and a state token, but not the GDD generation provenance,
historical GDS snapshot, resolved image inventory, or asset-use semantics. A CLI
can separately read the project's current GDS binding, but that binding may have
changed since the GDD was generated.

Style propagation is also incomplete:

- GDD V2 stores `artStyle` in its input but omits it from the main GDD prompt;
- the built-in Agent injects GDS rules but does not load Art Style;
- the Map Brief compiler receives a textual style contract, but the generated
  Map Plan fixes `references` to `[]` and `styleReference` to `null`;
- Character Plan V1 accepts only a textual description and no style/reference
  asset identity;
- GDS preview images are repository preview files, not project-scoped provider
  asset IDs.

## Design Principles

### Historical provenance wins

For a generated GDD, development must resolve the GDS version through
`documents.gdd_generation_job_id -> gdd_generation_jobs.version_id`. It must
never substitute the project's current GDS binding. A non-generated Document
returns no origin. Selecting the current project binding for that Document is a
separate, explicit Slice source decision and is never performed by the context
resolver.

### Keep one art-style model

`GameArtStyleSnapshot` remains the canonical, immutable style model. Do not add a
parallel `VisualStyleContract`. Category-specific compilers derive bounded
provider-neutral projections for map, character, UI, VFX, environment, and
animation consumers. Provider adapters translate those projections into the
capabilities of a concrete generation API.

### Separate image intent from compatibility

Every resolved image has two independent classifications:

- `intendedRole`: what the author or source workflow says the image is for;
- `runtimeCompatibility`: whether the bytes and metadata satisfy the selected
  engine target and asset kind.

An image may be intended as a runtime asset and still be incompatible. A
compatible image marked as concept-only must not silently become a runtime
asset.

### Preserve authoritative asset identity

An existing Keco asset ID, revision ID, and SHA-256 are the reuse identity.
Signed URLs and public preview paths are delivery mechanisms, not identity.
Every derivative records its source identity and hash.

## MCP Read Contract

Add a read-only MCP tool:

```text
read_gdd_development_context(documentId, targetProfile?)
```

`targetProfile` is optional and bounded. Version 1 supports:

```ts
type DevelopmentTargetProfile = {
  engine: 'godot-4';
  assetKind: 'background' | 'map_image' | 'character' | 'sprite' |
    'animation' | 'tileset' | 'ui' | 'effect';
  width?: number;
  height?: number;
  transparent?: boolean;
  tileSize?: number;
  frameWidth?: number;
  frameHeight?: number;
  frameCount?: number;
};
```

Unknown keys and unsupported engine or asset kinds are rejected. Dimensions,
tile size, and frame values use the existing bounded generation limits.

The tool is project-scoped and returns a bounded DTO:

```ts
type GddDevelopmentContext = {
  document: {
    id: string;
    epoch: number;
    revision: number;
    contentHash: string;
    updatedAt: string;
  };
  origin: null | {
    generationJobId: string;
    designSystemId: string;
    versionId: string;
    versionNumber: number;
    versionContentHash: string;
  };
  artStyle: null | {
    snapshot: GameArtStyleSnapshot;
    contentHash: string;
    previewReferences: ArtStylePreviewReference[];
  };
  assets: GddDevelopmentAsset[];
  warnings: DevelopmentContextWarning[];
};

type GddDevelopmentAsset = {
  sourceType: 'gdd_map_artifact' | 'resource_reference' | 'markdown_image';
  assetId: string | null;
  revisionId: string | null;
  sha256: string | null;
  kind: 'map_image' | 'image' | 'unknown';
  contentType: string | null;
  width: number | null;
  height: number | null;
  hasTransparency: boolean | null;
  intendedRole: 'runtime_asset' | 'runtime_candidate' | 'style_reference' |
    'layout_reference' | 'concept_only' | 'unclassified';
  runtimeCompatibility: {
    status: 'compatible' | 'incompatible' | 'unknown';
    targetProfileHash: string | null;
    reasons: string[];
  };
  delivery: null | {
    imageUrl: string;
    expiresAt: string | null;
    ephemeral: true;
  };
};

type ArtStylePreviewReference = {
  publicPath: string;
  sha256: string;
  width: number;
  height: number;
  intendedRole: 'concept_only';
};

type DevelopmentContextWarning = {
  code: 'ORIGIN_UNAVAILABLE' | 'ART_STYLE_UNSUPPORTED' |
    'ASSET_UNAVAILABLE' | 'IMAGE_UNCLASSIFIED';
  sourceId: string | null;
  message: string;
};
```

The first version reports compatibility as `unknown` unless the caller supplies
a supported target profile. `targetProfileHash` is the canonical JSON hash of
the validated input profile. Compatibility checks use metadata and typed asset
contracts; they do not infer compatibility from appearance.

`delivery` is transport only. For an authorized Keco asset it may contain a
short-lived signed URL generated at read time. It is never included in hashes,
persisted into a SlicePlan, or treated as asset identity. External Markdown
image URLs may be reported for human inspection but remain unclassified and are
not fetched automatically.

The tool resolves generated provenance using service-side authorized joins. It
returns the exact historical GDS version even when the project currently pins a
different version. Unsupported or corrupt stored Art Style produces a bounded
warning and `artStyle: null`; it does not expose raw unvalidated JSON.
Art Style hashes use the repository's canonical sorted-key JSON hashing rather
than raw serialization order.

### Asset classification

The resolver applies these defaults:

| Source | Default intended role | Reason |
| --- | --- | --- |
| GDD generated map artifact | `runtime_candidate` | It is a complete opaque map image without collision, navigation, TileMap, or tileset data. |
| Explicit authored layout reference | `layout_reference` | It constrains composition, not rendering identity. |
| Explicit authored style reference | `style_reference` | It constrains palette, shape, and rendering treatment. |
| Ordinary Markdown image | `unclassified` | A URL and alt text do not prove author intent or durable asset identity. |
| GDS preset preview | `concept_only` | Existing previews are product documentation, not production game assets. |

When a structured source already carries explicit role metadata, that metadata
overrides only the default intended role. It never overrides runtime
validation. P1 does not add a GDD image-role editor. A user decision for an
`unclassified` image is recorded in the immutable SlicePlan and does not mutate
the source GDD.

Ordinary Markdown images without durable Keco identity remain visible in the
inventory but cannot be reused automatically. The context returns a warning so
the Slice can request classification or import the image through the existing
Keco upload boundary before using it.

## Art-Style Propagation

### GDD generation

Inject the complete validated `GameArtStyleSnapshot` into the GDD V2 context as
untrusted declarative design data. The prompt must use it when writing visual,
presentation, UI, character, environment, effects, and animation direction. It
must not invent provider instructions or treat preview subject matter as project
facts.

The GDD's visible art direction is a project-specific interpretation of the
snapshot, not a replacement for the snapshot. Downstream development reads the
immutable snapshot from provenance rather than attempting to reconstruct it
from prose.

### Built-in Agent

Load `art_style` beside the currently pinned GDS rules and expose a bounded,
sanitized art-style context separately from rule policy. Rule authorization and
Art Style remain different inputs; Art Style must not become system-level tool
or permission policy.

### Category compilers

Add pure deterministic compilers over `GameArtStyleSnapshot`:

```text
compileMapArtDirection(snapshot, projectConstraints)
compileCharacterArtDirection(snapshot, projectConstraints)
compileUiArtDirection(snapshot, projectConstraints)
compileVfxArtDirection(snapshot, projectConstraints)
compileAnimationArtDirection(snapshot, projectConstraints)
```

Each compiler selects relevant existing fields and adds explicit project-level
constraints when available, including camera/view, tile size, pixels per unit,
character proportions, palette lock, outline width, transparency, native output
size, and animation frame rate. Missing project constraints remain explicitly
unknown; defaults are not presented as GDS-authored facts.

Rendering style must be separated from preview subject matter. For example,
`Pixel Art` may constrain pixel clusters, antialiasing, shading, outlines, and
palette behavior, but must not force a village, explorer, top-down adventure, or
calm exploration theme into unrelated projects. Existing immutable presets stay
readable; corrected behavior ships through a new preset version or through a
compiler rule that excludes preview-only subject matter.

## Generator Integration

### Map

Extend GDD map planning so resolved reference assets can populate Map Plan
`references` and `styleReference`. The Map Brief textual style direction remains
available, but it is not a substitute for image conditioning.

The adapter must distinguish:

- layout reference: copy spatial organization only;
- style reference: copy only explicitly selected style dimensions;
- runtime candidate: reuse exact bytes when compatible, otherwise create a
  derivative that records the source asset and revision;
- concept-only or unclassified: never submit automatically.

### Character and animation

Evolve Character Plan with an additive schema version that can carry Keco-owned
style and source references. Do not overload `description` with URLs or provider
IDs. Animation continues to bind the exact source character ID and SHA-256 and
inherits the character's resolved style provenance.

Provider adapters must report whether the selected capability supports each
reference role as `exact`, `fallback`, or `unavailable`. A missing required
reference capability blocks generation instead of silently reverting to a text-
only request.

### GDS preview references

GDS preview files remain non-production and cannot be passed as project asset
IDs. If product policy later allows them as style-conditioning inputs, introduce
an explicit server-owned import/translation step that creates a provider-usable
reference with retained source path and SHA-256. Do not teach the CLI to treat a
public path as an asset identity.

## GDD-To-Slice Workflow

For `SourceProfile.kind: gdd`, preflight must call
`read_gdd_development_context` after resolving the Document identity. It records:

- the GDD state token and content hash;
- the historical GDS version and version content hash;
- the Art Style content hash;
- every selected source asset ID, revision ID, SHA-256, intended role, and
  compatibility result;
- any user decisions for unclassified or incompatible images.

AssetPlan creation then chooses exactly one evolution strategy:

```text
reuse_exact
extend_compatible
migrate_additive
derive_from_source
create_new
```

`create_new` is valid only when discovery proves that no compatible source exists
or the plan intentionally needs a new visual object. A changed project GDS
binding does not alter an active or resumed Slice; the run remains pinned to the
GDD's historical provenance.

## Visual Validation

Passing hashes proves that the correct inputs were used. It does not prove style
similarity. Verification therefore records both:

1. provenance assertions: snapshot hash, source asset hashes, provider adapter,
   and exact/fallback/unavailable capability decisions;
2. output assertions: category-specific observable criteria such as palette
   distribution, native pixel geometry, antialiasing, perspective, outline
   behavior, silhouette scale, transparency, frame consistency, and UI contrast.

Deterministic checks cover measurable properties. A visual review covers
semantic criteria that cannot be established from metadata. A failed style
review regenerates only the failed asset and records the changed prompt or
reference input.

## Failure And Compatibility Behavior

- A generated GDD with missing job provenance returns a warning and no guessed
  historical GDS.
- A deleted or unauthorized historical GDS returns a bounded unavailable result;
  the tool never falls back silently to the current binding.
- Legacy and manually-authored GDDs may have `origin: null` and require an
  explicit source decision before style-dependent generation.
- Missing map assets stay in the inventory with unavailable identity and do not
  trigger automatic regeneration during a read.
- Unsupported Art Style snapshots remain non-fatal for reading but block any
  task whose acceptance criteria require a pinned style.
- Existing GDD, map, GDS, and Character Plan contracts remain readable. New
  fields and schema versions are additive.

## Delivery Stages

### P0: Correct context propagation

- inject Art Style into the GDD V2 prompt;
- expose and test service-side resolution from a GDD Document to its generation
  job and exact historical GDS version;
- ensure current project binding is never substituted for historical provenance;
- load bounded Art Style context in the built-in Agent.

### P1: Development context and image inventory

- add the MCP `read_gdd_development_context` tool;
- resolve GDD map artifacts and recognized resource references;
- report ordinary Markdown images as unclassified;
- update GDD Slice preflight to consume and persist the returned context.

### P2: Real generator reference support

- connect GDD map plans to compatible layout/style references;
- add an additive Character Plan reference contract;
- translate Keco asset identities through provider adapters;
- enforce exact/fallback/unavailable capability decisions.

### P3: Result-level visual validation

- add deterministic category checks;
- add structured visual-review criteria and evidence;
- surface provenance pass and visual-style pass as separate statuses.

Each stage is independently releasable. P2 must not claim end-to-end style
consistency until P3 evidence exists.

## Testing

Focused tests must cover:

- GDD prompt inclusion, sanitization, size bounds, and subject-matter isolation;
- historical version resolution after a project changes or clears its binding;
- cross-project and unauthorized Document/GDS/asset rejection;
- generated, legacy, manually-authored, deleted-provenance, and unsupported-style
  GDD contexts;
- stable content hashing and bounded MCP DTOs;
- map artifact classification as `runtime_candidate`;
- ordinary Markdown image classification as `unclassified`;
- intended-role and runtime-compatibility independence;
- Map Plan reference propagation and Character Plan schema compatibility;
- provider exact/fallback/unavailable behavior;
- Slice preflight pinning and resume behavior;
- separate provenance and visual-output verification failures.

## Non-Goals

- Adding a duplicate `documents.design_system_id` source of truth.
- Treating the project's current GDS binding as historical provenance.
- Treating GDS preview images as production assets.
- Automatically downloading and trusting arbitrary Markdown image URLs.
- Claiming visual consistency from matching hashes alone.
- Replacing `GameArtStyleSnapshot` with another canonical style model.
- Generating collisions, navigation, TileMaps, or tilesets from a GDD map image
  without an explicit compatible derivation plan.

## Acceptance Criteria

The feature is complete when a GDD-driven Slice deterministically resolves the
exact historical GDS and Art Style that produced the GDD, presents every image
with separate intended-role and runtime-compatibility state, reuses or derives
from authoritative assets according to an auditable AssetPlan, passes references
through supported real generation interfaces, and reports provenance correctness
separately from observable visual-style conformance.
