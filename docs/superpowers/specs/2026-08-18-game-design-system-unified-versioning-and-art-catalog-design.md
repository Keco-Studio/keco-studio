# Game Design System Unified Versioning And Art Catalog

**Date:** 2026-08-18
**Status:** Proposed for delegated multi-agent approval
**Source:** Jira KECO-1034

## Product Goal

Make version iteration understandable and complete. A user should start one version draft from any readable version, edit the game design document, game background, rules, and art style in one workspace, review the combined changes, and create one immutable version.

Expand the built-in art catalog from one locked Pixel Art choice to five distinct production styles with versioned, checked-in map and character studies. Preview generation remains an offline authoring workflow and never becomes a product runtime dependency.

## Decision And Alternatives

The selected approach is a **single version draft session**.

1. **Single version draft session (selected):** one entry point, one draft spanning Document, Rules, and Art Style, one review, and one atomic version write. This matches the existing complete version snapshot.
2. **Per-view editors with clearer buttons:** smaller implementation, but retains fragmented versions and cannot atomically change background, rules, and art direction.
3. **Per-view editors with a shared draft cart:** supports atomic writes but makes draft ownership, navigation, and failure recovery more complex than a dedicated editor.

The system metadata editor remains separate because name, summary, and publication status belong to the mutable system record rather than an immutable version.

## Unified Version Workflow

Personal systems expose one primary header action: `Create new version`. `Edit details` becomes `Edit system info` so its non-versioned behavior is explicit. Official systems remain read-only.

The version editor starts from the version currently selected in the workspace and owns a single in-memory `VersionDraft`:

```ts
type VersionDraft = {
  parentVersionId: string;
  expectedCurrentVersionId: string;
  document: GameDesignDocument;
  rules: GameDesignRuleSet;
  artStyle: {
    original: GameArtStyleSnapshot | null;
    input: NormalizedGameArtStyleInput | null;
    changed: boolean;
  };
};
```

The editor has four sections:

1. `Game Design`
2. `Rules & Guidance`
3. `Art Style`
4. `Review changes`

Changing sections never discards state. Leaving the editor, selecting another system, or selecting another base version prompts only when the unified draft is dirty. Saving failure retains every field and the current editor section.

The header always identifies the base, for example `New version based on v3`. A historical base is allowed. Review warns when the base is not the current version and explains that the new version will branch from that base. The atomic current-version comparison prevents a version from being created if another write changed the current version after the draft opened.

After success, the workspace selects the new version and returns to Overview. Existing projects remain pinned to their previously selected version; they never auto-upgrade.

## Game Design And Background

The compatibility read/storage `GameDesignDocument` schema gains an optional `gameBackground` field with the same 4,000-character bound as other document sections. Optionality preserves strict parsing of historical snapshots that predate the field. A separate generated-output schema extends the compatibility schema and requires non-empty `gameBackground`, so new model generation cannot silently omit it.

- New generation output parses through the required generated-output schema and persists `gameBackground`.
- Compatibility and historical documents may omit it.
- The read view shows `Not specified` for an absent historical value instead of inventing content.
- The version editor always shows `Game background & setting` as an editable field.
- A user may still create an unrelated edit from a historical version without filling the absent field; the compatibility version-write schema does not retroactively block that work.
- Rendered Markdown includes the section only when a value exists, preserving historical output behavior.

The other document fields retain their names and limits.

## Rules And Guidance

The rule contract remains unchanged: five rule kinds, three severities, rule statement, application condition, optional rationale/evidence, rule-set genres/philosophies/suitability, and table guidance.

The editor exposes all of those fields in the unified draft. The read-only Rules view also shows rule-set settings and table guidance so users can understand the complete rule system before deciding what to edit. Search and kind/severity filters improve navigation but do not change the stored schema.

No new rule kinds, Agent policy behavior, or source mutation are part of this work.

## Atomic Version API

The public version creation request is a strict object:

```ts
type CreateVersionRequest = {
  parentVersionId: string;
  expectedCurrentVersionId: string;
  document?: GameDesignDocument;
  rules?: GameDesignRuleSet;
  artStyle?: GameArtStyleInput | null;
};
```

The public route also requires a UUID `Idempotency-Key` header. New public versions persist that key under a unique `(system_id, idempotency_key)` constraint. A repeated request with the same owner, parent, and compiled complete content returns the original version; reuse with different content returns `409 IDEMPOTENCY_CONFLICT`. Trusted internal first-version, copy, and generation paths may omit the key.

Semantics:

- omitted content field: inherit the exact parent component;
- supplied Document or Rules: validate and replace that component;
- supplied Art Style input: compile a trusted snapshot on the server and replace it;
- `artStyle: null`: explicitly clear the component at the API layer, although the first UI does not expose a destructive clear action;
- unknown keys, compiled Art Style fields, preview paths, canonical specification, and hashes are rejected;
- at least one component must be supplied and the normalized result must differ from the parent;
- parent versions must belong to the same system;
- deleted rule IDs cannot be reintroduced through a historical branch.

The database RPC receives nullable `p_expected_current_version_id` and compares it to the locked system row with `IS NOT DISTINCT FROM`. Public version editing always supplies the non-null current version. Trusted internal creation supplies `NULL` only when creating the first version of a new system. The public route enforces that its parent belongs to the edited system; existing copy and generation services may continue to use a cross-system parent through trusted server-only calls. No client-controlled flag can select the trusted mode.

A mismatch returns `409 VERSION_STALE` without inserting a version. An idempotency lookup happens before reporting stale state, so a retry after a lost success response returns the already-created version. A true stale write keeps the draft and reloads the latest version, but does not automatically merge or reapply the complete local snapshot. The UI compares each changed domain and asks the user which local changes to reapply before opening a new draft on current.

The migration drops the exact prior RPC signature before creating the CAS/idempotency signature, revokes all public and authenticated execution on every obsolete overload, grants only the intended service role, and triggers the repository's normal PostgREST schema refresh. Tests prove the old no-CAS signature cannot be resolved.

The service continues to persist one complete `document + rules + artStyle` snapshot and hashes that complete result. No-op detection compares the server-parsed, inherited, and compiled complete components using canonical structural JSON with recursively sorted object keys; it does not compare request text or trust an old content hash. Sources are inherited from the parent and remain immutable.

## Cross-Domain Diff

Rule conflict detection keeps the existing `added`, `removed`, `changed`, and `conflicts` fields. New versions additionally persist a compatible summary:

```ts
type GameDesignSystemVersionDiff = GameDesignRuleDiff & {
  schemaVersion: 2;
  document: { changedSections: Array<keyof GameDesignDocument> };
  artStyle: {
    change: 'unchanged' | 'added' | 'removed' | 'preset_changed' | 'preset_version_changed' | 'customization_changed';
  };
  ruleSetSettingsChanged: boolean;
  tableGuidanceChanged: boolean;
};
```

Every new version persists the complete v2 shape. Art Style classification uses this priority when several properties differ: `preset_changed`, then `preset_version_changed`, then `customization_changed`. Historical diff objects are not interpreted as cross-domain unchanged: when the parent is readable, the read model derives Document and Art Style changes on demand; otherwise it reports `not_recorded`. No historical rows are rewritten. Review and Versions show text labels for changed domains and do not use Rule-only counts as the whole-version summary.

The final Review page is more detailed than the persisted summary. It renders Document and background before/after values, rule-set settings and Table Guidance before/after, per-rule changes, and Art Style preset/revision/customization before/after.

## Art Style Registry

The current snapshot shape is retained for compatibility. Its legacy serialized key `pixelTechnique` remains, while the UI labels it `Rendering technique` for every style. A new snapshot schema version is unnecessary because map and character studies plus the existing specification fields remain useful across the selected styles.

Preset identity is the immutable compound key `<presetId>@<presetVersion>`. The registry uses explicit static imports and validates each preset before building a deeply frozen catalog and lookup map. Runtime code never scans the file system.

The catalog published for new selection contains five styles:

| Key | Title | Boundary |
| --- | --- | --- |
| `pixel-art@2` | Pixel Art | Native pixel grid, crisp clusters, no antialiasing or smooth 3D surfaces |
| `flat-graphic-2d@1` | Flat Graphic 2D | Clean curves, flat color shapes, restrained shading, no brush texture or 3D volume |
| `hand-painted-2d@1` | Hand-Painted 2D | Visible brushwork, layered color, organic edges, no vector-clean or PBR finish |
| `cel-shaded-3d@1` | Cel-Shaded 3D | Smooth modeled volume with stepped lighting and controlled outlines, not exposed low-poly facets |
| `low-poly-3d@1` | Low-Poly 3D | Simplified geometry, readable facets, flat/matte materials, no smooth high-detail surfaces, cel-shading bands, or outline treatment |

`pixel-art@1` remains readable for historical snapshots but is retired from new selection. Its preset and manifest move into the mirrored documentation directory while the existing public images and their hashes stay byte-identical. Static imports, manifest `runtimeSource`, tests, and internal documentation references are updated to the canonical location. Files for any published revision are never overwritten.

Canonical files use mirrored versioned directories:

```text
docs/superpowers/specs/game-art-styles/<preset-id>/vN/preset.json
docs/superpowers/specs/game-art-styles/<preset-id>/vN/asset-manifest.json
public/game-art-styles/<preset-id>/vN/map.png
public/game-art-styles/<preset-id>/vN/character.png
```

The input schema accepts only catalog-offered compound keys and text customization. The snapshot schema accepts every retained historical compound key. The compiler resolves the selected key, clones canonical data, merges normalized customization, validates PostgreSQL JSONB compatibility, and enforces the existing 32 KiB limit.

## Art Style Selection

Creation and version editing render the catalog as a real single-selection control. New creation uses an explicit `DEFAULT_GAME_ART_STYLE_KEY = 'pixel-art@2'`; it never relies on array order. Selection changes the visual board immediately and always preserves direction, visual references, and avoid guidance. A separate Reset action clears those customization fields after confirmation. Review shows the exact style title, revision, direction, visual references, and avoid guidance.

When editing a supported stored snapshot, the selector starts on its compound key and copies only its customization into client-editable input. If the snapshot is historical or retired, it remains inherited exactly until the user chooses a new catalog style. Switching from a retired revision is labeled `Preset upgrade`; Review explicitly states that canonical specification and preview assets will change. The client never reconstructs or submits canonical snapshot fields.

Version reads distinguish database `NULL` from an invalid or unsupported non-null snapshot. The read model adds `artStyleReadError: { code: 'UNSUPPORTED_SNAPSHOT' } | null`; only a database `NULL` produces `artStyle: null` with no error. Unknown non-null data produces a visible unsupported state and never masquerades as legacy absence.

Preview failures stay local to an image. All textual specification remains available.

## Offline Image Authoring

Product runtime, browser code, API routes, and durable workers never call the image provider. A repository authoring command generates candidates only when explicitly invoked.

The non-secret provider base URL defaults to the user-supplied endpoint. Credentials exist only in ignored local environment configuration:

```text
GAME_ART_IMAGE_BASE_URL=<configured non-secret base URL>
GAME_ART_IMAGE_API_KEY=<local secret>
GAME_ART_IMAGE_MODEL=<discovered or explicit image model>
GAME_ART_IMAGE_DOWNLOAD_HOSTS=<optional comma-separated CDN allowlist>
```

The key is never committed, included in `NEXT_PUBLIC_*`, printed, added to manifests, or stored in signed URLs. Candidate output lives under ignored `.cache/game-art-styles/`.

The authoring client:

1. normalizes base URLs with or without `/v1`;
2. requires HTTPS except localhost;
3. probes `GET /models` without treating enumeration as proof of image capability;
4. selects an explicit `GAME_ART_IMAGE_MODEL` first; otherwise accepts only the single model whose service metadata explicitly declares image output, and fails closed if selection is ambiguous;
5. performs an explicitly budgeted `/images/generations` smoke request without trying multiple paid models speculatively;
6. prefers bounded `b64_json`; URL results may use the provider origin or an explicit download-host allowlist, never receive Authorization, and are rejected for non-HTTPS, private-network resolution, unsafe redirects, excess size, or timeout;
7. limits time, redirects, response bytes, image dimensions, and generation count;
8. redacts credentials and upstream response headers from every error;
9. refuses to overwrite a published revision.

The five styles use the same comparison subjects. Each map depicts a bright riverside village with primary and secondary routes, a bridge, gardens, and a workshop in a three-quarter top-down view. Each character depicts the same clearly adult field cartographer, full body, neutral pose, practical satchel and exploration equipment, and no weapon. Prompts contain no artist, studio, franchise, game, film, or named-character references.

Each style generates three map candidates and, after selection, three character candidates by default. `--max-generations` is mandatory and provides a hard paid-request ceiling. Character candidates reuse the exact style capsule and, when supported, the approved map as a reference. Automated validation covers decode, PNG conversion provenance, dimensions, byte limit, visible pixels, alpha truthfulness, duplicate detection, and SHA-256. Independent agents review route readability, anatomy, style boundary, pair consistency, generated text/watermarks, and IP imitation. Every rubric item must explicitly pass. The release evidence retains labeled map and character contact sheets, final pair comparison, reviewer identity, and rejection reasons. Only an approved pair is published.

The asset manifest records the non-sensitive protocol, endpoint-path and base-URL hash, model ID, request fields, prompt and prompt hash, provider request/result IDs, timestamps, original/final hashes, deterministic conversions, candidate identity, and review decisions. It never records credentials, Authorization, signed URLs, or raw response headers.

## Error Handling

- Validation errors identify the editor section and field and focus the first invalid control.
- `VERSION_STALE` keeps the draft and offers a domain-by-domain restart on the latest version; it never automatically merges or overwrites current state.
- Permission loss returns 403 and preserves locally copyable content.
- Submission freezes the base version and duplicate submit action while leaving Review readable.
- A missing or unknown stored Art Style is reported as an unsupported snapshot, not silently converted to legacy `null`.
- Image authoring fails closed on ambiguous models, unsupported response shapes, unsafe redirects, invalid media, or unknown paid submission outcome.

## Accessibility And Responsive Behavior

- Workspace and editor tabs use stable IDs, `aria-controls`, `aria-labelledby`, roving tab index, and Arrow/Home/End keyboard behavior.
- Change summaries use words in addition to color and symbols.
- All icon-only controls have tooltips and accessible names.
- At narrow widths the editor becomes a single column, section navigation becomes a compact menu/select, and the primary Review action stays reachable without overlapping fields.
- On narrow widths Rules use a searchable native-selector pattern that exposes the current rule, validation errors, and unsaved-change markers instead of the existing horizontal outline.
- Touch targets are at least 44 by 44 CSS pixels on touch layouts.
- Preview frames have stable aspect ratios and bounded character height.
- Errors use `role="alert"`; saved/created feedback uses `role="status"`.
- Opening the editor focuses its title, section changes focus the section heading, validation focuses the first invalid control, cancel restores focus to `Create new version`, and successful creation focuses the new Overview heading.

## Testing

Focused tests cover:

- optional historical and required generated `gameBackground` behavior;
- one unified draft preserving cross-section edits and issuing one request;
- exact inherit/replace/null semantics and rejection of no-op or forged input;
- stale-current concurrency where only one writer succeeds;
- cross-domain diff hydration and display;
- complete Rules settings and table-guidance visibility;
- every catalog key, unknown/retired selection, compiler determinism, and 32 KiB enforcement;
- exact preview path, dimensions, alpha, visible pixels, bytes, and hashes for every published preset;
- catalog keyboard selection, preview updates, Review payload, retry preservation, and mobile overflow;
- authoring-client URL normalization, model ambiguity, status/timeout/redirect handling, `b64_json` and URL results, MIME/size rejection, overwrite refusal, and log redaction;
- static runtime-isolation checks and Playwright assertions that product flows never request the provider domain.

Provider generation is opt-in and excluded from CI. Normal CI uses deterministic fixtures or a local fake provider.

## Non-Goals

- Editing or overwriting an existing immutable version.
- Automatically updating project bindings.
- Versioning system name, summary, or publication status.
- Editing source snapshots.
- Real-time collaborative or durable server-side draft editing.
- Complex merge conflict resolution.
- New rule kinds, severities, or Agent policy behavior.
- Runtime generation of game assets or previews.
- User-authored public presets in this release.

## Acceptance Criteria

The work is complete when a personal-system owner can create one version from the selected base after changing any combination of game background, document, Rules, and Art Style; review shows every changed domain; stale concurrent writes cannot silently win; historical versions and Pixel Art v1 remain readable; new creation offers five real style choices; each selectable style has an approved, versioned map/character pair generated through the configured provider; credentials never enter committed or runtime artifacts; official systems remain read-only; project bindings remain pinned; and focused unit, route, database, component, end-to-end, asset, and authoring-client tests pass.
