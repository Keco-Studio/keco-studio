# Unified Game Design System Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragmented Document/Rules version creation with one atomic editor that can revise game background, document, rules, and the current Art Style while preserving immutable history and project pinning.

**Architecture:** A compatibility Document schema reads historical versions while a stricter generated-output schema requires new game background content. A strict partial-replacement route resolves a complete snapshot, detects canonical no-ops, and calls a CAS/idempotent RPC. A single React draft owner composes controlled Document, Rules, Art Style, and Review sections and submits one request.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Zod 3, TanStack Query, Supabase/PostgreSQL, Jest/Testing Library, Playwright, CSS Modules.

## Global Constraints

- Existing versions remain immutable and existing projects remain pinned to their selected version.
- Official systems remain read-only; only the owner of a personal system may create a version.
- System name, summary, and status remain mutable system metadata and are not added to version snapshots.
- Historical Documents without `gameBackground` remain readable and editable; newly generated systems require it.
- Public Art Style input contains only preset identity and customization; canonical snapshot fields are server-owned.
- Public edits require same-system parents, a current-version CAS value, and a UUID idempotency key.
- Trusted first-version/copy/generation paths retain nullable CAS and readable cross-system parent behavior.
- Sources are inherited exactly and never edited by this workflow.
- No automatic rebase, complex merge, new rule kinds, Agent-policy changes, or runtime image generation.
- Preserve unrelated `next-env.d.ts` and `.superpowers/` worktree changes.
- Complete and review Tasks 1-7 of this plan before starting any Game Art Style Catalog task. The plans share the version editor, CSS, tests, and E2E files and must not be implemented in parallel.

---

### Task 1: Versioned Game Background Contract

**Files:**
- Modify: `src/lib/game-design-system/ruleSchema.ts`
- Modify: `src/lib/game-design-system/ruleSchema.test.ts`
- Modify: `src/lib/game-design-system/ruleMarkdown.ts`
- Modify: `src/lib/game-design-system/ruleMarkdown.test.ts`
- Modify: `src/lib/gameDesignSystemGeneration.ts`
- Modify: `src/lib/gameDesignSystemGeneration.test.ts`
- Modify: `src/lib/gddGeneration.ts`
- Modify: `src/lib/gddGeneration.test.ts`

**Interfaces:**
- Produces: compatibility `gameDesignDocumentSchema` with `gameBackground?: string`.
- Produces: `generatedGameDesignDocumentSchema` with required `gameBackground: string`.
- Keeps: `parseGameDesignDocument()` for stored/historical content and `parseGeneratedGameDesignSystem()` for new model output.

- [ ] **Step 1: Write failing compatibility and generation tests**

Add assertions equivalent to:

```ts
expect(parseGameDesignDocument(validLegacyDocument)).toEqual(validLegacyDocument);
expect(parseGameDesignDocument({ ...validLegacyDocument, gameBackground: 'A river kingdom recovering from a magical flood.' }).gameBackground)
  .toBe('A river kingdom recovering from a magical flood.');
expect(() => parseGeneratedGameDesignSystem({ document: validLegacyDocument, rules: validRules })).toThrow(/gameBackground/);
```

Also assert Markdown includes `## Game Background & Setting` only when present and GDD context includes a sanitized `gameBackground` value.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx jest src/lib/game-design-system/ruleSchema.test.ts src/lib/game-design-system/ruleMarkdown.test.ts src/lib/gameDesignSystemGeneration.test.ts src/lib/gddGeneration.test.ts --runInBand
```

Expected: failures identify the missing generated schema, prompt field, Markdown section, and GDD context value.

- [ ] **Step 3: Add the dual schema and generation contract**

Use the existing bounded-string helper and strict object shape:

```ts
export const gameDesignDocumentSchema = z.object({
  gameBackground: boundedString(4_000).optional(),
  // existing fields remain unchanged
}).strict();

export const generatedGameDesignDocumentSchema = gameDesignDocumentSchema.extend({
  gameBackground: boundedString(4_000),
}).strict();
```

Make `generatedGameDesignSystemSchema.document` use the required schema. Add `gameBackground` to the exact model shape/example and to both first-pass and repair instructions. Do not send Art Style into generation messages.

- [ ] **Step 4: Render and propagate background safely**

Insert the optional Markdown section before Design Intent. Include the field in `designDocumentContext()` with the same sanitization and maximum as adjacent fields:

```ts
gameBackground: document.gameBackground ? sanitize(document.gameBackground) : null,
```

Do not synthesize background for historical compatibility documents.

- [ ] **Step 5: Run GREEN and commit**

Run the Step 2 command, then:

```bash
git add src/lib/game-design-system/ruleSchema.ts src/lib/game-design-system/ruleSchema.test.ts \
  src/lib/game-design-system/ruleMarkdown.ts src/lib/game-design-system/ruleMarkdown.test.ts \
  src/lib/gameDesignSystemGeneration.ts src/lib/gameDesignSystemGeneration.test.ts \
  src/lib/gddGeneration.ts src/lib/gddGeneration.test.ts
git commit -m "feat: version game background in design systems"
```

### Task 2: Canonical Cross-Domain Diff And Read Integrity

**Files:**
- Create: `src/lib/game-design-system/versionDiff.ts`
- Create: `src/lib/game-design-system/versionDiff.test.ts`
- Modify: `src/lib/services/gameDesignSystemService.ts`
- Modify: `src/lib/services/gameDesignSystemService.test.ts`
- Modify: `src/lib/game-design-system/sourceVisibility.ts`
- Modify: `src/lib/game-design-system/sourceVisibility.test.ts`

**Interfaces:**
- Produces: `GameDesignSystemVersionDiffV2`, `createVersionDiff(parent, next)`, `canonicalJsonEqual(a, b)`.
- Extends: `GameDesignSystemVersion.artStyleReadError: { code: 'UNSUPPORTED_SNAPSHOT' } | null`.
- Preserves: top-level rule `added/removed/changed/conflicts` fields for compatibility.

- [ ] **Step 1: Write failing pure diff and integrity tests**

Cover document-only, background-only, rule settings, Table Guidance, preset, preset-version, customization, add/remove, and unchanged cases. Assert priority:

```ts
expect(diff.artStyle.change).toBe('preset_changed');
expect(diff.document.changedSections).toEqual(['gameBackground']);
expect(diff.ruleSetSettingsChanged).toBe(false);
expect(diff.tableGuidanceChanged).toBe(false);
```

Add hydration coverage where SQL `art_style = null` gives no read error, a valid snapshot parses, and malformed non-null JSON gives `UNSUPPORTED_SNAPSHOT` instead of indistinguishable legacy absence.

This plan initially uses the current strict Pixel v1 parser. The catalog plan must replace this call site with its retained-registry-aware parser when structural snapshot schemas are generalized, preserving the same null/unsupported distinction.

- [ ] **Step 2: Run RED**

```bash
npx jest src/lib/game-design-system/versionDiff.test.ts src/lib/services/gameDesignSystemService.test.ts src/lib/game-design-system/sourceVisibility.test.ts --runInBand
```

Expected: new module/type assertions fail.

- [ ] **Step 3: Implement canonical equality and v2 diff**

Canonicalization recursively sorts object keys, retains array order, rejects unsupported JS values, and compares JSON strings. `createVersionDiff` embeds `diffRuleSets` and emits every required v2 field. Legacy rows keep their stored rule diff; the detail read projection derives cross-domain changes when the parent is loaded, otherwise marks them `not_recorded` in the view model rather than `unchanged`.

- [ ] **Step 4: Preserve unsupported Art Style state through visibility redaction**

Hydrate with:

```ts
const parsed = rawArtStyle == null ? null : gameArtStyleSnapshotSchema.safeParse(rawArtStyle);
artStyle: parsed?.success ? parsed.data : null,
artStyleReadError: rawArtStyle != null && !parsed?.success ? { code: 'UNSUPPORTED_SNAPSHOT' } : null,
```

Ensure visibility mapping copies the read error but never exposes raw invalid JSON.

- [ ] **Step 5: Run GREEN and commit**

Run Step 2, then commit only listed files:

```bash
git add src/lib/game-design-system/versionDiff.ts src/lib/game-design-system/versionDiff.test.ts \
  src/lib/services/gameDesignSystemService.ts src/lib/services/gameDesignSystemService.test.ts \
  src/lib/game-design-system/sourceVisibility.ts src/lib/game-design-system/sourceVisibility.test.ts
git commit -m "feat: describe complete design system version changes"
```

### Task 3: CAS And Idempotent Version Persistence

**Files:**
- Create: `supabase/migrations/20260818190000_game_design_system_version_cas.sql`
- Modify: `tests/unit/database/game-design-rule-system-migration.test.ts`
- Modify: `tests/unit/database/game-design-system-version-visibility.behavior.test.ts`
- Modify: `src/lib/services/gameDesignSystemService.ts`
- Modify: `src/lib/services/gameDesignSystemService.test.ts`

**Interfaces:**
- Adds: nullable `game_design_system_versions.idempotency_key uuid` and unique partial index on `(system_id, idempotency_key)`.
- Replaces RPC with new parameters `p_expected_current_version_id uuid` and `p_idempotency_key uuid`.
- Adds service inputs `expectedCurrentVersionId?: string | null` and `idempotencyKey?: string | null`.

- [ ] **Step 1: Write failing migration/service tests**

Assert the migration drops the old 12-argument signature, creates one 14-argument signature, uses `IS NOT DISTINCT FROM` under the system-row lock, checks existing idempotency output before stale rejection, includes the key in insert, revokes obsolete overloads from `public, anon, authenticated`, grants only `service_role`, and notifies PostgREST.

Service tests must show public-style input forwards non-null CAS/key, initial internal creation forwards both as null, generation idempotency remains unchanged, and replay hydration returns the original row. Add live-database behavior cases that issue concurrent RPC calls: two distinct keys with the same expected current produce exactly one success and one `VERSION_STALE` with only one inserted row; the same key submitted concurrently returns the same version from both calls; and a generation-job replay still returns its original output after current has advanced.

- [ ] **Step 2: Run RED**

```bash
npx jest tests/unit/database/game-design-rule-system-migration.test.ts \
  tests/unit/database/game-design-system-version-visibility.behavior.test.ts \
  src/lib/services/gameDesignSystemService.test.ts --runInBand
```

- [ ] **Step 3: Implement the additive column/index and closed RPC migration**

The RPC order under the destination-system row lock is:

1. lock and authorize the destination system;
2. resolve an existing `(system_id, idempotency_key)` row and verify parent/content hash/actor before returning it;
3. resolve an existing `generation_job_id` row, verify it belongs to the expected destination/job contract, and return it before CAS so a completed internal generation remains replayable after current changes;
4. compare current ID with `p_expected_current_version_id` using `IS NOT DISTINCT FROM`;
5. retain trusted readable cross-system parent authorization;
6. allocate number, insert the complete snapshot/key, and update current.

Raise stable exception messages/codes for stale and key conflicts so the route can map them.

- [ ] **Step 4: Forward nullable trusted inputs without changing callers' authority**

`createGameDesignSystemVersion()` forwards explicit nullable values. Internal creation/copy/generation callers omit them and therefore pass null. Do not accept a `trusted` boolean or mode from browser input.

- [ ] **Step 5: Run GREEN and commit**

Run Step 2, then:

```bash
git add supabase/migrations/20260818190000_game_design_system_version_cas.sql \
  tests/unit/database/game-design-rule-system-migration.test.ts \
  tests/unit/database/game-design-system-version-visibility.behavior.test.ts \
  src/lib/services/gameDesignSystemService.ts src/lib/services/gameDesignSystemService.test.ts
git commit -m "feat: serialize design system version writes"
```

### Task 4: Strict Partial-Replacement Version API

**Files:**
- Create: `src/lib/game-design-system/versionRequest.ts`
- Create: `src/lib/game-design-system/versionRequest.test.ts`
- Modify: `src/app/api/game-design-systems/[id]/versions/route.ts`
- Modify: `tests/unit/game-design-system-routes.test.ts`
- Modify: `tests/unit/game-design-system-route-test-boundaries.test.ts`
- Modify: `src/lib/services/gameDesignSystemClient.ts`

**Interfaces:**
- Produces: strict `createGameDesignSystemVersionRequestSchema` and `CreateGameDesignSystemVersionRequest`.
- Changes client to `createGameDesignSystemVersion(id, request, idempotencyKey)`.
- Maps: stale to `409 VERSION_STALE`, key conflict to `409 IDEMPOTENCY_CONFLICT`, no-op to `409 VERSION_NO_CHANGES`.

- [ ] **Step 1: Write failing schema/route tests**

Cover strict unknown-key rejection, missing/invalid UUID header, same-system parent, owner authorization, absent-field inheritance, simultaneous three-domain replacement, `artStyle: null`, forged snapshot fields, retired/unknown preset, canonical no-op, reintroduced rule IDs, stale current, replayed key, and key conflict.

Expected request example:

```ts
{
  parentVersionId: parent.id,
  expectedCurrentVersionId: current.id,
  document: changedDocument,
  rules: changedRules,
  artStyle: { presetId: 'pixel-art', presetVersion: 1, customization: { referenceGames: [] } },
}
```

- [ ] **Step 2: Run RED**

```bash
npx jest src/lib/game-design-system/versionRequest.test.ts \
  tests/unit/game-design-system-route-test-boundaries.test.ts \
  tests/unit/game-design-system-routes.test.ts --runInBand
```

- [ ] **Step 3: Resolve one trusted complete snapshot in the route**

Parse the strict request and key, load system/parent/current, compile only a supplied non-null Art Style, inherit omitted fields, compare the resolved complete triple canonically to the parent, retain ancestry checks, then call the service with CAS and key. Never accept `GameArtStyleSnapshot` from the request.

- [ ] **Step 4: Replace the positional browser client API**

```ts
export async function createGameDesignSystemVersion(
  id: string,
  input: CreateGameDesignSystemVersionRequest,
  key = crypto.randomUUID(),
): Promise<GameDesignSystemVersion>
```

Send `Idempotency-Key` and preserve server error `code` on the thrown client error so stale UI can branch without string matching.

- [ ] **Step 5: Run GREEN and commit**

Run Step 2, then:

```bash
git add src/lib/game-design-system/versionRequest.ts src/lib/game-design-system/versionRequest.test.ts \
  src/app/api/game-design-systems/[id]/versions/route.ts \
  tests/unit/game-design-system-route-test-boundaries.test.ts tests/unit/game-design-system-routes.test.ts \
  src/lib/services/gameDesignSystemClient.ts
git commit -m "feat: add atomic version replacement API"
```

### Task 5: Controlled Unified Version Editor

**Files:**
- Create: `src/components/game-design-system/GameDesignSystemVersionEditor.tsx`
- Create: `src/components/game-design-system/GameDesignSystemVersionEditor.test.tsx`
- Create: `src/components/game-design-system/GameDesignSystemArtStyleFields.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemDocumentEditor.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemRuleEditor.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.module.css`

**Interfaces:**
- Produces: `GameDesignSystemVersionEditor({ baseVersion, currentVersionId, pending, onCancel, onCreate, onRefreshLatest })`.
- Refactors Document/Rules editors into controlled field surfaces; only the unified editor owns draft/review/save state.
- Supports the current Pixel Art input in this plan; the next plan expands the catalog.

- [ ] **Step 1: Write failing unified editor tests**

Test one draft changing background, document genres/philosophies/suitability, every Rule field for at least one rule, Table Guidance, Art Style preset/revision, and Art Style customization across section navigation. Assert values survive navigation, Review displays concrete before/after data for each of those fields, and `onCreate` receives one partial-replacement request derived from the same reviewed draft. Cover no-op disabled state, switching values back to their originals restoring no-op, validation focus, cancel confirmation, failed-save state retention, keyboard section navigation, historical-base warning, and unsupported Art Style read state.

- [ ] **Step 2: Run RED**

```bash
npx jest src/components/game-design-system/GameDesignSystemVersionEditor.test.tsx --runInBand
```

- [ ] **Step 3: Extract controlled field surfaces**

Document accepts `value/onChange` and includes `Game background & setting`. Rules accepts `value/onChange`, keeps add/delete/move/settings/Table Guidance behavior, and provides search plus kind/severity filters. Remove child-level save/review ownership so only the parent can create a version.

- [ ] **Step 4: Implement one draft owner and detailed Review**

The parent clones the base, tracks changed domains, preserves section state, focuses headings/errors, and emits only changed components. Art Style submits input only when changed; otherwise it is omitted so retired/historical snapshots inherit exactly.

On `VERSION_STALE`, keep the draft and call `onRefreshLatest()`. The Workspace owns the TanStack query refetch and returns the newly loaded current version; the editor then shows that version's number/context and lets the user select domains to copy into a fresh draft based on it. If refresh fails, retain the original draft and expose retry/cancel. Do not auto-merge. Test the editor callback contract and the Workspace refetch/cache handoff separately.

- [ ] **Step 5: Add stable responsive layout**

Desktop uses a quiet workbench with section navigation and one content surface. Below 900px use a compact section select, searchable rule select, single-column fields, 44px targets, and non-overlapping sticky Review action. Do not nest cards or introduce dependencies.

- [ ] **Step 6: Run GREEN and commit**

Run Step 2 and ESLint on changed components, then:

```bash
git add src/components/game-design-system/GameDesignSystemVersionEditor.tsx \
  src/components/game-design-system/GameDesignSystemVersionEditor.test.tsx \
  src/components/game-design-system/GameDesignSystemArtStyleFields.tsx \
  src/components/game-design-system/GameDesignSystemDocumentEditor.tsx \
  src/components/game-design-system/GameDesignSystemRuleEditor.tsx \
  src/components/game-design-system/GameDesignSystemsPage.module.css
git commit -m "feat: add unified design system version editor"
```

### Task 6: Workspace Integration And Complete Rules Reading

**Files:**
- Modify: `src/components/game-design-system/GameDesignSystemWorkspace.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.test.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.module.css`

**Interfaces:**
- Replaces: header `Edit document` and Rules-local `New version` with header `Create new version`.
- Renames: `Edit details` to `Edit system info`.
- Consumes: `GameDesignSystemVersionEditor` and new object client API.

- [ ] **Step 1: Write failing workspace behavior tests**

Assert personal/official action visibility, base version initialization, one API call for cross-domain edits, selected new version, return to Overview, project binding untouched, stale recovery through a Workspace-owned latest-version refetch, idempotent lost-response recovery, actual Game Background display plus historical `Not specified`, complete Rules settings/Table Guidance in read mode, legacy diff `not recorded`, unsupported Art Style state, and full tab keyboard behavior.

- [ ] **Step 2: Run RED**

```bash
npx jest src/components/game-design-system/GameDesignSystemsPage.test.tsx --runInBand
```

- [ ] **Step 3: Integrate the unified editor and remove fragmented save paths**

Keep browse tabs. The header action opens the editor for `selectedVersion`; exit restores focus. Successful save updates the query cache, selects the result, returns to Overview, and focuses the document heading. Delete metadata behavior is unchanged.

- [ ] **Step 4: Enrich Rules and Versions read views**

Rules displays genres, philosophies, suitability, and Table Guidance beside the selected rule. Versions renders domain labels and detailed/unknown legacy states. Source snapshots remain read-only and the existing Sources view may remain.

- [ ] **Step 5: Run GREEN and commit**

Run Step 2 and focused ESLint, then:

```bash
git add src/components/game-design-system/GameDesignSystemWorkspace.tsx \
  src/components/game-design-system/GameDesignSystemsPage.test.tsx \
  src/components/game-design-system/GameDesignSystemsPage.module.css
git commit -m "feat: unify game design system version creation"
```

### Task 7: Responsive And End-To-End Acceptance

**Files:**
- Modify: `tests/e2e/specs/game-design-system.spec.ts`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.module.css` only if visual evidence finds a defect.

**Interfaces:**
- Verifies the complete plan without changing API contracts.
- Runs the live PostgreSQL CAS/idempotency suite when `RLS_DB_TESTS_ENABLED` is configured; a skipped suite is reported as an unverified release gate, not treated as concurrency evidence.

- [ ] **Step 1: Extend the mock backend for CAS/idempotency and cross-domain versions**

Record the idempotency header, enforce expected-current behavior, return v2 diffs, and preserve project bindings.

- [ ] **Step 2: Add the full workflow test**

At 1440x900 and 390x844, create one version that changes background, rules guidance, and Art Style customization. Assert one POST, specific Review content, current selection, readable Rules context, unchanged project pin, no horizontal overflow, no overlap, and stable focus.

- [ ] **Step 3: Run focused and broad verification**

```bash
npx jest src/lib/game-design-system src/lib/services/gameDesignSystemService.test.ts \
  src/components/game-design-system/GameDesignSystemVersionEditor.test.tsx \
  src/components/game-design-system/GameDesignSystemsPage.test.tsx \
  tests/unit/game-design-system-route-test-boundaries.test.ts \
  tests/unit/game-design-system-routes.test.ts \
  tests/unit/database/game-design-rule-system-migration.test.ts --runInBand
npm run typecheck
npx playwright test tests/e2e/specs/game-design-system.spec.ts --workers=1
git diff --check
```

Expected: all focused suites pass; screenshots/canvas-independent layout checks are non-overlapping at both viewports.

- [ ] **Step 4: Commit acceptance coverage**

```bash
git add tests/e2e/specs/game-design-system.spec.ts src/components/game-design-system/GameDesignSystemsPage.module.css
git commit -m "test: cover unified design system versioning"
```
