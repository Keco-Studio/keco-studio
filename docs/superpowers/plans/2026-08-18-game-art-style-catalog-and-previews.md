# Game Art Style Catalog And Preview Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the fixed Pixel Art implementation into a five-style immutable catalog and publish approved map/character previews generated through the configured OpenAI-compatible image endpoint.

**Architecture:** Runtime uses explicit static JSON imports, a frozen compound-key registry, strict input resolution, and checked-in static assets. A separate Node authoring package probes the provider, generates bounded candidates into ignored cache, validates media, records redacted provenance, and refuses to overwrite releases. New styles enter the runtime catalog only after generation and independent visual approval.

**Tech Stack:** TypeScript 5.9, Zod 3, React 19, Next.js 16 Image, Node fetch/undici, Sharp, Jest, Playwright, CSS Modules.

## Global Constraints

- Runtime identity is the immutable compound key `<presetId>@<presetVersion>`.
- `pixel-art@1` and its public image bytes/hashes remain readable and unchanged but retire from new selection.
- New selection contains exactly `pixel-art@2`, `flat-graphic-2d@1`, `hand-painted-2d@1`, `cel-shaded-3d@1`, and `low-poly-3d@1`.
- Retain snapshot `schemaVersion: 1` and serialized `pixelTechnique`; display it as `Rendering technique`.
- Runtime never scans files and never imports/calls provider authoring code.
- Provider credentials remain only in ignored local env, never `NEXT_PUBLIC_*`, logs, manifests, snapshots, tests, or commits.
- The configured non-secret provider base URL may be a checked-in default; the API key may not.
- Published revision directories are append-only and authoring refuses overwrite.
- Official prompts contain no artist, studio, game, franchise, film, or named-character references.
- Generate images only after catalog code and authoring tests pass.
- Each style uses the same riverside-village map and adult field-cartographer comparison subject.
- Preserve unrelated `next-env.d.ts` and `.superpowers/` changes.
- This plan starts only after every Unified Game Design System Versioning task passes review and verification. Shared editor, CSS, unit-test, and E2E files are sequential ownership points and must not be implemented concurrently.
- Provider POSTs are governed by one persisted release-session ledger, including smoke tests, candidates, timeouts, and unknown outcomes. Restarting or concurrently invoking the CLI cannot reset or exceed the session ceiling.

---

### Task 1: Compound-Key Registry And Historical Pixel Migration

**Files:**
- Move: `docs/superpowers/specs/2026-08-17-pixel-art-v1-preset.json` to `docs/superpowers/specs/game-art-styles/pixel-art/v1/preset.json`
- Move: `docs/superpowers/specs/2026-08-17-pixel-art-v1-asset-manifest.json` to `docs/superpowers/specs/game-art-styles/pixel-art/v1/asset-manifest.json`
- Modify: `src/lib/game-art-style/schema.ts`
- Modify: `src/lib/game-art-style/presets.ts`
- Modify: `src/lib/game-art-style/compiler.ts`
- Modify: `src/lib/game-art-style/compiler.test.ts`
- Modify: `src/lib/services/gameDesignSystemService.ts`
- Modify: `src/lib/services/gameDesignSystemService.test.ts`
- Modify: `tests/unit/game-art-style-assets.test.ts`
- Modify: affected documentation references under `docs/superpowers/`

**Interfaces:**
- Produces: `GameArtStylePresetId`, `gameArtStyleKey(id, version)`, `GAME_ART_STYLE_PRESETS_BY_KEY`, `GAME_ART_STYLE_CATALOG`, `RETIRED_GAME_ART_STYLE_KEYS`, `DEFAULT_GAME_ART_STYLE_KEY`.
- Keeps new-selection catalog temporarily on `pixel-art@1` until Task 6 publishes assets; retained registry and offered catalog are separate.
- Produces: `parseRetainedGameArtStyleSnapshot(raw)` which accepts only snapshots whose compound key exists in the retained registry.

- [ ] **Step 1: Write failing generalized registry/compiler tests**

Assert compound-key uniqueness, strict known key resolution, retired-vs-offered separation, unknown ID/version rejection, client-owned-field rejection, and deep-freeze. Parameterize asset validation over all currently retained presets rather than importing one hard-coded fixture. At this stage service hydration covers retained Pixel v1, an unknown but structurally valid non-null compound key producing `UNSUPPORTED_SNAPSHOT`, malformed non-null JSON producing the same read error, and SQL NULL producing neither snapshot nor error. Task 6 adds the five new retained keys after their imports exist.

```ts
expect(resolveGameArtStylePreset('pixel-art', 1)).toBe(PIXEL_ART_V1_PRESET);
expect(() => compileGameArtStyle({ ...input, presetId: 'unknown' })).toThrow(/Unknown Game Art Style/);
expect(GAME_ART_STYLE_CATALOG.map((preset) => gameArtStyleKey(preset.presetId, preset.presetVersion)))
  .toEqual(['pixel-art@1']);
```

- [ ] **Step 2: Run RED**

```bash
npx jest src/lib/game-art-style/compiler.test.ts src/lib/services/gameDesignSystemService.test.ts \
  tests/unit/game-art-style-assets.test.ts --runInBand
```

- [ ] **Step 3: Generalize schemas without loosening server resolution**

Use bounded preset IDs and positive integer versions in the structural schemas; validate offered/retained compound-key membership in resolver/compiler logic. `parseRetainedGameArtStyleSnapshot` first applies the structural schema and then requires retained-registry membership. Replace service hydration's direct structural `safeParse` with this parser so unknown storage keys cannot masquerade as supported snapshots. Keep every existing specification and asset field. Input normalization remains strict and cannot contain snapshot fields.

- [ ] **Step 4: Build explicit frozen registry and migrate documentation files**

Use explicit JSON imports and map construction that throws on duplicate compound keys. Move only documentation JSON/manifest; preserve `public/game-art-styles/pixel-art/v1/*.png` byte-for-byte. Update `runtimeSource`, imports, tests, and docs references.

- [ ] **Step 5: Run GREEN, verify hashes unchanged, and commit**

```bash
npx jest src/lib/game-art-style/compiler.test.ts src/lib/services/gameDesignSystemService.test.ts \
  tests/unit/game-art-style-assets.test.ts --runInBand
sha256sum public/game-art-styles/pixel-art/v1/map.png public/game-art-styles/pixel-art/v1/character.png
git diff --check
git add docs/superpowers/specs/2026-08-17-pixel-art-v1-preset.json \
  docs/superpowers/specs/2026-08-17-pixel-art-v1-asset-manifest.json \
  docs/superpowers/specs/game-art-styles/pixel-art/v1 \
  src/lib/game-art-style src/lib/services/gameDesignSystemService.ts \
  src/lib/services/gameDesignSystemService.test.ts tests/unit/game-art-style-assets.test.ts
git commit -m "refactor: generalize game art style registry"
```

### Task 2: Dynamic Catalog Selection In Creation And Version Editing

**Files:**
- Create: `src/components/game-design-system/GameArtStyleCatalog.tsx`
- Create: `src/components/game-design-system/GameArtStyleCatalog.test.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemCreatePage.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemCreatePage.test.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemArtStyleFields.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemVersionEditor.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemVersionEditor.test.tsx`
- Modify: `src/components/game-design-system/GameArtStylePreview.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.module.css`

**Interfaces:**
- Produces shared `GameArtStyleCatalog({ catalog, selectedKey, onSelect, retiredSnapshot? })`.
- Creation uses `DEFAULT_GAME_ART_STYLE_KEY`; version editing omits Art Style input until a real change.
- UI label changes from `Pixel technique` to `Rendering technique` only.
- `GameDesignSystemArtStyleFields` is controlled by the parent with `{ originalSnapshot, artStyleReadError, value, changed, onChange }`; its draft `null` means inherit/omit, never the API's explicit-clear sentinel.

- [ ] **Step 1: Write failing shared-selection tests**

With a two-preset test catalog, assert radio/list selection, Arrow/Home/End keyboard behavior, visual preview switch, retained customization, confirmed Reset, Review identity/revision, failed-submit preservation, and retired snapshot `Preset upgrade` behavior. In the parent editor, cover preset switching, switching back to the original compound key restoring no-op, retired/unsupported snapshots remaining omitted until an explicit offered selection, and Review/request using the same compound key and customization. Assert no code reads `catalog[0]` as a product default.

- [ ] **Step 2: Run RED**

```bash
npx jest src/components/game-design-system/GameArtStyleCatalog.test.tsx \
  src/components/game-design-system/GameDesignSystemCreatePage.test.tsx \
  src/components/game-design-system/GameDesignSystemVersionEditor.test.tsx --runInBand
```

- [ ] **Step 3: Implement shared catalog and wire both flows**

Store a compound key, resolve from the frozen registry, and build client input from only ID/version/customization. The parent editor owns `VersionDraft.artStyle`, computes `changed` canonically against `originalSnapshot`, and passes the controlled contract to the field surface. Draft `null` omits Art Style and inherits the snapshot; only the route-level request type uses explicit `artStyle: null` to clear. Changing preset preserves direction, references, and avoid exactly. Reset is separate and confirmed. Historical retired or unsupported snapshots remain inherited unless the user explicitly selects an offered key.

- [ ] **Step 4: Stabilize responsive preview/catalog layout**

Use selectable rows/swatches with map thumbnails, not decorative cards. At 390px avoid horizontal overflow and preserve bounded map/character frames. `GameArtStylePreview` remains textual when images fail.

- [ ] **Step 5: Run GREEN and commit**

Run Step 2 plus focused ESLint, then:

```bash
git add src/components/game-design-system/GameArtStyleCatalog.tsx \
  src/components/game-design-system/GameArtStyleCatalog.test.tsx \
  src/components/game-design-system/GameDesignSystemCreatePage.tsx \
  src/components/game-design-system/GameDesignSystemCreatePage.test.tsx \
  src/components/game-design-system/GameDesignSystemArtStyleFields.tsx \
  src/components/game-design-system/GameDesignSystemVersionEditor.tsx \
  src/components/game-design-system/GameDesignSystemVersionEditor.test.tsx \
  src/components/game-design-system/GameArtStylePreview.tsx \
  src/components/game-design-system/GameDesignSystemsPage.module.css
git commit -m "feat: select game art style presets"
```

### Task 3: Redacted OpenAI-Compatible Image Provider Client

**Files:**
- Create: `scripts/game-art-style/providerClient.ts`
- Create: `scripts/game-art-style/providerClient.test.ts`
- Create: `scripts/game-art-style/types.ts`

**Interfaces:**
- Produces: `normalizeProviderBaseUrl`, `discoverImageModel`, `generateImage`, `downloadGeneratedImage`.
- Supports `b64_json` and allowlisted HTTPS URL output.
- Never logs or returns credentials/Authorization headers.

- [ ] **Step 1: Write fake-server/provider-client tests**

Cover base URLs with/without `/v1`, explicit model precedence, exactly one metadata-declared image model, ambiguous/empty models, 401/403/404/429/5xx, timeout, bounded base64, provider-origin URL, allowlisted CDN URL, missing allowlist, redirects, private/local IP rejection, MIME mismatch, response-size limit, and redacted thrown errors.

```ts
await expect(discoverImageModel({ explicitModel: 'gpt-image', models: ambiguous })).resolves.toBe('gpt-image');
await expect(discoverImageModel({ models: ambiguous })).rejects.toThrow(/ambiguous/i);
expect(redactedError).not.toContain(apiKey);
```

- [ ] **Step 2: Run RED**

```bash
npx jest scripts/game-art-style/providerClient.test.ts --runInBand
```

- [ ] **Step 3: Implement strict request and response handling**

Use injected `fetch` for tests. Send Authorization only to the configured provider origin. Prefer `response_format: 'b64_json'` when supported; validate response JSON structurally. URL downloads receive no Authorization and pass protocol, host allowlist, redirect, DNS/private-network, timeout, MIME, and byte checks.

- [ ] **Step 4: Centralize redaction**

Errors expose stable codes and safe status/request IDs only. Do not include response headers, bodies, signed URLs, raw provider messages, or token fragments.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx jest scripts/game-art-style/providerClient.test.ts --runInBand
git add scripts/game-art-style/providerClient.ts scripts/game-art-style/providerClient.test.ts scripts/game-art-style/types.ts
git commit -m "feat: add safe game art image provider client"
```

### Task 4: Candidate Generation, Validation, And Release Tooling

**Files:**
- Create: `scripts/game-art-style/styleBriefs.ts`
- Create: `scripts/game-art-style/styleBriefs.test.ts`
- Create: `scripts/game-art-style/mediaValidation.ts`
- Create: `scripts/game-art-style/mediaValidation.test.ts`
- Create: `scripts/game-art-style/author.ts`
- Create: `scripts/game-art-style/author.test.ts`
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Produces commands `npm run art-style:probe`, `npm run art-style:generate`, `npm run art-style:contact-sheet`, `npm run art-style:publish`.
- Defaults provider base URL to the supplied non-secret endpoint.
- Requires `--session`, `--max-generations`, and one persistent locked ledger at `.cache/game-art-styles/sessions/<session>/budget.json`; candidates live in `.cache/game-art-styles/<release-key>/`.

- [ ] **Step 1: Write failing brief and authoring tests**

Assert five release definitions, exact common subjects, shared style capsule between map/character, forbidden proper-name patterns, three default candidates per stage, mandatory session/budget, dry run, deterministic cache paths, append-only release refusal, and secret-free logs/manifests. Test that the locked ledger counts every provider POST before dispatch, including timeout/unknown outcomes; persists across phases and process restarts; serializes concurrent commands; rejects lower/different ceilings for an existing session; and refuses the next request once the cumulative ceiling is reached.

- [ ] **Step 2: Write failing media tests**

Using generated fixtures, cover decoding, PNG conversion, dimensions, visible pixels, alpha truthfulness, byte cap, SHA-256, duplicate detection, and labeled contact-sheet creation.

- [ ] **Step 3: Run RED**

```bash
npx jest scripts/game-art-style/styleBriefs.test.ts \
  scripts/game-art-style/mediaValidation.test.ts \
  scripts/game-art-style/author.test.ts --runInBand
```

- [ ] **Step 4: Implement the CLI phases**

`probe` lists only safe model capability facts. `generate` reserves one ledger unit atomically before every provider POST and never refunds it; smoke/candidate/regeneration phases share the same ceiling. `contact-sheet` produces map/character comparison PNGs. `publish` requires a review JSON in which every rubric is `pass`, verifies selected candidate hashes, and uses the recoverable two-tree protocol below.

Publishing stages a complete mirrored release under one transaction directory, including preset, manifest, final map/character images, and all three review sheets. It preflights that every exact target is absent, then writes a durable transaction marker listing created paths. Exact targets are `docs/superpowers/specs/game-art-styles/<preset-id>/vN/...` and `public/game-art-styles/<preset-id>/vN/{map.png,character.png}`. It promotes files one by one with exclusive creation, verifies the whole final set and hashes, and only then marks committed. On an injected failure it removes only paths recorded as newly created by that transaction; on startup it detects incomplete markers and performs the same ownership-checked rollback before retry. Tests inject failure after each promotion boundary and prove no half-release remains and unrelated/pre-existing paths are never removed.

Review JSON shape includes reviewer, selected IDs, every candidate ID/hash, rubric results, rejection reasons, and contact-sheet hashes. Provider base URL is stored only as SHA-256 plus endpoint path.

- [ ] **Step 5: Add scripts and documented env names**

`.env.example` contains empty non-secret names only. The actual key goes in ignored `.env.game-art-style.local`, not `.env.example`.

- [ ] **Step 6: Run GREEN and commit**

Run Step 3, `npm run art-style:generate -- --dry-run --session dry-run --max-generations 1`, `git diff --check`, then:

```bash
git add scripts/game-art-style package.json .env.example
git commit -m "feat: add game art preview authoring workflow"
```

### Task 5: Generate And Cross-Review Preview Candidates

**Files:**
- Create locally ignored: `.env.game-art-style.local`
- Create locally ignored: `.cache/game-art-styles/**`
- No committed files until Task 6.

**Interfaces:**
- Consumes the user-provided base URL/API key without echoing either secret value.
- Produces 3 map and 3 character candidates per new release within an explicit 51-request release-session ceiling (`1 smoke + 30 initial candidates + at most 20 rejected-candidate regenerations`), plus contact sheets and machine validation reports.

- [ ] **Step 1: Configure ignored local credentials without shell-history exposure**

Verify `.env.game-art-style.local` is ignored with `git check-ignore`. Store the base URL, API key, discovered/explicit model, and optional download host allowlist. Never print the file.

- [ ] **Step 2: Probe and smoke-test the provider**

```bash
npm run art-style:probe -- --env-file .env.game-art-style.local
npm run art-style:generate -- --env-file .env.game-art-style.local --session 2026-08-18-five-style-v1 --smoke --max-generations 51
```

Stop on ambiguous model or unsupported image response; fix the authoring adapter through its tests rather than bypassing validation.

- [ ] **Step 3: Generate map candidates, review, then character candidates**

Generate all five map sets within 15 requests using the same release-session ledger. Create a contact sheet and dispatch at least two independent visual reviewers. Record all rubric decisions. Generate character sets only after one map per style passes, using the selected map as reference when the declared API supports it. The 15 character requests bring initial candidate usage to 31 including smoke.

- [ ] **Step 4: Cross-review final pairs**

Create final pair sheets and dispatch independent reviewers for anatomy, route readability, style boundary, pair consistency, text/watermark absence, IP imitation, and low-poly/cel mutual exclusion. Resolve rejections within the explicitly reserved 20-request regeneration allowance and update review evidence after each request. The persistent ledger is the authority across map, character, smoke, restart, and concurrent invocations; reaching 51 stops further provider calls and blocks publication of an unapproved pair.

- [ ] **Step 5: Confirm cache remains ignored**

```bash
git status --short
git check-ignore .env.game-art-style.local .cache/game-art-styles/*
```

Expected: no credential or candidate file appears as a committable change.

### Task 6: Publish Five Immutable Presets

**Files:**
- Create: `docs/superpowers/specs/game-art-styles/pixel-art/v2/{preset.json,asset-manifest.json,review-map.png,review-character.png,review-pair.png}`
- Create analogous v1 directories for `flat-graphic-2d`, `hand-painted-2d`, `cel-shaded-3d`, and `low-poly-3d`
- Create: `public/game-art-styles/<preset-id>/vN/map.png`
- Create: `public/game-art-styles/<preset-id>/vN/character.png`
- Modify: `src/lib/game-art-style/presets.ts`
- Modify: `src/lib/game-art-style/compiler.test.ts`
- Modify: `src/lib/services/gameDesignSystemService.test.ts`
- Modify: `tests/unit/game-art-style-assets.test.ts`

**Interfaces:**
- Changes offered catalog to the exact five new-selection keys and sets `DEFAULT_GAME_ART_STYLE_KEY = 'pixel-art@2'`.
- Retains `pixel-art@1` in the read registry only.

- [ ] **Step 1: Publish from approved review records**

Run one batch `art-style:publish` transaction for the five approved release keys. It must fail before promotion if any target exists or any rubric/hash is missing, and recover cleanly from an interrupted prior attempt using its durable marker.

- [ ] **Step 2: Add explicit imports and offered ordering**

The registry statically imports all six retained presets. Offered catalog order is Pixel Art, Flat Graphic 2D, Hand-Painted 2D, Cel-Shaded 3D, Low-Poly 3D. Order is presentation only; default remains the named constant.

- [ ] **Step 3: Expand compiler and asset tests**

Assert every offered key compiles, unknown/retired input behavior is intentional, different keys yield distinct snapshots, manifests reference their preset, prompt hashes match, all visual rubrics pass, public bytes match dimensions/alpha/hash, and no two final images share a hash. Parameterize service hydration over all six retained compound keys (`pixel-art@1` plus the five new presets) and prove each hydrates without a read error.

- [ ] **Step 4: Run release verification and commit**

```bash
npx jest src/lib/game-art-style/compiler.test.ts src/lib/services/gameDesignSystemService.test.ts \
  tests/unit/game-art-style-assets.test.ts \
  scripts/game-art-style --runInBand
npm run typecheck
git diff --check
git add docs/superpowers/specs/game-art-styles public/game-art-styles \
  src/lib/game-art-style/presets.ts src/lib/game-art-style/compiler.test.ts \
  src/lib/services/gameDesignSystemService.test.ts \
  tests/unit/game-art-style-assets.test.ts
git commit -m "feat: publish five game art style presets"
```

### Task 7: Catalog Integration And Runtime Isolation Acceptance

**Files:**
- Modify: `tests/e2e/specs/game-design-system.spec.ts`
- Modify: `tests/unit/game-design-system-route-test-boundaries.test.ts`
- Modify: `tests/unit/game-design-system-routes.test.ts`
- Create: `tests/unit/game-art-style-runtime-isolation.test.ts`
- Modify: CSS/component files only for defects found by visual evidence.

**Interfaces:**
- Verifies creation, version editing, retry, historical rendering, and zero provider runtime calls.

- [ ] **Step 1: Add route and runtime-isolation tests**

Cover all five accepted keys, unknown/retired new input, forged canonical fields, stored Pixel v1 hydration, and static import scan proving no `src/` file imports `scripts/game-art-style` or references the provider base domain.

- [ ] **Step 2: Extend Playwright catalog flow**

At desktop and mobile, select each style and assert title/preview/Visual DNA update. Submit one new system and one new version with a non-default style, retry a failed job without losing the selection, and render historical Pixel v1. Record requests and assert none target the provider domain.

- [ ] **Step 3: Run full focused verification**

```bash
npx jest src/lib/game-art-style scripts/game-art-style \
  src/lib/services/gameDesignSystemService.test.ts \
  src/components/game-design-system/GameArtStyleCatalog.test.tsx \
  src/components/game-design-system/GameDesignSystemCreatePage.test.tsx \
  src/components/game-design-system/GameDesignSystemVersionEditor.test.tsx \
  tests/unit/game-art-style-assets.test.ts \
  tests/unit/game-art-style-runtime-isolation.test.ts \
  tests/unit/game-design-system-route-test-boundaries.test.ts \
  tests/unit/game-design-system-routes.test.ts --runInBand
npm run typecheck
npx playwright test tests/e2e/specs/game-design-system.spec.ts --workers=1
git diff --check
```

- [ ] **Step 4: Commit acceptance coverage**

```bash
git add tests/e2e/specs/game-design-system.spec.ts \
  tests/unit/game-design-system-route-test-boundaries.test.ts \
  tests/unit/game-design-system-routes.test.ts \
  tests/unit/game-art-style-runtime-isolation.test.ts
git commit -m "test: verify game art style catalog release"
```
