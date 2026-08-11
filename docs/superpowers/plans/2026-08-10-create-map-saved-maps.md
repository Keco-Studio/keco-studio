# Create Map Saved Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show recent accessible maps after refresh and restore a selected map's editable draft plus its latest generated PixelLab assets.

**Architecture:** The authenticated browser service returns bounded map summaries and a schema-validated workspace snapshot. Draft and generation hooks prepare restoration state without mutating the active workspace; the workbench installs the complete snapshot only after every required read finishes, while a request token rejects stale opens.

**Tech Stack:** React 19, TypeScript 5.9, TanStack Query 5, Supabase JS 2, Zod 3, Jest 30, Playwright 1.57

## Global Constraints

- Show at most 50 maps ordered by `map_projects.updated_at DESC` across all Projects visible through existing RLS.
- Do not automatically open a map after refresh.
- Restore the current Revision's Plan and Scene; restore assets from the highest Revision that owns asset rows.
- Validate persisted Plan and Scene with their strict schemas before installing state.
- Prepare the complete restore payload before replacing the active workspace.
- Disable switching while the active draft is dirty, creating, saving, or conflicted.
- Do not add deletion, renaming, search, pagination, revision history, deep links, export, schema migrations, or new RLS policies.
- Do not delete, regenerate, or overwrite retained map rows and private PNG objects.

---

## File Structure

- Modify `src/features/create-map/services/createMapService.ts`: saved-map summary and workspace snapshot queries with schema validation.
- Modify `src/features/create-map/hooks/useMapDraft.ts`: install a fully loaded draft identity and saved baseline.
- Modify `src/features/create-map/hooks/useMapGeneration.ts`: prepare and install restored generation assets and signed URLs.
- Create `src/features/create-map/hooks/useSavedMaps.ts`: bounded TanStack Query for all accessible maps.
- Create `src/features/create-map/components/SavedMapsPanel.tsx`: compact left-panel list and loading/error states.
- Modify `src/features/create-map/CreateMapWorkbench.tsx`: stale-safe open orchestration and atomic state installation.
- Modify `src/features/create-map/CreateMapWorkbench.module.css`: compact list styles using the current workbench system.
- Modify Create Map unit tests for service behavior, restore preparation, UI rendering, and wiring.

### Task 1: Saved Map Service Contracts

**Files:**
- Modify: `src/features/create-map/services/createMapService.ts:1-255`
- Modify: `tests/unit/create-map/create-map-service.test.ts`

**Interfaces:**
- Produces `SavedMapSummary`, `SavedMapWorkspace`, `listSavedMaps()`, and `loadSavedMap(mapId)`.
- `SavedMapWorkspace` contains `identity`, `plan`, `scene`, `projectId`, `sourceDocumentId`, `assetRevisionId`, and `assets`.

- [ ] **Step 1: Write failing summary-query tests**

Add a chainable Supabase mock and this behavior to `create-map-service.test.ts`:

```ts
it('lists the 50 most recently updated accessible maps with Project labels', async () => {
  const limit = jest.fn(async () => ({
    data: [{
      id: 'map-1', project_id: 'project-1', name: 'River Town',
      current_revision_id: 'revision-2', updated_at: '2026-08-10T01:00:00.000Z',
      projects: { name: 'Adventure' },
    }],
    error: null,
  }));
  const order = jest.fn(() => ({ limit }));
  const select = jest.fn(() => ({ order }));
  const from = jest.fn(() => ({ select }));

  await expect(createMapService({ from } as never).listSavedMaps()).resolves.toEqual([{
    id: 'map-1', projectId: 'project-1', projectName: 'Adventure', name: 'River Town',
    currentRevisionId: 'revision-2', updatedAt: '2026-08-10T01:00:00.000Z',
  }]);
  expect(order).toHaveBeenCalledWith('updated_at', { ascending: false });
  expect(limit).toHaveBeenCalledWith(50);
});
```

- [ ] **Step 2: Run the service test and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/create-map/create-map-service.test.ts
```

Expected: FAIL because `listSavedMaps` does not exist.

- [ ] **Step 3: Add failing workspace-load tests**

Add a test whose mock routes calls by table name. The map query returns the current Revision ID and Project ID; the current Revision returns valid fixture Plan/Scene; the asset-owner query returns the newest Revision with assets; the asset query returns one record.

```ts
it('loads the current editable Revision and assets from the newest asset-owning Revision', async () => {
  const plan = makeValidMapPlan();
  const scene = makeValidMapScene();
  const asset = makeMapAssetRecord({ id: 'asset-1', map_revision_id: 'revision-assets' });
  const from = createSavedMapLoadMock({
    map: { project_id: 'project-1', current_revision_id: 'revision-current' },
    current: {
      id: 'revision-current', revision_number: 4, save_version: 2,
      source_document_id: '11111111-1111-4111-8111-111111111111', plan, scene,
    },
    assetOwner: { id: 'revision-assets', revision_number: 3, map_assets: [{ id: asset.id }] },
    assets: [asset],
  });

  const loaded = await createMapService({ from } as never).loadSavedMap('map-1');
  expect(loaded.identity).toEqual({
    mapId: 'map-1', revisionId: 'revision-current', revisionNumber: 4, saveVersion: 2,
  });
  expect(loaded.plan).toEqual(plan);
  expect(loaded.scene).toEqual(scene);
  expect(loaded.assetRevisionId).toBe('revision-assets');
  expect(loaded.assets).toEqual([asset]);
});

it('rejects malformed persisted Plan or Scene before returning a workspace', async () => {
  const from = createSavedMapLoadMock({
    map: { project_id: 'project-1', current_revision_id: 'revision-current' },
    current: {
      id: 'revision-current', revision_number: 1, save_version: 0,
      source_document_id: '11111111-1111-4111-8111-111111111111',
      plan: { schemaVersion: 1 }, scene: makeValidMapScene(),
    },
    assetOwner: null,
    assets: [],
  });

  await expect(createMapService({ from } as never).loadSavedMap('map-1'))
    .rejects.toMatchObject({ code: 'invalid_saved_map' });
});
```

Define `makeMapAssetRecord` and `createSavedMapLoadMock` in the test with complete record fields matching `MapAssetRecord`; do not mock schema validators.

```ts
function makeMapAssetRecord(overrides: Partial<MapAssetRecord> = {}): MapAssetRecord {
  return {
    id: 'asset-1', map_revision_id: 'revision-assets', asset_key: 'meadow-grass', kind: 'terrain',
    status: 'ready', requested_capability: 'create_topdown_tileset', prompt: 'Saved terrain',
    generation_params: {}, metadata: {}, storage_path: null, sha256: null, width: 128, height: 128,
    has_transparency: false, last_error_code: null, attempt_count: 1, ...overrides,
  };
}

function createSavedMapLoadMock(input: {
  map: Record<string, unknown>;
  current: Record<string, unknown>;
  assetOwner: Record<string, unknown> | null;
  assets: MapAssetRecord[];
}) {
  let revisionQuery = 0;
  return jest.fn((table: string) => {
    if (table === 'map_projects') {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: input.map, error: null }) }) }) };
    }
    if (table === 'map_revisions' && revisionQuery++ === 0) {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: input.current, error: null }) }) }) };
    }
    if (table === 'map_revisions') {
      return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({
        maybeSingle: async () => ({ data: input.assetOwner, error: null }),
      }) }) }) }) };
    }
    if (table === 'map_assets') {
      return { select: () => ({ eq: () => ({ order: async () => ({ data: input.assets, error: null }) }) }) };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
}
```

- [ ] **Step 4: Implement summary and workspace reads**

In `createMapService.ts`, import `MapPlanSchema` and `MapSceneSchema`, then add:

```ts
export type SavedMapSummary = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  currentRevisionId: string;
  updatedAt: string;
};

export type SavedMapWorkspace = {
  identity: MapDraftIdentity;
  plan: MapPlan;
  scene: MapScene;
  projectId: string;
  sourceDocumentId: string;
  assetRevisionId: string | null;
  assets: MapAssetRecord[];
};

function projectName(value: unknown): string {
  const relation = Array.isArray(value) ? value[0] : value;
  return relation && typeof relation === 'object' && typeof (relation as { name?: unknown }).name === 'string'
    ? (relation as { name: string }).name
    : 'Unknown project';
}
```

Add methods to the returned service:

```ts
async listSavedMaps(): Promise<SavedMapSummary[]> {
  const { data, error } = await supabase
    .from('map_projects')
    .select('id, project_id, name, current_revision_id, updated_at, projects!map_projects_project_id_fkey(name)')
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) throw new CreateMapServiceError(error.code ?? 'map_list_failed', error.message);
  return (data ?? []).flatMap((row) => {
    if (!row.current_revision_id) return [];
    return [{
      id: String(row.id), projectId: String(row.project_id), projectName: projectName(row.projects),
      name: String(row.name), currentRevisionId: String(row.current_revision_id),
      updatedAt: String(row.updated_at),
    }];
  });
},

async loadSavedMap(mapId: string): Promise<SavedMapWorkspace> {
  const { data: map, error: mapError } = await supabase
    .from('map_projects').select('project_id, current_revision_id').eq('id', mapId).single();
  if (mapError || !map?.current_revision_id) {
    throw new CreateMapServiceError(mapError?.code ?? 'map_load_failed', mapError?.message ?? 'Map has no current revision');
  }
  const { data: revision, error: revisionError } = await supabase
    .from('map_revisions')
    .select('id, revision_number, save_version, source_document_id, plan, scene')
    .eq('id', map.current_revision_id).single();
  if (revisionError || !revision) {
    throw new CreateMapServiceError(revisionError?.code ?? 'map_load_failed', revisionError?.message);
  }
  const parsedPlan = MapPlanSchema.safeParse(revision.plan);
  const parsedScene = MapSceneSchema.safeParse(revision.scene);
  if (!parsedPlan.success || !parsedScene.success) {
    throw new CreateMapServiceError('invalid_saved_map', 'Saved map Plan or Scene is invalid');
  }
  const { data: assetOwner, error: ownerError } = await supabase
    .from('map_revisions')
    .select('id, revision_number, map_assets!inner(id)')
    .eq('map_project_id', mapId)
    .order('revision_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ownerError) throw new CreateMapServiceError(ownerError.code ?? 'asset_load_failed', ownerError.message);
  const assetRevisionId = assetOwner?.id ? String(assetOwner.id) : null;
  const assets = assetRevisionId ? await listMapAssets(supabase, assetRevisionId) : [];
  return {
    identity: {
      mapId, revisionId: String(revision.id), revisionNumber: Number(revision.revision_number),
      saveVersion: Number(revision.save_version),
    },
    plan: parsedPlan.data, scene: parsedScene.data, projectId: String(map.project_id),
    sourceDocumentId: String(revision.source_document_id), assetRevisionId, assets,
  };
},
```

Extract the existing asset query to a local `listMapAssets(supabase, revisionId)` helper and call it from both `loadSavedMap` and the public `listAssets` method.

```ts
async function listMapAssets(supabase: SupabaseClient, revisionId: string): Promise<MapAssetRecord[]> {
  const { data, error } = await supabase.from('map_assets')
    .select('*').eq('map_revision_id', revisionId).order('asset_key');
  if (error) throw new CreateMapServiceError(error.code ?? 'asset_load_failed', error.message);
  return (data ?? []) as unknown as MapAssetRecord[];
}
```

- [ ] **Step 5: Run service tests and typecheck**

```bash
npx jest --runInBand tests/unit/create-map/create-map-service.test.ts
npm run typecheck
```

Expected: service suite passes and typecheck exits 0.

- [ ] **Step 6: Commit service contracts**

```bash
git add src/features/create-map/services/createMapService.ts tests/unit/create-map/create-map-service.test.ts
git commit -m "feat: load persisted create maps"
```

### Task 2: Draft And Generation Restore Preparation

**Files:**
- Modify: `src/features/create-map/hooks/useMapDraft.ts`
- Modify: `src/features/create-map/hooks/useMapGeneration.ts`
- Create: `tests/unit/create-map/map-generation-restore.test.ts`
- Modify: `tests/unit/create-map/workbench-wiring.test.tsx`

**Interfaces:**
- Produces `draft.install(workspace)`, `prepareGenerationRestore(input, createSignedUrl)`, and `generation.installRestore(prepared)`.
- `PreparedGenerationRestore` contains `target`, `assets`, and `phase` and performs no React state mutation.

- [ ] **Step 1: Write failing generation-restore tests**

Create `map-generation-restore.test.ts`:

```ts
import { describe, expect, it, jest } from '@jest/globals';
import { prepareGenerationRestore } from '@/features/create-map/hooks/useMapGeneration';
import { buildMapAssetPlans } from '@/features/create-map/model/mapAssetPlan';
import { makeValidMapPlan } from './fixtures';

it('matches persisted assets to Plan rows and refreshes ready signed URLs', async () => {
  const plan = makeValidMapPlan();
  const row = buildMapAssetPlans(plan)[0];
  const record = assetRecordFor(row, { id: 'asset-1', status: 'ready', storage_path: 'private/asset.png' });
  const sign = jest.fn(async () => 'signed://asset-1');

  const restored = await prepareGenerationRestore({
    mapId: 'map-1', revisionId: 'revision-assets', plan, records: [record],
  }, sign);

  expect(restored.target).toEqual({ mapId: 'map-1', revisionId: 'revision-assets' });
  expect(restored.assets.find((asset) => asset.assetKey === row.assetKey)).toMatchObject({
    id: 'asset-1', status: 'ready', signedUrl: 'signed://asset-1',
  });
  expect(sign).toHaveBeenCalledWith('private/asset.png');
});

it('restores no-asset maps to idle unplanned resources', async () => {
  const restored = await prepareGenerationRestore({
    mapId: 'map-1', revisionId: null, plan: makeValidMapPlan(), records: [],
  }, jest.fn());
  expect(restored.target).toBeNull();
  expect(restored.phase).toBe('idle');
  expect(restored.assets.every((asset) => asset.status === 'unplanned')).toBe(true);
});

it('keeps one unavailable signed URL local without failing the restore', async () => {
  const plan = makeValidMapPlan();
  const row = buildMapAssetPlans(plan)[0];
  const record = assetRecordFor(row, { status: 'ready', storage_path: 'private/missing.png' });
  const restored = await prepareGenerationRestore(
    { mapId: 'map-1', revisionId: 'revision-assets', plan, records: [record] },
    async () => { throw new Error('sign failed'); }
  );
  expect(restored.assets.find((asset) => asset.assetKey === row.assetKey)?.signedUrl).toBeNull();
});

it('opens an edited current Plan with incompatible old assets as unplanned', async () => {
  const plan = makeValidMapPlan();
  const row = buildMapAssetPlans(plan)[0];
  const stale = assetRecordFor(row, { prompt: `${row.prompt} stale` });
  const restored = await prepareGenerationRestore(
    { mapId: 'map-1', revisionId: 'revision-assets', plan, records: [stale] },
    jest.fn()
  );
  expect(restored.target).toBeNull();
  expect(restored.phase).toBe('idle');
  expect(restored.assets.every((asset) => asset.status === 'unplanned')).toBe(true);
});
```

Define `assetRecordFor` with every `MapAssetRecord` field and values copied from its `MapAssetPlanRow` so the production read-back validation is exercised:

```ts
function assetRecordFor(
  row: MapAssetPlanRow,
  overrides: Partial<MapAssetRecord> = {}
): MapAssetRecord {
  return {
    id: 'asset-1', map_revision_id: 'revision-assets', asset_key: row.assetKey, kind: row.kind,
    status: 'planned', requested_capability: row.requestedCapability, prompt: row.prompt,
    generation_params: row.generationParams, metadata: row.metadata, storage_path: null, sha256: null,
    width: null, height: null, has_transparency: null, last_error_code: null, attempt_count: 0,
    ...overrides,
  };
}
```

- [ ] **Step 2: Run restore tests and verify RED**

```bash
npx jest --runInBand tests/unit/create-map/map-generation-restore.test.ts
```

Expected: FAIL because `prepareGenerationRestore` is not exported.

- [ ] **Step 3: Implement preparation and installation**

In `useMapGeneration.ts`, export:

```ts
export type PreparedGenerationRestore = {
  target: PublishedTarget | null;
  assets: MapGenerationAsset[];
  phase: MapGenerationPhase;
};

export async function prepareGenerationRestore(
  input: { mapId: string; revisionId: string | null; plan: MapPlan; records: MapAssetRecord[] },
  createSignedUrl: (storagePath: string) => Promise<string>
): Promise<PreparedGenerationRestore> {
  const rows = buildMapAssetPlans(input.plan);
  if (!input.revisionId || input.records.length === 0) {
    return { target: null, assets: rows.map(previewAsset), phase: 'idle' };
  }
  const byKey = new Map(input.records.map((record) => [record.asset_key, record]));
  let restoredRows: MapGenerationAsset[];
  try {
    restoredRows = rows.map((row) => {
      const record = byKey.get(row.assetKey);
      if (!record) throw new Error(`Missing persisted asset: ${row.assetKey}`);
      return verifiedAsset(row, record);
    });
  } catch {
    return { target: null, assets: rows.map(previewAsset), phase: 'idle' };
  }
  const assets = await Promise.all(restoredRows.map(async (restored) => {
    const record = byKey.get(restored.assetKey) as MapAssetRecord;
    if (record.status !== 'ready' || !record.storage_path) return restored;
    try {
      return { ...restored, signedUrl: await createSignedUrl(record.storage_path) };
    } catch {
      return restored;
    }
  }));
  return {
    target: { mapId: input.mapId, revisionId: input.revisionId },
    assets,
    phase: phaseFor(assets),
  };
}
```

Inside `useMapGeneration`, add:

```ts
const prepareRestore = useCallback(
  (input: Parameters<typeof prepareGenerationRestore>[0]) =>
    prepareGenerationRestore(input, service.createSignedAssetUrl),
  [service]
);
const installRestore = useCallback((prepared: PreparedGenerationRestore) => {
  setTarget(prepared.target);
  setAssets(prepared.assets);
  setPhase(prepared.phase);
  setError(null);
}, []);
```

Return both callbacks.

In `useMapDraft.ts`, add an `install` callback that first updates `lastSaved.current`, then identity/status/error:

```ts
const install = useCallback((loaded: { identity: MapDraftIdentity; plan: MapPlan; scene: MapScene }) => {
  lastSaved.current = JSON.stringify({ plan: loaded.plan, scene: loaded.scene });
  setIdentity(loaded.identity);
  setStatus('saved');
  setError(null);
}, []);
```

Return `install`. Extend `workbench-wiring.test.tsx` to require `draft.install(loaded)` and `generation.installRestore(prepared)` before implementation, and update existing `useMapDraft` mocks with `isDirty`, `install`, and `publishForGeneration`.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
npx jest --runInBand tests/unit/create-map/map-generation-restore.test.ts tests/unit/create-map/workbench-wiring.test.tsx
npm run typecheck
```

Expected: both suites pass and typecheck exits 0.

- [ ] **Step 5: Commit restore primitives**

```bash
git add src/features/create-map/hooks/useMapDraft.ts src/features/create-map/hooks/useMapGeneration.ts tests/unit/create-map/map-generation-restore.test.ts tests/unit/create-map/workbench-wiring.test.tsx
git commit -m "feat: restore create map editor state"
```

### Task 3: Saved Maps List And Atomic Open Orchestration

**Files:**
- Create: `src/features/create-map/hooks/useSavedMaps.ts`
- Create: `src/features/create-map/components/SavedMapsPanel.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.module.css`
- Create: `tests/unit/create-map/saved-maps-panel.test.tsx`
- Modify: `tests/unit/create-map/workbench-wiring.test.tsx`
- Modify: `tests/unit/create-map/create-map-shell.test.ts`

**Interfaces:**
- `useSavedMaps()` returns `{ maps, isLoading, error, refetch }`.
- `SavedMapsPanel` consumes maps and open state; it does not query or mutate data itself.
- `openSavedMap(summary)` prepares all async data before one React installation phase.

- [ ] **Step 1: Write failing panel rendering tests**

Create `saved-maps-panel.test.tsx` using `renderToStaticMarkup`:

```ts
import React from 'react';
import { describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { SavedMapsPanel } from '@/features/create-map/components/SavedMapsPanel';
import type { SavedMapSummary } from '@/features/create-map/services/createMapService';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

const summary: SavedMapSummary = {
  id: 'map-1', projectId: 'project-1', projectName: 'Adventure', name: 'River Town',
  currentRevisionId: 'revision-2', updatedAt: '2026-08-10T01:00:00.000Z',
};

it('renders map name, Project context, time, and selected state', () => {
  const markup = renderToStaticMarkup(<SavedMapsPanel
    maps={[summary]}
    isLoading={false}
    error={null}
    activeMapId="map-1"
    openingMapId={null}
    disabled={false}
    onOpen={() => undefined}
    onRetry={() => undefined}
  />);
  expect(markup).toContain('Saved Maps');
  expect(markup).toContain('River Town');
  expect(markup).toContain('Adventure');
  expect(markup).toContain('aria-current="true"');
});

it('disables map rows while the current draft cannot switch', () => {
  const markup = renderToStaticMarkup(<SavedMapsPanel maps={[summary]} isLoading={false}
    error={null} activeMapId={null} openingMapId={null} disabled onOpen={() => undefined}
    onRetry={() => undefined} />);
  expect(markup).toContain('disabled=""');
});
```

- [ ] **Step 2: Run panel test and verify RED**

```bash
npx jest --runInBand tests/unit/create-map/saved-maps-panel.test.tsx
```

Expected: FAIL because `SavedMapsPanel` does not exist.

- [ ] **Step 3: Implement query hook and panel**

Create `useSavedMaps.ts`:

```ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { createMapService } from '../services/createMapService';

export function useSavedMaps() {
  const supabase = useSupabase();
  const { userProfile } = useAuth();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const query = useQuery({
    queryKey: ['create-map', 'saved-maps', userProfile?.id],
    queryFn: () => service.listSavedMaps(),
    enabled: Boolean(userProfile?.id),
    staleTime: 30_000,
  });
  return { maps: query.data ?? [], isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}
```

Add this mock to both `workbench-wiring.test.tsx` and `create-map-shell.test.ts` before rendering `CreateMapWorkbench`:

```ts
jest.mock('@/features/create-map/hooks/useSavedMaps', () => ({
  useSavedMaps: () => ({
    maps: [], isLoading: false, error: null, refetch: jest.fn(),
  }),
}));
```

Extend both files' existing `useMapDraft` mocks with `isDirty: false`, `install: jest.fn()`, and `publishForGeneration: jest.fn()`. This keeps the server-rendered workbench contract complete after the new switching guard and install path are added.

Create `SavedMapsPanel.tsx` as a semantic section with one button per map:

```tsx
import { ReloadOutlined } from '@ant-design/icons';
import type { SavedMapSummary } from '../services/createMapService';
import styles from '../CreateMapWorkbench.module.css';

type Props = {
  maps: SavedMapSummary[];
  isLoading: boolean;
  error: string | null;
  activeMapId: string | null;
  openingMapId: string | null;
  disabled: boolean;
  onOpen: (map: SavedMapSummary) => void;
  onRetry: () => void;
};

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function SavedMapsPanel(props: Props) {
  return (
    <section className={styles.panelSection} aria-labelledby="saved-maps-heading">
      <div className={styles.sectionHeadingRow}>
        <h2 id="saved-maps-heading" className={styles.sectionTitleSmall}>Saved Maps</h2>
        <span className={styles.itemMeta}>{props.maps.length}</span>
      </div>
      {props.isLoading ? <p className={styles.savedMapsState}>Loading maps...</p> : null}
      {props.error ? <div className={styles.savedMapsState} role="alert">
        <span>{props.error}</span>
        <button type="button" className={styles.miniIconButton} aria-label="Retry saved maps" onClick={props.onRetry}><ReloadOutlined /></button>
      </div> : null}
      {!props.isLoading && !props.error && props.maps.length === 0
        ? <p className={styles.savedMapsState}>No saved maps</p>
        : null}
      {props.maps.length > 0 ? <ul className={styles.savedMapsList}>
        {props.maps.map((map) => {
          const active = map.id === props.activeMapId;
          const opening = map.id === props.openingMapId;
          return <li key={map.id}>
            <button type="button" className={active ? styles.savedMapButtonActive : styles.savedMapButton}
              aria-current={active || undefined} disabled={props.disabled || opening}
              onClick={() => props.onOpen(map)}>
              <span className={styles.savedMapCopy}><strong>{map.name}</strong><small>{map.projectName}</small></span>
              <span className={styles.savedMapMeta}>{opening ? 'Opening...' : dateTime.format(new Date(map.updatedAt))}</span>
            </button>
          </li>;
        })}
      </ul> : null}
    </section>
  );
}
```

- [ ] **Step 4: Add failing workbench orchestration assertions**

Extend `workbench-wiring.test.tsx` source assertions:

```ts
expect(workbench).toContain('useSavedMaps()');
expect(workbench).toContain('openRequestRef.current');
expect(workbench).toContain('setGeneratedImages(new Map())');
expect(workbench).toContain('key={draft.identity?.mapId ?? \'local-preview\'}');

const openStart = workbench.indexOf('const openSavedMap');
const openEnd = workbench.indexOf('\n  return (', openStart);
const openSavedMap = workbench.slice(openStart, openEnd);
const loadIndex = openSavedMap.indexOf('await service.loadSavedMap(summary.id)');
const prepareIndex = openSavedMap.indexOf('await generation.prepareRestore(');
const staleGuardIndex = openSavedMap.indexOf('if (request !== openRequestRef.current) return;');

expect(loadIndex).toBeGreaterThan(-1);
expect(prepareIndex).toBeGreaterThan(loadIndex);
expect(staleGuardIndex).toBeGreaterThan(prepareIndex);
for (const installation of [
  'setProjectId(loaded.projectId)',
  'setDocumentId(loaded.sourceDocumentId)',
  'setPlan(loaded.plan)',
  'setEditor(createEditorState(loaded.scene))',
  'draft.install(loaded)',
  'generation.installRestore(prepared)',
]) {
  expect(openSavedMap.indexOf(installation)).toBeGreaterThan(staleGuardIndex);
}
```

Expected before implementation: assertions fail against `CreateMapWorkbench.tsx`.

- [ ] **Step 5: Implement stale-safe open orchestration**

In `CreateMapWorkbench.tsx`, extend the React import with `useRef` and add:

```ts
import { SavedMapsPanel } from './components/SavedMapsPanel';
import { useSavedMaps } from './hooks/useSavedMaps';
import type { SavedMapSummary } from './services/createMapService';
```

Add the orchestration state and callback:

```ts
const savedMaps = useSavedMaps();
const openRequestRef = useRef(0);
const [openingMapId, setOpeningMapId] = useState<string | null>(null);
const [openMapError, setOpenMapError] = useState<string | null>(null);
const canSwitchMaps = !draft.isDirty && !['creating', 'saving', 'conflict'].includes(draft.status);

const openSavedMap = async (summary: SavedMapSummary) => {
  if (!canSwitchMaps || summary.id === draft.identity?.mapId) return;
  const request = ++openRequestRef.current;
  setOpeningMapId(summary.id);
  setOpenMapError(null);
  try {
    const loaded = await service.loadSavedMap(summary.id);
    const prepared = await generation.prepareRestore({
      mapId: loaded.identity.mapId,
      revisionId: loaded.assetRevisionId,
      plan: loaded.plan,
      records: loaded.assets,
    });
    if (request !== openRequestRef.current) return;
    setProjectId(loaded.projectId);
    setDocumentId(loaded.sourceDocumentId);
    setPlan(loaded.plan);
    setEditor(createEditorState(loaded.scene));
    setSelection(null);
    setTool('select');
    setContentTab('layers');
    setViewport({
      zoom: loaded.scene.canvas.zoom,
      panX: loaded.scene.canvas.panX,
      panY: loaded.scene.canvas.panY,
    });
    setSnapToGrid(loaded.scene.canvas.snapToGrid);
    setMaskReady(false);
    setGeneratedImages(new Map());
    draft.install(loaded);
    generation.installRestore(prepared);
  } catch (cause) {
    if (request === openRequestRef.current) {
      setOpenMapError(cause instanceof Error ? cause.message : 'Could not open saved map');
    }
  } finally {
    if (request === openRequestRef.current) setOpeningMapId(null);
  }
};
```

Render this directly after `MapSourcePanel` and before `MapStages`:

```tsx
<SavedMapsPanel
  maps={savedMaps.maps}
  isLoading={savedMaps.isLoading}
  error={openMapError ?? (savedMaps.error instanceof Error ? savedMaps.error.message : null)}
  activeMapId={draft.identity?.mapId ?? null}
  openingMapId={openingMapId}
  disabled={!canSwitchMaps}
  onOpen={(summary) => void openSavedMap(summary)}
  onRetry={() => void savedMaps.refetch()}
/>
```

Add `key={draft.identity?.mapId ?? 'local-preview'}` to `MapCanvas` so incomplete transient gestures cannot cross maps. In `createPlan`, immediately after `await draft.create(projectId, created.sourceToken, created.plan, scene)`, call `void savedMaps.refetch()` so the new map appears.

The state setters occur only after both `loadSavedMap` and `prepareRestore` finish. Do not move any setter above those awaits.

- [ ] **Step 6: Add restrained list styles**

Add restrained list styles:

```css
.savedMapsList {
  display: grid;
  gap: 3px;
  max-height: 260px;
  margin: 10px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.savedMapButton,
.savedMapButtonActive {
  display: grid;
  width: 100%;
  min-height: 46px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 5px 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #364049;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.savedMapButton:hover:not(:disabled) { background: #f3f6f8; }
.savedMapButtonActive { border-color: #b8d8f0; background: #edf6fc; }
.savedMapButton:disabled,
.savedMapButtonActive:disabled { opacity: 0.55; cursor: not-allowed; }

.savedMapCopy { display: grid; min-width: 0; gap: 1px; }
.savedMapCopy strong,
.savedMapCopy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.savedMapCopy strong { font-size: 11px; }
.savedMapCopy small,
.savedMapMeta { color: #7b8790; font-size: 9px; }
.savedMapMeta { white-space: nowrap; }
.savedMapsState { display: flex; min-height: 42px; align-items: center; justify-content: space-between; gap: 8px; margin: 8px 0 0; color: #7b8790; font-size: 10px; }
```

- [ ] **Step 7: Run UI tests, all Create Map tests, and typecheck**

```bash
npx jest --runInBand tests/unit/create-map/saved-maps-panel.test.tsx tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/create-map-shell.test.ts
npx jest --runInBand tests/unit/create-map
npm run typecheck
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit the list and orchestration**

```bash
git add src/features/create-map/hooks/useSavedMaps.ts src/features/create-map/components/SavedMapsPanel.tsx src/features/create-map/CreateMapWorkbench.tsx src/features/create-map/CreateMapWorkbench.module.css tests/unit/create-map/saved-maps-panel.test.tsx tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/create-map-shell.test.ts
git commit -m "feat: reopen saved create maps"
```

### Task 4: RLS And Real-Data Browser Regression

**Files:**
- Modify: `tests/unit/database/create-map-workbench.rls.behavior.test.ts`
- Retain: all existing map rows, revisions, assets, documents, and private storage objects.

**Interfaces:**
- Verifies existing RLS exposes summaries to owners/collaborators and rejects outsiders.
- Verifies the UI restores the retained current draft and generated asset Revision after refresh.

- [ ] **Step 1: Add an RLS read test for list and open query shapes**

Extend the existing behavior fixture after it creates a map:

```ts
const ownerList = await fx.owner.client.from('map_projects')
  .select('id, project_id, name, current_revision_id, updated_at, projects!map_projects_project_id_fkey(name)')
  .eq('id', map.map_id);
expect(ownerList.error).toBeNull();
expect(ownerList.data).toHaveLength(1);

const collaboratorOpen = await fx.viewer.client.from('map_revisions')
  .select('id, revision_number, save_version, source_document_id, plan, scene')
  .eq('id', map.draft_revision_id).single();
expect(collaboratorOpen.error).toBeNull();

const outsiderList = await fx.outsider.client.from('map_projects').select('id').eq('id', map.map_id);
expect(outsiderList.data).toEqual([]);
```

- [ ] **Step 2: Run database behavior and full unit suites**

```bash
npx jest --runInBand tests/unit/database/create-map-workbench.rls.behavior.test.ts
npx jest --runInBand tests/unit/create-map
npm run typecheck
```

Expected: all suites pass. The behavior fixture may clean only the records it creates; retained real maps remain untouched.

- [ ] **Step 3: Verify Saved Maps at localhost 3000**

Use an authenticated Playwright browser against `http://localhost:3000/create-map`:

1. Confirm the initial canvas remains `Local preview` and no saved map is auto-opened.
2. Confirm Saved Maps contains maps from every accessible Project and each row includes a Project name.
3. Click retained map `208ea37b-288b-46f1-9e85-467fb816303a` or another retained ready map visible to the test user.
4. Confirm the header changes to the saved map name, source Project/Document values restore, and editable objects/obstacles match the loaded Scene.
5. Confirm PixelLab resources restore to their persisted statuses and ready PNGs produce non-fallback canvas pixels.
6. Refresh `/create-map`, confirm no map auto-opens, then click the same map and confirm it restores again.
7. Start a local edit, observe rows disabled during `Saving...`, and confirm switching becomes available after `All changes saved`.
8. Confirm no new PixelLab submit request occurs during either open.

- [ ] **Step 4: Capture retained evidence**

Save:

```text
test-results/create-map-saved-map-restored.png
```

The screenshot must show the Saved Maps list, selected map, restored map name, and restored resource statuses. Do not delete earlier screenshots.

- [ ] **Step 5: Final verification**

```bash
npx jest --runInBand tests/unit/create-map tests/unit/database/create-map-workbench.rls.behavior.test.ts
npm run typecheck
git diff --check
git status --short
```

Expected: tests and typecheck pass, whitespace check is clean, and status contains no unrelated staged files.

- [ ] **Step 6: Commit RLS regression coverage**

```bash
git add tests/unit/database/create-map-workbench.rls.behavior.test.ts
git commit -m "test: cover saved map reopening access"
```
