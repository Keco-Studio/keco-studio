# Map And Plan Version Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save immutable Plan versions independently of generated Map versions, with every Map version permanently bound to its source Plan version.

**Architecture:** Keep `map_revisions` as the mutable Draft and generated-image store. Add `map_plan_versions` for explicit immutable snapshots, and attach `map_version_number` plus `plan_version_id` to generated revisions. The workbench renders Draft, Plan, and historical Map selections as separate states.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase PostgreSQL RPCs, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-map-plan-version-separation-design.md`

## Global Constraints

- Autosave persists only the active Draft using its existing 750ms debounce and CAS token.
- Only explicit `Save plan` creates `Plan Vn`; only successful generation creates `Map Vn`.
- A Map binding is immutable, while Drafts remain editable.
- Preserve current image asset IDs, storage paths, and provider contracts.
- Leave the unrelated document-card style files uncommitted and outside feature commits.

---

### Task 1: Persist Immutable Plan Snapshots And Map Bindings

**Files:**
- Create: `supabase/migrations/20260929100000_map_plan_versions.sql`
- Modify: `tests/unit/database/create-map-v3-migration.test.ts`
- Modify: `tests/unit/database/create-map-workbench.rls.behavior.test.ts`

**Interfaces:**
- Produces `map_plan_versions(id, map_project_id, plan_version_number, draft_revision_id, draft_save_version, plan, source_document_id, source_document_updated_at, source_epoch, source_revision, created_by, created_at)`.
- Adds nullable `map_version_number` and `plan_version_id` to `map_revisions`.
- Adds `save_map_plan_v3(map_id, draft_revision_id, expected_save_version)` returning `status, plan_version_id, plan_version_number, draft_save_version`.
- Extends `publish_map_revision_v3` with `plan_version_id` and a returned `map_version_number`.

- [ ] **Step 1: Write failing migration tests**

```ts
expect(sql).toMatch(/create table public\.map_plan_versions/i);
expect(sql).toMatch(/unique \(map_project_id, plan_version_number\)/i);
expect(sql).toMatch(/add column if not exists map_version_number bigint/i);
expect(sql).toMatch(/add column if not exists plan_version_id uuid/i);
expect(sql).toMatch(/create function public\.save_map_plan_v3\(/i);
expect(sql).toMatch(/publish_map_revision_v3\([\s\S]*p_plan_version_id uuid/i);
```

- [ ] **Step 2: Verify that the tests fail**

Run: `npx jest --runInBand tests/unit/database/create-map-v3-migration.test.ts tests/unit/database/create-map-workbench.rls.behavior.test.ts`

Expected: FAIL because the table, columns, and RPC contract are absent.

- [ ] **Step 3: Implement the migration and RPCs**

Create the snapshot table with project-scoped uniqueness, immutable row protection, RLS, and authenticated grants. The save RPC locks the current V3 Draft, validates its CAS version, and snapshots exactly that Draft:

```sql
insert into public.map_plan_versions (
  map_project_id, plan_version_number, draft_revision_id, draft_save_version,
  plan, source_document_id, source_document_updated_at, source_epoch,
  source_revision, created_by
) values (
  p_map_id, v_next_plan_version, v_draft.id, v_draft.save_version,
  v_draft.plan, v_draft.source_document_id, v_draft.source_document_updated_at,
  v_draft.source_epoch, v_draft.source_revision, v_user_id
) returning id into v_plan_version_id;
```

Extend publish to lock `p_plan_version_id`, require its `map_project_id` and JSON `plan` to match the Draft, allocate `map_version_number` only among generated V3 revisions, then store the Plan ID and Map number before creating the existing successor Draft. Backfill existing generated V3 revisions in chronological order with copied Plan snapshots and bindings.

- [ ] **Step 4: Verify migration tests pass**

Run: `npx jest --runInBand tests/unit/database/create-map-v3-migration.test.ts tests/unit/database/create-map-workbench.rls.behavior.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add supabase/migrations/20260929100000_map_plan_versions.sql tests/unit/database/create-map-v3-migration.test.ts tests/unit/database/create-map-workbench.rls.behavior.test.ts && git commit -m "feat: persist map plan versions"`

### Task 2: Add Typed Plan And Map Version Service APIs

**Files:**
- Modify: `src/features/create-map/services/createMapService.ts`
- Modify: `tests/unit/create-map/create-map-service.test.ts`

**Interfaces:**
- Produces `MapPlanVersion { id; versionNumber; draftRevisionId; draftSaveVersion; plan }`.
- Produces `MapVersionSummary { mapRevisionId; mapVersionNumber; planVersionId; planVersionNumber }`.
- Produces `MapVersionWorkspaceV3 { mapVersion; planVersion; mapPlan; mapScene; image }`.
- Adds `savePlanV3(identity, plan)`, `listMapVersionsV3(mapId)`, and `loadMapVersionV3(mapId, mapRevisionId)`.
- Changes `publishV3(identity, planVersionId)`.

- [ ] **Step 1: Write failing service tests**

```ts
const plan = makeValidMapPlanV3();
await expect(service.savePlanV3(identity, plan)).resolves.toMatchObject({
  id: 'plan-v2', versionNumber: 2, draftRevisionId: identity.revisionId,
  draftSaveVersion: identity.saveVersion,
});
expect(rpc).toHaveBeenCalledWith('save_map_plan_v3', expect.objectContaining({
  p_map_id: identity.mapId, p_draft_revision_id: identity.revisionId,
  p_expected_save_version: identity.saveVersion,
}));
expect(rpc).toHaveBeenCalledWith('publish_map_revision_v3', expect.objectContaining({
  p_plan_version_id: 'plan-v2',
}));
```

Add a historical read case where later `Plan V2` exists but `Map V1` still returns its bound `Plan V1`, plus a cross-project binding rejection case.

- [ ] **Step 2: Verify the service tests fail**

Run: `npx jest --runInBand tests/unit/create-map/create-map-service.test.ts`

Expected: FAIL because these types and RPC calls do not exist.

- [ ] **Step 3: Implement exact read and write models**

```ts
export type MapVersionSummary = {
  mapRevisionId: string;
  mapVersionNumber: number;
  planVersionId: string;
  planVersionNumber: number;
};

async function savePlanV3(identity: MapDraftIdentity, plan: MapPlanV3): Promise<MapPlanVersion> {
  const { data, error } = await supabase.rpc('save_map_plan_v3', {
    p_map_id: identity.mapId,
    p_draft_revision_id: identity.revisionId,
    p_expected_save_version: identity.saveVersion,
  });
  if (error) throw new CreateMapServiceError(error.code ?? 'save_plan_failed', error.message);
  const row = firstRow<{
    status: string;
    plan_version_id: string | null;
    plan_version_number: number | null;
    draft_save_version: number | null;
  }>(data);
  if (row.status === 'conflict') throw new CreateMapServiceError('save_conflict');
  if (row.status !== 'saved' || !row.plan_version_id || row.plan_version_number == null
    || row.draft_save_version == null) throw new CreateMapServiceError('invalid_response');
  return {
    id: row.plan_version_id,
    versionNumber: row.plan_version_number,
    draftRevisionId: identity.revisionId,
    draftSaveVersion: row.draft_save_version,
    plan: MapPlanV3Schema.parse(plan),
  };
}
```

Load historical maps through `map_revisions.plan_version_id`, not a number-derived join. Build the canvas image binding from the selected map revision asset, independent of the active Draft. Keep `MapDraftIdentity.revisionNumber` internal and never use it as a UI Map label.

- [ ] **Step 4: Verify the service tests pass**

Run: `npx jest --runInBand tests/unit/create-map/create-map-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/features/create-map/services/createMapService.ts tests/unit/create-map/create-map-service.test.ts && git commit -m "feat: expose map and plan version bindings"`

### Task 3: Save Plans Explicitly While Keeping Draft Autosave

**Files:**
- Modify: `src/features/create-map/hooks/useMapDraft.ts`
- Modify: `src/features/create-map/hooks/useDirectMapGeneration.ts`
- Modify: `src/features/create-map/components/DirectMapPlanInspector.tsx`
- Modify: `src/features/create-map/DirectMapWorkbench.tsx`
- Modify: `tests/unit/create-map/direct-map-plan-inspector.test.tsx`
- Modify: `tests/unit/create-map/direct-map-generation.test.ts`

**Interfaces:**
- Produces `SavedPlanSelection { id; versionNumber; draftRevisionId; draftSaveVersion }` in workbench state.
- Adds `onSavePlan` and `versionLabel` to `DirectMapPlanInspector`.
- Changes generation to require an exact non-stale `planVersionId`.

- [ ] **Step 1: Write failing UI and generation tests**

```ts
expect(markup).toContain('Save plan');
expect(markup).toContain('Draft');
await expect(generation.prepare()).rejects.toThrow('Save the current Plan version before generating.');
expect(publish).toHaveBeenCalledWith(identity, 'plan-v1');
```

- [ ] **Step 2: Verify focused tests fail**

Run: `npx jest --runInBand tests/unit/create-map/direct-map-plan-inspector.test.tsx tests/unit/create-map/direct-map-generation.test.ts`

Expected: FAIL because explicit saved-plan state does not exist.

- [ ] **Step 3: Implement Draft and Save plan states**

Keep `SerializedMapDraftWriter` and its 750ms debounce unchanged. The workbench clears `savedPlanSelection` whenever the Draft payload, identity, or save version changes. `Save plan` calls `draft.saveNow()`, waits for a settled Draft, calls `service.savePlanV3(draft.identity, plan)`, then stores:

```ts
setSavedPlanSelection({
  id: saved.id,
  versionNumber: saved.versionNumber,
  draftRevisionId: saved.draftRevisionId,
  draftSaveVersion: saved.draftSaveVersion,
});
```

Display `Draft` until a snapshot is selected, otherwise `Plan V${saved.versionNumber}`. Pass the selected Plan ID into publish. Any subsequent Draft edit leaves autosave intact but requires another explicit Save plan before generation.

- [ ] **Step 4: Verify focused tests pass**

Run: `npx jest --runInBand tests/unit/create-map/direct-map-plan-inspector.test.tsx tests/unit/create-map/direct-map-generation.test.ts tests/unit/create-map/workbench-wiring.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/features/create-map/hooks/useMapDraft.ts src/features/create-map/hooks/useDirectMapGeneration.ts src/features/create-map/components/DirectMapPlanInspector.tsx src/features/create-map/DirectMapWorkbench.tsx tests/unit/create-map/direct-map-plan-inspector.test.tsx tests/unit/create-map/direct-map-generation.test.ts tests/unit/create-map/workbench-wiring.test.tsx && git commit -m "feat: save map plan versions explicitly"`

### Task 4: Select Historical Map Versions With Their Bound Plans

**Files:**
- Modify: `src/features/create-map/hooks/useMapGenerationHistory.ts`
- Modify: `src/features/create-map/components/MapChatPanel.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.module.css`
- Modify: `src/features/create-map/DirectMapWorkbench.tsx`
- Modify: `tests/unit/create-map/map-chat-panel.test.tsx`
- Modify: `tests/unit/create-map/workbench-wiring.test.tsx`

**Interfaces:**
- Changes `MapGenerationHistoryEntry` to `{ mapRevisionId; mapVersionNumber; planVersionNumber; isCurrent }`.
- Adds `onSelectMapVersion(mapRevisionId)` to `MapChatPanel`.
- Produces a read-only historical workbench selection from `loadMapVersionV3`.

- [ ] **Step 1: Write failing history tests**

```ts
expect(markup).toContain('MAP V1');
expect(markup).toContain('Plan V1');
expect(markup).toContain('aria-label="Open Map V1 with Plan V1"');
```

Add wiring assertions for `service.loadMapVersionV3`, `onSelectMapVersion`, and a disabled historical inspector.

- [ ] **Step 2: Verify tests fail**

Run: `npx jest --runInBand tests/unit/create-map/map-chat-panel.test.tsx tests/unit/create-map/workbench-wiring.test.tsx`

Expected: FAIL because history uses generic non-interactive revision labels.

- [ ] **Step 3: Implement read-only selection**

```tsx
<button
  type="button"
  aria-label={`Open Map V${entry.mapVersionNumber} with Plan V${entry.planVersionNumber}`}
  onClick={() => onSelectMapVersion?.(entry.mapRevisionId)}
>
  <span>{`MAP V${entry.mapVersionNumber}`}</span>
  <small>{`Plan V${entry.planVersionNumber}`}</small>
</button>
```

When selected, use the historical workspace image on the canvas and its Plan snapshot in `Map plan details`. Disable its inputs, references, collision editing, and generation controls. Leaving history selection restores the active Draft without writing any data.

- [ ] **Step 4: Verify tests pass**

Run: `npx jest --runInBand tests/unit/create-map/map-chat-panel.test.tsx tests/unit/create-map/workbench-wiring.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/features/create-map/hooks/useMapGenerationHistory.ts src/features/create-map/components/MapChatPanel.tsx src/features/create-map/CreateMapWorkbench.module.css src/features/create-map/DirectMapWorkbench.tsx tests/unit/create-map/map-chat-panel.test.tsx tests/unit/create-map/workbench-wiring.test.tsx && git commit -m "feat: browse bound map and plan versions"`

### Task 5: Verify The Complete Version Lifecycle In The Browser

**Files:**
- Modify: `tests/e2e/specs/create-map-v3.spec.ts`

**Interfaces:**
- The mock backend accepts `save_map_plan_v3` and the extended publish RPC.

- [ ] **Step 1: Write the failing lifecycle scenario**

```ts
await savePlan(page);              // Plan V1
await generateReadyMap(page);      // Map V1 -> Plan V1
await editAndSavePlan(page, 'V2'); // Plan V2, no image generation
await editAndSavePlan(page, 'V3'); // Plan V3, no image generation
await openMapHistory(page, 'MAP V1');
await expect(page.getByLabel('Map canvas').getByText('Map V1')).toBeVisible();
await expect(page.getByRole('heading', { name: 'Map plan details' }).locator('..')).toContainText('Plan V1');
```

Assert that the backend stores one ready image, three plan snapshots, and a `Map V1 -> Plan V1` binding.

- [ ] **Step 2: Verify the browser test fails**

Run: `npm run test:e2e:create-map-v3 -- --grep "keeps Map V1 bound to Plan V1"`

Expected: FAIL because saving Plans and binding Map V1 are absent.

- [ ] **Step 3: Extend the mock backend only for production RPC behavior**

Allocate a plan snapshot on `save_map_plan_v3`; do not allocate an image. Require a current matching Plan ID during publish, allocate a Map number only then, and preserve existing image polling and storage behavior.

- [ ] **Step 4: Verify the browser test passes**

Run: `npm run test:e2e:create-map-v3 -- --grep "keeps Map V1 bound to Plan V1"`

Expected: PASS.

- [ ] **Step 5: Run complete Create Map verification**

Run: `npm run test:create-map-v3 && npm run test:e2e:create-map-v3`

Expected: PASS.

- [ ] **Step 6: Commit**

Run: `git add tests/e2e/specs/create-map-v3.spec.ts && git commit -m "test: cover independent map and plan versions"`

### Task 6: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Inspect final scope**

Run: `git diff --check origin/dev-ting...HEAD && git status --short`

Expected: no whitespace errors; document-card style files remain outside feature commits.

- [ ] **Step 2: Run typecheck and all unit tests**

Run: `npm run typecheck && npm run test:unit -- --runInBand`

Expected: PASS.
