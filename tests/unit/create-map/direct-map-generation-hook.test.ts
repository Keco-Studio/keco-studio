import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { MapAssetRecord } from '@/features/create-map/services/createMapService';
import { makeEmptyMapSceneV3, makeValidMapPlanV3 } from './fixtures';

type EffectCleanup = () => void;
type EffectCallback = () => EffectCleanup | void;
type StateSlot = { kind: 'state'; value: unknown };
type RefSlot = { kind: 'ref'; value: { current: unknown } };
type MemoSlot = { kind: 'memo'; value: unknown; dependencies: readonly unknown[] };
type EffectSlot = { kind: 'effect'; cleanup?: EffectCleanup; dependencies?: readonly unknown[]; effect: EffectCallback };
type HookSlot = StateSlot | RefSlot | MemoSlot | EffectSlot;

function sameDependencies(left: readonly unknown[] | undefined, right: readonly unknown[] | undefined): boolean {
  return Boolean(left && right && left.length === right.length
    && left.every((entry, index) => Object.is(entry, right[index])));
}

class HookRuntime {
  private cursor = 0;
  private pendingEffects: EffectSlot[] = [];
  private slots: HookSlot[] = [];

  useState<T>(initialValue: T | (() => T)): [T, (value: T | ((current: T) => T)) => void] {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (previous && previous.kind !== 'state') throw new Error(`Hook order changed at slot ${index}`);
    if (!previous) {
      this.slots[index] = {
        kind: 'state',
        value: typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue,
      };
    }
    const slot = this.slots[index] as StateSlot;
    return [slot.value as T, (value) => {
      slot.value = typeof value === 'function' ? (value as (current: T) => T)(slot.value as T) : value;
    }];
  }

  useRef<T>(initialValue: T): { current: T } {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (previous && previous.kind !== 'ref') throw new Error(`Hook order changed at slot ${index}`);
    if (previous) return previous.value as { current: T };
    const value = { current: initialValue };
    this.slots[index] = { kind: 'ref', value };
    return value;
  }

  useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (previous && previous.kind !== 'memo') throw new Error(`Hook order changed at slot ${index}`);
    if (previous && sameDependencies(previous.dependencies, dependencies)) return previous.value as T;
    const value = factory();
    this.slots[index] = { kind: 'memo', value, dependencies };
    return value;
  }

  useEffect(effect: EffectCallback, dependencies?: readonly unknown[]): void {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (previous && previous.kind !== 'effect') throw new Error(`Hook order changed at slot ${index}`);
    if (previous && sameDependencies(previous.dependencies, dependencies)) return;
    const next = { kind: 'effect' as const, cleanup: previous?.cleanup, dependencies, effect };
    this.slots[index] = next;
    this.pendingEffects.push(next);
  }

  render(renderHook: () => void): void {
    this.cursor = 0;
    this.pendingEffects = [];
    renderHook();
    for (const slot of this.pendingEffects) {
      slot.cleanup?.();
      const cleanup = slot.effect();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, reject, resolve };
}

async function waitForMockCalls(mock: jest.Mock, expectedCalls: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (mock.mock.calls.length >= expectedCalls) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(mock).toHaveBeenCalledTimes(expectedCalls);
}

let runtime: HookRuntime;
let mockService: Record<string, jest.Mock>;

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('react')>('react'),
  useState: <T,>(initialValue: T | (() => T)) => runtime.useState(initialValue),
  useRef: <T,>(initialValue: T) => runtime.useRef(initialValue),
  useMemo: <T,>(factory: () => T, dependencies: readonly unknown[]) => runtime.useMemo(factory, dependencies),
  useCallback: <T,>(callback: T, dependencies: readonly unknown[]) => runtime.useMemo(() => callback, dependencies),
  useEffect: (effect: EffectCallback, dependencies?: readonly unknown[]) => runtime.useEffect(effect, dependencies),
}));
jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));
jest.mock('@/features/create-map/services/createMapService', () => ({
  createMapService: () => mockService,
}));

import {
  directMapPlanFingerprint,
  useDirectMapGeneration,
  type DirectMapGenerationAsset,
} from '@/features/create-map/hooks/useDirectMapGeneration';

type HookResult = ReturnType<typeof useDirectMapGeneration>;

function plannedRecord(generationId: string, fingerprint: string): MapAssetRecord {
  const plan = makeValidMapPlanV3();
  return {
    id: '10000000-0000-4000-8000-000000000031',
    map_revision_id: '10000000-0000-4000-8000-000000000030',
    asset_key: 'map-image', kind: 'map_image', status: 'planned',
    requested_capability: 'direct_map_image', prompt: plan.description,
    generation_params: {
      width: 512, height: 512, noBackground: false, seed: null,
      references: [], styleReference: null,
    },
    metadata: {}, storage_path: null, sha256: null, width: null, height: null,
    has_transparency: null, last_error_code: null, attempt_count: 0,
    generation_id: generationId, plan_fingerprint: fingerprint,
    provider_operation: null, provider_job_id: null,
  };
}

function setup(publishForGeneration: () => Promise<{ mapId: string; publishedRevisionId: string; saveVersion: number }>) {
  runtime = new HookRuntime();
  let generationId = '';
  let fingerprint = '';
  mockService = {
    createAssetPlanV3: jest.fn(async (_revisionId: string, nextGenerationId: string, nextFingerprint: string) => {
      generationId = nextGenerationId;
      fingerprint = nextFingerprint;
      return { asset_id: '10000000-0000-4000-8000-000000000031', status: 'planned' };
    }),
    readAssetPlan: jest.fn(async () => plannedRecord(generationId, fingerprint)),
    listAssets: jest.fn(async () => []),
    createSignedAssetUrl: jest.fn(async () => 'signed://map'),
    invokePixelLab: jest.fn(async () => ({})),
    prepareMapGeneration: jest.fn(async (input: { mapId: string; revisionId: string; saveVersion: number }) => {
      generationId = '10000000-0000-4000-8000-000000000032';
      fingerprint = await directMapPlanFingerprint(makeValidMapPlanV3());
      return {
      mapId: input.mapId,
      revisionId: input.revisionId,
      assetId: '10000000-0000-4000-8000-000000000031',
      status: 'planned',
      generationId,
      planFingerprint: fingerprint,
      saveVersion: input.saveVersion,
      confirmationToken: 'signed-confirmation',
      confirmationPurpose: 'submit',
      feeNotice: 'Paid generation consumes credits.',
      };
    }),
    startMapGeneration: jest.fn(async () => ({ status: 'generating' })),
  };
  let latest!: HookResult;
  const render = (plan = makeValidMapPlanV3(), projectId = 'project-1') => runtime.render(() => {
    latest = useDirectMapGeneration({
      projectId,
      plan,
      scene: makeEmptyMapSceneV3({ ...plan }),
      canPrepare: true,
      draftIdentity: {
        mapId: '10000000-0000-4000-8000-000000000029',
        revisionId: '10000000-0000-4000-8000-000000000030',
        revisionNumber: 1,
        saveVersion: 0,
      },
      reloadDraftAfterPreparation: async () => null,
      onSceneMaterialized: jest.fn(),
    });
  });
  return { get latest() { return latest; }, render };
}

beforeEach(() => {
  runtime = new HookRuntime();
  mockService = {};
});

describe('useDirectMapGeneration preparation guards', () => {
  it('prepares and submits exactly once through the confirmed App route', async () => {
    const publish = jest.fn(async () => ({
      mapId: '10000000-0000-4000-8000-000000000029',
      publishedRevisionId: '10000000-0000-4000-8000-000000000030',
      saveVersion: 0,
    }));
    const state = setup(publish);
    state.render();

    await state.latest.generate();

    expect(mockService.prepareMapGeneration).toHaveBeenCalledTimes(1);
    expect(mockService.startMapGeneration).toHaveBeenCalledTimes(1);
    expect(mockService.startMapGeneration).toHaveBeenCalledWith(expect.objectContaining({
      confirmationToken: 'signed-confirmation',
      confirmPaidGeneration: true,
    }));
    expect(publish).not.toHaveBeenCalled();
    expect(mockService.createAssetPlanV3).not.toHaveBeenCalled();
    expect(mockService.invokePixelLab).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'submit' }));
  });

  it('atomically prepares one asset plan when prepare is called twice concurrently', async () => {
    const publish = jest.fn(async () => ({
      mapId: '10000000-0000-4000-8000-000000000029',
      publishedRevisionId: '10000000-0000-4000-8000-000000000030',
      saveVersion: 0,
    }));
    const state = setup(publish);
    state.render();

    await Promise.all([state.latest.prepare(), state.latest.prepare()]);

    expect(mockService.prepareMapGeneration).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    expect(mockService.createAssetPlanV3).not.toHaveBeenCalled();
  });

  it('creates the immutable asset but does not install it after the Plan changes during prepare', async () => {
    const pending = deferred<Record<string, unknown>>();
    const publish = jest.fn(async () => ({
      mapId: '10000000-0000-4000-8000-000000000029',
      publishedRevisionId: '10000000-0000-4000-8000-000000000030',
      saveVersion: 0,
    }));
    const state = setup(publish);
    mockService.prepareMapGeneration.mockImplementationOnce(() => pending.promise);
    state.render();
    const preparation = state.latest.prepare();

    state.render(makeValidMapPlanV3({ description: 'A different approved opaque full-map description.' }));
    const planFingerprint = await directMapPlanFingerprint(makeValidMapPlanV3());
    pending.resolve({
      mapId: '10000000-0000-4000-8000-000000000029',
      revisionId: '10000000-0000-4000-8000-000000000030',
      assetId: '10000000-0000-4000-8000-000000000031',
      status: 'planned',
      generationId: '10000000-0000-4000-8000-000000000032',
      planFingerprint,
      saveVersion: 0,
      confirmationToken: 'signed-confirmation',
      confirmationPurpose: 'submit',
    });
    await preparation;
    state.render(makeValidMapPlanV3({ description: 'A different approved opaque full-map description.' }));

    expect(mockService.prepareMapGeneration).toHaveBeenCalledTimes(1);
    expect(state.latest.target).toBeNull();
  });

  it('does not report an old prepare failure after the Plan changes', async () => {
    const pending = deferred<Record<string, unknown>>();
    const state = setup(jest.fn(async () => ({
      mapId: '10000000-0000-4000-8000-000000000029',
      publishedRevisionId: '10000000-0000-4000-8000-000000000030',
      saveVersion: 0,
    })));
    mockService.prepareMapGeneration.mockImplementationOnce(() => pending.promise);
    state.render();
    const preparation = state.latest.prepare();

    await waitForMockCalls(mockService.prepareMapGeneration, 1);
    const changedPlan = makeValidMapPlanV3({ description: 'A replacement opaque full-map description.' });
    state.render(changedPlan);
    pending.reject(new Error('old prepare failed'));
    await preparation;
    state.render(changedPlan);

    expect(state.latest.error).toBeNull();
    expect(state.latest.target).toBeNull();
  });

  it('does not report an old submit failure after the Plan changes', async () => {
    const publish = jest.fn(async () => ({
      mapId: '10000000-0000-4000-8000-000000000029',
      publishedRevisionId: '10000000-0000-4000-8000-000000000030',
      saveVersion: 0,
    }));
    const state = setup(publish);
    const originalPlan = makeValidMapPlanV3();
    state.render(originalPlan);
    await state.latest.prepare();
    state.render(originalPlan);

    const pending = deferred<unknown>();
    mockService.startMapGeneration.mockImplementation(() => pending.promise);
    const confirmation = state.latest.confirm();
    await waitForMockCalls(mockService.startMapGeneration, 1);
    const changedPlan = makeValidMapPlanV3({ description: 'A newer opaque full-map description.' });
    state.render(changedPlan);
    pending.reject(new Error('old submit failed'));
    await confirmation;
    state.render(changedPlan);

    expect(state.latest.error).toBeNull();
  });

  it('reports a confirmation refresh failure without starting a paid attempt', async () => {
    const publish = jest.fn(async () => ({
      mapId: '10000000-0000-4000-8000-000000000029',
      publishedRevisionId: '10000000-0000-4000-8000-000000000030',
      saveVersion: 0,
    }));
    const state = setup(publish);
    const plan = makeValidMapPlanV3();
    state.render(plan);
    await state.latest.prepare();
    state.render(plan);
    mockService.startMapGeneration.mockClear();
    mockService.prepareMapGeneration.mockRejectedValueOnce(new Error('Confirmation unavailable'));

    await expect(state.latest.confirm()).resolves.toBeUndefined();
    state.render(plan);

    expect(state.latest.error).toBe('Confirmation unavailable');
    expect(mockService.startMapGeneration).not.toHaveBeenCalled();
  });

  it('starts a new revision for an unknown submission only after explicit acknowledgement', async () => {
    const publishedRevisionId = '10000000-0000-4000-8000-000000000030';
    const mapId = '10000000-0000-4000-8000-000000000029';
    const publish = jest.fn(async () => ({ mapId, publishedRevisionId, saveVersion: 0 }));
    const state = setup(publish);
    const plan = makeValidMapPlanV3();
    const planFingerprint = await directMapPlanFingerprint(plan);
    const queuedAsset: DirectMapGenerationAsset = {
      id: '10000000-0000-4000-8000-000000000031',
      status: 'queued',
      attemptCount: 0,
      lastErrorCode: null,
      providerOperation: null,
      providerJobId: null,
      generationId: '10000000-0000-4000-8000-000000000032',
      planFingerprint,
      storagePath: null,
      sha256: null,
      width: null,
      height: null,
      hasTransparency: null,
      signedUrl: null,
    };
    state.render(plan);
    state.latest.installRestore({
      target: {
        projectId: 'project-1',
        mapId,
        revisionId: publishedRevisionId,
        saveVersion: 0,
        generationId: queuedAsset.generationId,
        planFingerprint,
      },
      plan,
      generationPlan: plan,
      scene: makeEmptyMapSceneV3(),
      asset: queuedAsset,
      phase: 'blocked',
      boundImage: null,
    });
    state.render(plan);

    await state.latest.resolveUnknownAndRestart(false);
    expect(mockService.invokePixelLab).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();

    await state.latest.resolveUnknownAndRestart(true);
    expect(mockService.invokePixelLab).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'resolve_unknown',
      acknowledgeDuplicateBilling: true,
      assetId: queuedAsset.id,
    }));
    expect(publish).not.toHaveBeenCalled();
    expect(mockService.prepareMapGeneration).toHaveBeenCalledTimes(1);
  });

  it('prepares a fresh confirmation before every retry without invoking PixelLab directly', async () => {
    const mapId = '10000000-0000-4000-8000-000000000029';
    const revisionId = '10000000-0000-4000-8000-000000000030';
    const state = setup(jest.fn(async () => ({ mapId, publishedRevisionId: revisionId, saveVersion: 0 })));
    const plan = makeValidMapPlanV3();
    const planFingerprint = await directMapPlanFingerprint(plan);
    const failedAsset: DirectMapGenerationAsset = {
      id: '10000000-0000-4000-8000-000000000031',
      status: 'failed',
      attemptCount: 1,
      lastErrorCode: 'pixellab_failed',
      providerOperation: 'create_image_pro',
      providerJobId: 'job-1',
      generationId: '10000000-0000-4000-8000-000000000032',
      planFingerprint,
      storagePath: null,
      sha256: null,
      width: null,
      height: null,
      hasTransparency: null,
      signedUrl: null,
    };
    mockService.prepareMapGeneration.mockResolvedValueOnce({
      mapId,
      revisionId,
      assetId: failedAsset.id,
      status: 'failed',
      generationId: failedAsset.generationId,
      planFingerprint,
      saveVersion: 0,
      confirmationToken: 'retry-confirmation',
      confirmationPurpose: 'retry',
      feeNotice: 'Paid generation consumes credits.',
    });
    state.render(plan);
    state.latest.installRestore({
      target: {
        projectId: 'project-1', mapId, revisionId,
        saveVersion: 0,
        generationId: failedAsset.generationId, planFingerprint,
      },
      plan,
      generationPlan: plan,
      scene: makeEmptyMapSceneV3(),
      asset: failedAsset,
      phase: 'failed',
      boundImage: null,
    });
    state.render(plan);

    await state.latest.retry();

    expect(mockService.prepareMapGeneration).toHaveBeenCalledTimes(1);
    expect(mockService.startMapGeneration).toHaveBeenCalledWith(expect.objectContaining({
      confirmationToken: 'retry-confirmation',
      confirmPaidGeneration: true,
    }));
    expect(mockService.invokePixelLab).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'retry' }));
  });
});
