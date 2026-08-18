# Game Art Style v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed Pixel Art preset to Game Design System creation and immutable version viewing, with text customization and newly generated PixelLab Pro previews.

**Architecture:** A strict Art Style input schema normalizes the browser payload and a deterministic server compiler combines it with one canonical checked-in preset. The resulting snapshot is stored beside `document` and `rules` on each immutable version, while generation messages, Agent rules, Markdown, and project bindings remain unchanged. The create flow and read-only workspace view consume the same canonical registry projection and tolerate legacy `null` snapshots.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Zod 3, Supabase/PostgreSQL, Jest/Testing Library, Playwright, CSS Modules.

## Global Constraints

- V1 offers exactly `presetId: "pixel-art"` and `presetVersion: 1`.
- Creating or retrying a product job never calls PixelLab; preview generation is an offline authoring step.
- The model root contract remains exactly `document + rules`, and Art Style is never included in model messages.
- Art Style is stored only as `GameArtStyleSnapshot | null` on immutable Game Design System versions.
- New durable generation requires explicit Pixel Art input; legacy and direct structured creation remain compatible with `null`.
- Child versions inherit the exact parent snapshot; copy uses the current source version; a base system never overrides the current explicit Art Style selection.
- Existing Agent policy and rendered Markdown behavior must remain byte-for-byte driven by rules/document only.
- Runtime registry values come only from `docs/superpowers/specs/2026-08-17-pixel-art-v1-preset.json`; the asset manifest is provenance/CI evidence only.
- Preserve the unrelated user change in `next-env.d.ts` and do not commit `.superpowers/` authoring candidates.

---

### Task 1: Canonical Art Style Contract And Compiler

**Files:**
- Create: `src/lib/game-art-style/schema.ts`
- Create: `src/lib/game-art-style/presets.ts`
- Create: `src/lib/game-art-style/compiler.ts`
- Create: `src/lib/game-art-style/compiler.test.ts`
- Create: `tests/unit/game-art-style-assets.test.ts`
- Read fixture: `docs/superpowers/specs/2026-08-17-pixel-art-v1-preset.json`

**Interfaces:**
- Produces: `gameArtStyleInputSchema`, `gameArtStyleSnapshotSchema`, `GameArtStyleInput`, `GameArtStyleSnapshot`.
- Produces: `PIXEL_ART_V1_PRESET`, `GAME_ART_STYLE_CATALOG`, `compileGameArtStyle(input)`.
- Consumes: the canonical preset JSON without a second hand-written registry copy.

- [ ] **Step 1: Write failing schema and compiler tests**

```ts
expect(() => gameArtStyleInputSchema.parse({
  presetId: 'pixel-art', presetVersion: 1,
  customization: { direction: '  bright\r\nworld  ', referenceGames: [], avoid: '' },
  specification: {},
})).toThrow();

expect(compileGameArtStyle(validInput)).toEqual(compileGameArtStyle(validInput));
expect(compileGameArtStyle(inputWithDuplicateReferences).customization.referenceGames)
  .toEqual([{ name: 'Hyper Light Drifter', borrow: 'Readable silhouettes' }]);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm run test:unit -- --runInBand src/lib/game-art-style/compiler.test.ts tests/unit/game-art-style-assets.test.ts`

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Implement strict schemas and deterministic compilation**

```ts
export const gameArtStyleInputSchema = z.object({
  presetId: z.literal('pixel-art'),
  presetVersion: z.literal(1),
  customization: z.object({
    direction: multiline(2_000).optional(),
    referenceGames: z.array(z.object({
      name: z.string().max(120),
      borrow: z.string().max(500),
    }).strict()).max(8),
    avoid: multiline(1_000).optional(),
  }).strict(),
}).strict();

export function compileGameArtStyle(value: unknown): GameArtStyleSnapshot {
  const input = normalizeGameArtStyleInput(gameArtStyleInputSchema.parse(value));
  return gameArtStyleSnapshotSchema.parse({ ...PIXEL_ART_V1_PRESET, customization: input.customization });
}
```

The compiler removes fully empty reference rows, rejects half-filled rows, deduplicates normalized names case-insensitively in first-occurrence order, normalizes CRLF/trailing spaces, and enforces the 32 KiB compiled size.

- [ ] **Step 4: Validate canonical image metadata from disk**

The asset test decodes each PNG with `sharp`, checks dimensions/bytes/alpha mode, and hashes the file against the canonical fixture. It also asserts `publicPath` begins with `/game-art-styles/` and `sourcePath` begins with `public/game-art-styles/`.

- [ ] **Step 5: Run GREEN and commit**

Run: `npm run test:unit -- --runInBand src/lib/game-art-style/compiler.test.ts tests/unit/game-art-style-assets.test.ts`

Expected: 2 suites pass.

Commit: `git add src/lib/game-art-style docs/superpowers/specs/2026-08-17-pixel-art-v1-preset.json tests/unit/game-art-style-assets.test.ts public/game-art-styles && git commit -m "feat: add pixel art style registry"`

### Task 2: Immutable Version Persistence

**Files:**
- Create: `supabase/migrations/20260817140000_game_design_system_art_style.sql`
- Modify: `src/lib/services/gameDesignSystemService.ts`
- Modify: `src/lib/services/gameDesignSystemService.test.ts`
- Modify: `tests/unit/database/game-design-rule-system-migration.test.ts`

**Interfaces:**
- `GameDesignSystemVersion.artStyle: GameArtStyleSnapshot | null` maps to SQL `art_style`.
- `createGameDesignSystemVersion(..., artStyle?: GameArtStyleSnapshot | null)` inherits from `parentVersion.artStyle` when omitted.
- RPC gains `p_art_style jsonb` and hashes `{ document, rules, artStyle }` in TypeScript.

- [ ] **Step 1: Write failing service and migration tests**

```ts
expect(version.artStyle).toBeNull();
expect(rpcArgs.p_art_style).toEqual(parent.artStyle);
expect(rpcArgs.p_content_hash).toBe(hashJson({ document, rules, artStyle: parent.artStyle }));
expect(artStyleSql).toMatch(/add column art_style jsonb/i);
expect(artStyleSql).toMatch(/octet_length\(art_style::text\) <= 32768/i);
```

Cover initial explicit persistence, ordinary child inheritance, copy preservation, direct legacy `null`, hydration of absent fields as `null`, source snapshot visibility, and authenticated column grants.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm run test:unit -- --runInBand src/lib/services/gameDesignSystemService.test.ts tests/unit/database/game-design-rule-system-migration.test.ts`

Expected: FAIL on missing `artStyle` and migration.

- [ ] **Step 3: Add the nullable immutable column and replace the current RPC**

```sql
alter table public.game_design_system_versions
  add column art_style jsonb,
  add constraint game_design_system_versions_art_style_object
    check (art_style is null or jsonb_typeof(art_style) = 'object'),
  add constraint game_design_system_versions_art_style_size
    check (art_style is null or pg_catalog.octet_length(art_style::text) <= 32768);
```

Recreate the current `create_game_design_system_version` signature with `p_art_style jsonb`, preserve atomic version numbering/rendering/job deduplication, revoke the old overload, keep execute restricted, and expose `art_style` through the same safe version read grant while continuing to hide `source_snapshots`.

- [ ] **Step 4: Update service hydration, creation, copy, and hashes**

`VERSION_COLUMNS` and `VERSION_READ_COLUMNS` include `art_style`; `hydrateVersion` parses a present snapshot and maps missing/null to `null`. `createGameDesignSystem`, deduplicated job repair, and `copyGameDesignSystem` forward the chosen snapshot. No document/rules editor request may accept an Art Style replacement.

- [ ] **Step 5: Run GREEN and commit**

Run: `npm run test:unit -- --runInBand src/lib/services/gameDesignSystemService.test.ts tests/unit/database/game-design-rule-system-migration.test.ts`

Expected: both suites pass.

Commit: `git add supabase/migrations/20260817140000_game_design_system_art_style.sql src/lib/services/gameDesignSystemService.ts src/lib/services/gameDesignSystemService.test.ts tests/unit/database/game-design-rule-system-migration.test.ts && git commit -m "feat: persist immutable game art style"`

### Task 3: Durable Generation Input And Route Boundary

**Files:**
- Modify: `src/lib/gameDesignSystemGeneration.ts`
- Modify: `src/lib/gameDesignSystemGeneration.test.ts`
- Modify: `src/lib/game-design-system/worker.ts`
- Modify: `src/lib/game-design-system/worker.test.ts`
- Modify: `src/app/api/game-design-systems/generation-jobs/route.ts`
- Modify: `src/lib/services/gameDesignSystemClient.ts`
- Modify: `tests/unit/game-design-system-route-test-boundaries.test.ts`
- Modify: `tests/unit/game-design-system-routes.test.ts`

**Interfaces:**
- `ResolvedGameDesignGenerationInput.artStyle: GameArtStyleSnapshot` is persisted in the job.
- Browser `GameDesignGenerationRequest.artStyle: GameArtStyleInput` remains selector/customization only.
- Route compiles once before job creation; retry reuses `job.input.artStyle` exactly.

- [ ] **Step 1: Write failing route, hash, message, and worker tests**

```ts
expect(hashResolvedGenerationInput({ ...base, artStyle: snapshot }))
  .not.toBe(hashResolvedGenerationInput({ ...base, artStyle: otherSnapshot }));
expect(JSON.stringify(buildStructuredGenerationMessages(resolved))).not.toContain('previewAssetSet');
expect(createSystem).toHaveBeenCalledWith(expect.anything(), expect.anything(),
  expect.objectContaining({ artStyle: resolved.artStyle }));
```

Route tests submit unknown keys, forged `specification`, unknown preset/version, over-limit text, duplicate visual references, and a valid explicit Pixel Art request. Assert field-addressable 400s happen before job insertion.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm run test:unit -- --runInBand src/lib/gameDesignSystemGeneration.test.ts src/lib/game-design-system/worker.test.ts tests/unit/game-design-system-route-test-boundaries.test.ts`

Expected: FAIL because generation input has no Art Style.

- [ ] **Step 3: Compile at the route and persist only the snapshot**

```ts
const artStyle = compileGameArtStyle(body.artStyle);
const input: ResolvedGameDesignGenerationInput = {
  ...existingResolvedFields,
  artStyle,
};
```

Keep `buildStructuredGenerationMessages` context unchanged by destructuring only the existing fields. The worker passes `generationInput.artStyle` to persistence but never to `generate()` messages. Base system Art Style is intentionally ignored because route input is required.

- [ ] **Step 4: Update browser types and exact request payload**

`GameDesignGenerationRequest` requires `artStyle: GameArtStyleInput`. No compiled keys are present in the client type or request.

- [ ] **Step 5: Run GREEN, regression tests, and commit**

Run: `npm run test:unit -- --runInBand src/lib/gameDesignSystemGeneration.test.ts src/lib/game-design-system/worker.test.ts tests/unit/game-design-system-route-test-boundaries.test.ts`

Run: `npm run test:unit -- --runInBand src/lib/game-design-system/agentPolicy.test.ts src/lib/game-design-system/ruleSchema.test.ts`

Expected: all suites pass and generation system prompts still require exactly `document` and `rules`.

Commit: `git add src/lib/gameDesignSystemGeneration.ts src/lib/gameDesignSystemGeneration.test.ts src/lib/game-design-system/worker.ts src/lib/game-design-system/worker.test.ts src/app/api/game-design-systems/generation-jobs/route.ts src/lib/services/gameDesignSystemClient.ts tests/unit/game-design-system-route-test-boundaries.test.ts tests/unit/game-design-system-routes.test.ts && git commit -m "feat: carry art style through generation jobs"`

### Task 4: Four-Stage Creation Experience

**Files:**
- Create: `src/components/game-design-system/GameArtStylePreview.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemCreatePage.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemCreatePage.test.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.module.css`

**Interfaces:**
- Create stages become `foundation | art-style | sources | review`.
- `GameArtStylePreview` receives canonical catalog data plus optional compact mode and image-failure state.
- Submit payload contains `artStyle: { presetId, presetVersion, customization }` only.

- [ ] **Step 1: Write failing component tests**

Use Testing Library to assert four numbered tabs, one selected disabled-choice Pixel Art radio/list option, both preview images, canonical copy, direction/avoid limits, dynamic visual-reference rows with `name + borrow`, Review summary, values retained after a failed request, and exact submitted payload without `specification` or asset fields.

- [ ] **Step 2: Run the component test and verify RED**

Run: `npm run test:unit -- --runInBand src/components/game-design-system/GameDesignSystemCreatePage.test.tsx`

Expected: FAIL because Art Style stage and payload do not exist.

- [ ] **Step 3: Implement the Art Style stage**

```ts
const [artDirection, setArtDirection] = useState('');
const [visualReferences, setVisualReferences] = useState<Array<{ name: string; borrow: string }>>([]);
const [artAvoid, setArtAvoid] = useState('');

artStyle: {
  presetId: 'pixel-art',
  presetVersion: 1,
  customization: { direction: artDirection, referenceGames: normalizedVisualReferences, avoid: artAvoid },
}
```

Client validation sends incomplete visual-reference rows back to Art Style with a field-level message. Gameplay reference games remain unchanged on Sources.

- [ ] **Step 4: Add responsive presentation**

Use an unframed two-column work surface on desktop and catalog → preview → fields order on narrow screens. Preserve intrinsic image aspect ratio, apply `image-rendering: pixelated`, use compact 8px-or-less panels only for actual repeated preview items, and prevent horizontal overflow at 390px.

- [ ] **Step 5: Run GREEN and commit**

Run: `npm run test:unit -- --runInBand src/components/game-design-system/GameDesignSystemCreatePage.test.tsx`

Expected: suite passes.

Commit: `git add src/components/game-design-system/GameArtStylePreview.tsx src/components/game-design-system/GameDesignSystemCreatePage.tsx src/components/game-design-system/GameDesignSystemCreatePage.test.tsx src/components/game-design-system/GameDesignSystemsPage.module.css && git commit -m "feat: add art style creation stage"`

### Task 5: Read-Only Version Art Style View

**Files:**
- Modify: `src/components/game-design-system/GameDesignSystemWorkspace.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.test.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.module.css`

**Interfaces:**
- `GameDesignSystemView` adds `'art-style'` between Overview and Rules.
- View reads `selectedVersion.artStyle`; changing the version changes the displayed snapshot.
- `null` renders `No art style specified` without affecting any other tab.

- [ ] **Step 1: Write failing current/history/legacy/fallback tests**

Assert the tab order, map/character alt text, exact canonical fields, customization, historical version switching, legacy empty state, and a per-image unavailable label after an image `error` event while text remains visible.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:unit -- --runInBand src/components/game-design-system/GameDesignSystemsPage.test.tsx`

Expected: FAIL because the view is absent.

- [ ] **Step 3: Implement the read-only view**

```tsx
function ArtStyleView({ version }: { version: GameDesignSystemVersion | null }) {
  if (!version?.artStyle) return <div className={styles.inlineEmpty}>No art style specified</div>;
  return <GameArtStylePreview snapshot={version.artStyle} showCustomization />;
}
```

Unknown malformed snapshots are normalized to `null` during hydration so they fail locally here, while Overview and Rules remain usable. No edit button or mutation endpoint is added.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm run test:unit -- --runInBand src/components/game-design-system/GameDesignSystemsPage.test.tsx`

Expected: suite passes.

Commit: `git add src/components/game-design-system/GameDesignSystemWorkspace.tsx src/components/game-design-system/GameDesignSystemsPage.test.tsx src/components/game-design-system/GameDesignSystemsPage.module.css && git commit -m "feat: show immutable game art style"`

### Task 6: Browser Acceptance And Regression Locks

**Files:**
- Modify: `tests/e2e/specs/game-design-system.spec.ts`
- Modify: `src/lib/game-design-system/agentPolicy.test.ts`
- Create: `src/lib/game-design-system/ruleMarkdown.test.ts`
- Create: `tests/e2e/screenshots/game-art-style/` only when the repository's snapshot policy tracks reference images.

**Interfaces:**
- Playwright covers the actual four-stage flow and fixed previews at desktop and mobile widths.
- Regression tests prove Art Style is absent from Agent policy and Markdown.

- [ ] **Step 1: Add failing browser assertions and regression locks**

The browser scenario creates with custom direction, a visual reference, and avoid text; verifies the Review stage; completes through the existing mocked durable job; opens Art Style; changes to a historical/legacy fixture; and checks `document.documentElement.scrollWidth <= document.documentElement.clientWidth` at desktop and 390px mobile.

- [ ] **Step 2: Run focused tests and verify failures identify missing coverage only**

Run: `npm run test:unit -- --runInBand src/lib/game-design-system/agentPolicy.test.ts src/lib/game-design-system/ruleMarkdown.test.ts`

Run: `npx playwright test tests/e2e/specs/game-design-system.spec.ts --workers=1`

- [ ] **Step 3: Fix only acceptance-level gaps**

Do not broaden behavior. Adjust accessible names, fixed responsive constraints, or mocks/fixtures only where the browser evidence exposes a real gap.

- [ ] **Step 4: Capture and inspect desktop/mobile screenshots**

Run the local app on an unused port and capture create Art Style and workspace Art Style screens at 1440×1000 and 390×844. Inspect image rendering, text fit, tab overflow, reading order, and blank/failed assets.

- [ ] **Step 5: Run GREEN and commit**

Run: `npm run test:unit -- --runInBand src/lib/game-design-system/agentPolicy.test.ts src/lib/game-design-system/ruleMarkdown.test.ts`

Run: `npx playwright test tests/e2e/specs/game-design-system.spec.ts --workers=1`

Expected: all focused unit and browser cases pass.

Commit: `git add tests/e2e/specs/game-design-system.spec.ts src/lib/game-design-system/agentPolicy.test.ts src/lib/game-design-system/ruleMarkdown.test.ts tests/e2e/screenshots/game-art-style 2>/dev/null || true; git commit -m "test: cover game art style workflow"`

### Task 7: Final Verification, Review, And Handoff

**Files:**
- Modify when needed: files found by review only.
- Keep untracked/ignored: `.superpowers/`.
- Preserve: `next-env.d.ts` user change.

**Interfaces:**
- No new product behavior; this is the release gate.

- [ ] **Step 1: Run the complete focused suite**

Run: `npm run test:unit -- --runInBand src/lib/game-art-style src/lib/gameDesignSystemGeneration.test.ts src/lib/services/gameDesignSystemService.test.ts src/lib/game-design-system/worker.test.ts src/lib/game-design-system/agentPolicy.test.ts src/lib/game-design-system/ruleSchema.test.ts src/components/game-design-system/GameDesignSystemCreatePage.test.tsx src/components/game-design-system/GameDesignSystemsPage.test.tsx tests/unit/database/game-design-rule-system-migration.test.ts tests/unit/game-design-system-route-test-boundaries.test.ts tests/unit/game-design-system-routes.test.ts tests/unit/game-art-style-assets.test.ts`

- [ ] **Step 2: Run static verification and build**

Run: `npm run typecheck && npx eslint src/lib/game-art-style src/lib/gameDesignSystemGeneration.ts src/lib/services/gameDesignSystemService.ts src/lib/game-design-system/worker.ts src/app/api/game-design-systems/generation-jobs/route.ts src/components/game-design-system src/lib/services/gameDesignSystemClient.ts tests/unit/game-art-style-assets.test.ts && npm run build`

- [ ] **Step 3: Validate release assets and secrets**

Run: `sha256sum public/game-art-styles/pixel-art/v1/map.png public/game-art-styles/pixel-art/v1/character.png`

Run a repository diff scan proving no PixelLab token, signed URL, base64 response, `.env.local`, or `.superpowers/` candidate is staged.

- [ ] **Step 4: Request independent code and visual review**

Provide reviewers the design spec, this plan, base/head SHAs, focused test output, screenshots, and explicit requirements. Fix every Critical/Important finding, rerun affected tests, then rerun the final gate.

- [ ] **Step 5: Confirm scoped git state and hand off**

Run: `git status --short && git diff --check && git log --oneline --decorate -8`

Report changed behavior, verification evidence, local dev URL, the preserved unrelated `next-env.d.ts` change, and instruct the user to rotate the API key exposed in chat.
