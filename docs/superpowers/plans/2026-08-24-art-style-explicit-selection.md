# Explicit Art Style Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require an explicit Art Style preset choice during new Game Design System creation while keeping all customization optional.

**Architecture:** The create page owns the nullable selection state and both navigation gates. The catalog supports a no-selection radio-group state, while the existing request schema remains the server authority for requiring a syntactically valid preset selector.

**Tech Stack:** React 19, TypeScript, CSS Modules, Jest, Testing Library, Zod.

## Global Constraints

- Do not use TDD; the user explicitly requested implementation before test changes.
- Start creation with no selected Art Style.
- A valid preset selection is required; reference games, custom direction, and avoid guidance remain optional.
- Preserve paired validation for any non-empty visual reference row.
- Do not change historical versions, the version editor, preset fixtures, or saved snapshots.
- Keep the selected preview and empty state dimensionally stable across desktop and mobile layouts.

---

### Task 1: Add explicit preset selection state and navigation gates

**Files:**
- Modify: `src/components/game-design-system/GameDesignSystemCreatePage.tsx`
- Modify: `src/components/game-design-system/GameArtStyleCatalog.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.module.css`

**Interfaces:**
- Consumes: `GAME_ART_STYLE_CATALOG`, `GAME_ART_STYLE_PRESETS_BY_KEY`, and `gameArtStyleInputSchema`.
- Produces: nullable create-page selection state, `selectArtStyle(key: string)`, `continueFromArtStyle()`, and a catalog that accepts `selectedKey: string | null`.

- [ ] **Step 1: Remove the create-page fallback preset**

Initialize the selection as `null`, resolve the preset only when a key exists,
and parse Art Style input only when a preset has been selected:

```tsx
const [selectedArtStyleKey, setSelectedArtStyleKey] = useState<string | null>(null);
const selectedArtStylePreset = selectedArtStyleKey
  ? GAME_ART_STYLE_PRESETS_BY_KEY[selectedArtStyleKey]
  : undefined;
const artStyleResult = useMemo(() => selectedArtStylePreset
  ? gameArtStyleInputSchema.safeParse({
      presetId: selectedArtStylePreset.presetId,
      presetVersion: selectedArtStylePreset.presetVersion,
      customization: { direction: artDirection, referenceGames: visualReferences, avoid: artAvoid },
    })
  : null, [artAvoid, artDirection, selectedArtStylePreset, visualReferences]);
```

Remove the `DEFAULT_GAME_ART_STYLE_KEY` import. Make `reviewCustomization`
handle a nullable parse result without inventing a preset.

- [ ] **Step 2: Add selection and continuation handlers**

Clear the shared Art Style error when a user selects a preset and block the
linear flow until that interaction occurs:

```tsx
function selectArtStyle(key: string) {
  clearVisualReferenceError();
  setSelectedArtStyleKey(key);
}

function continueFromArtStyle() {
  setError(null);
  if (!selectedArtStylePreset) {
    setInvalidVisualReference(null);
    setVisualReferenceError('Select an Art Style before continuing.');
    return;
  }
  setStage('sources');
}
```

Use `selectArtStyle` as the catalog callback and `continueFromArtStyle` for the
`Continue to sources` button.

- [ ] **Step 3: Gate final generation by selection, then validate customization**

Place selection validation before schema issue inspection:

```tsx
if (!selectedArtStylePreset || !artStyleResult) {
  setStage('art-style');
  setInvalidVisualReference(null);
  setVisualReferenceError('Select an Art Style before generating.');
  return;
}
if (!artStyleResult.success) {
  // Keep the existing reference issue mapping and paired-field message.
  return;
}
```

Delete the old rule that required direction, a reference, or avoid guidance.
A successful preset-only parse proceeds to `generationInput`.

- [ ] **Step 4: Render the no-selection preview and safe review state**

Render `GameArtStylePreview` only for a selected preset. Otherwise render:

```tsx
<section className={styles.artStyleSelectionEmpty} aria-label="No Art Style selected">
  <span className={styles.eyebrow}>Art Style preview</span>
  <h3>Select an Art Style</h3>
  <p>Select an Art Style to preview its visual direction.</p>
</section>
```

When direct tab navigation reaches Review without a preset, render `Not
selected` and omit preset details rather than dereferencing an undefined
preset.

- [ ] **Step 5: Make the catalog's selected key nullable**

Update the catalog contract without changing its roving keyboard behavior:

```tsx
type Props = {
  catalog: readonly (typeof GAME_ART_STYLE_CATALOG)[number][];
  selectedKey: string | null;
  onSelect: (key: string) => void;
};
```

With `selectedIndex === -1`, the first option remains the sole `tabIndex=0`
entry but exposes `aria-checked=false` until activated.

- [ ] **Step 6: Add stable empty-state styling**

Add a restrained, unframed placeholder that occupies the preview column:

```css
.artStyleSelectionEmpty {
  display: grid;
  min-height: 420px;
  align-content: center;
  justify-items: center;
  padding: 32px;
  color: #687381;
  text-align: center;
}

.artStyleSelectionEmpty h3 {
  margin: 8px 0 0;
  color: #27313d;
  font-size: 18px;
  letter-spacing: 0;
}

.artStyleSelectionEmpty p {
  max-width: 360px;
  margin: 8px 0 0;
  line-height: 1.6;
}
```

- [ ] **Step 7: Run type-aware lint for the changed components**

Run:

```bash
npx eslint src/components/game-design-system/GameDesignSystemCreatePage.tsx \
  src/components/game-design-system/GameArtStyleCatalog.tsx
```

Expected: exit code 0 with no lint errors.

### Task 2: Update regression coverage for explicit selection

**Files:**
- Modify: `src/components/game-design-system/GameDesignSystemCreatePage.test.tsx`
- Modify: `src/lib/game-design-system/generationRequest.test.ts`

**Interfaces:**
- Consumes: the create-page labels, catalog radio semantics, and `gameDesignGenerationRequestSchema`.
- Produces: regression evidence for initial no-selection, both navigation gates, optional customization, paired references, and the server selector contract.

- [ ] **Step 1: Make test navigation select a preset explicitly**

Replace the helper's customization-based completion with an explicit catalog
choice:

```tsx
async function selectPixelArt(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /Pixel Art/ }));
}

async function continueToReview(user: ReturnType<typeof userEvent.setup>, { selectArtStyle = true } = {}) {
  if (selectArtStyle) await selectPixelArt(user);
  await user.click(screen.getByRole('button', { name: 'Continue to sources' }));
  if (selectArtStyle) await user.click(screen.getByRole('button', { name: 'Review input' }));
}
```

Update existing successful paths to use the helper or select the preset before
continuing.

- [ ] **Step 2: Cover initial and continuation behavior**

Assert that all catalog radios start unchecked, the first remains keyboard
reachable, the empty preview is visible, and `Continue to sources` shows
`Select an Art Style before continuing.` without changing stages.

- [ ] **Step 3: Cover the final submission fallback**

Navigate directly to Review through stage tabs, click `Generate system`, and
assert that the page returns to Art Style, focuses the error, displays `Select
an Art Style before generating.`, and never calls the client.

- [ ] **Step 4: Prove preset-only submission is valid**

Select Pixel Art, leave direction, visual references, and avoid guidance empty,
continue through Review, submit, and assert this payload:

```tsx
expect(start).toHaveBeenCalledWith(expect.objectContaining({
  artStyle: {
    presetId: 'pixel-art',
    presetVersion: 2,
    customization: { direction: '', referenceGames: [], avoid: '' },
  },
}), expect.any(String));
```

- [ ] **Step 5: Preserve incomplete-reference coverage**

Select a preset before adding `Eastward` without a borrow value. Keep the
existing assertions for `aria-invalid`, `aria-describedby`, focus, preserved
input, and no client call.

- [ ] **Step 6: Strengthen the server schema contract test**

Add an assertion that a valid selector with empty customization parses, while
the existing missing-Art-Style assertion continues to throw:

```ts
expect(gameDesignGenerationRequestSchema.parse({
  ...valid,
  artStyle: {
    presetId: 'pixel-art',
    presetVersion: 2,
    customization: { direction: '', referenceGames: [], avoid: '' },
  },
}).artStyle.customization).toEqual({ direction: '', referenceGames: [], avoid: '' });
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm run test:unit -- --runInBand \
  src/components/game-design-system/GameDesignSystemCreatePage.test.tsx \
  src/lib/game-design-system/generationRequest.test.ts
```

Expected: both suites pass with zero failures.

- [ ] **Step 8: Run repository verification**

Run:

```bash
npm run lint
npm run typecheck
npm run test:unit -- --runInBand
npm run build
git diff --check
```

Expected: every command exits 0. If a repository-wide pre-existing failure is
encountered, record the exact output and separately prove all changed-file and
focused tests pass before opening the PR.

- [ ] **Step 9: Commit implementation and tests**

```bash
git add src/components/game-design-system/GameDesignSystemCreatePage.tsx \
  src/components/game-design-system/GameArtStyleCatalog.tsx \
  src/components/game-design-system/GameDesignSystemsPage.module.css \
  src/components/game-design-system/GameDesignSystemCreatePage.test.tsx \
  src/lib/game-design-system/generationRequest.test.ts \
  docs/superpowers/plans/2026-08-24-art-style-explicit-selection.md
git commit -m "fix: require explicit art style selection"
```
