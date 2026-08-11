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

import { useDirectMapGeneration } from '@/features/create-map/hooks/useDirectMapGeneration';

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

function setup(publishForGeneration: () => Promise<{ mapId: string; publishedRevisionId: string }>) {
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
  };
  let latest!: HookResult;
  const render = (plan = makeValidMapPlanV3(), projectId = 'project-1') => runtime.render(() => {
    latest = useDirectMapGeneration({
      projectId,
      plan,
      scene: makeEmptyMapSceneV3({ ...plan }),
      canPrepare: true,
      publishForGeneration,
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
  it('publishes and creates one asset plan when prepare is called twice concurrently', async () => {
    const publish = jest.fn(async () => ({
      mapId: '10000000-0000-4000-8000-000000000029',
      publishedRevisionId: '10000000-0000-4000-8000-000000000030',
    }));
    const state = setup(publish);
    state.render();

    await Promise.all([state.latest.prepare(), state.latest.prepare()]);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(mockService.createAssetPlanV3).toHaveBeenCalledTimes(1);
  });

  it('creates the immutable asset but does not install it after the Plan changes during publish', async () => {
    const pending = deferred<{ mapId: string; publishedRevisionId: string }>();
    const publish = jest.fn(() => pending.promise);
    const state = setup(publish);
    state.render();
    const preparation = state.latest.prepare();

    state.render(makeValidMapPlanV3({ description: 'A different approved opaque full-map description.' }));
    pending.resolve({
      mapId: '10000000-0000-4000-8000-000000000029',
      publishedRevisionId: '10000000-0000-4000-8000-000000000030',
    });
    await preparation;
    state.render(makeValidMapPlanV3({ description: 'A different approved opaque full-map description.' }));

    expect(mockService.createAssetPlanV3).toHaveBeenCalledTimes(1);
    expect(state.latest.target).toBeNull();
  });

  it('does not report an old publish failure after the Plan changes', async () => {
    const pending = deferred<{ mapId: string; publishedRevisionId: string }>();
    const state = setup(jest.fn(() => pending.promise));
    state.render();
    const preparation = state.latest.prepare();

    const changedPlan = makeValidMapPlanV3({ description: 'A replacement opaque full-map description.' });
    state.render(changedPlan);
    pending.reject(new Error('old publish failed'));
    await preparation;
    state.render(changedPlan);

    expect(state.latest.error).toBeNull();
    expect(state.latest.target).toBeNull();
  });

  it('does not report an old submit failure after the Plan changes', async () => {
    const publish = jest.fn(async () => ({
      mapId: '10000000-0000-4000-8000-000000000029',
      publishedRevisionId: '10000000-0000-4000-8000-000000000030',
    }));
    const state = setup(publish);
    const originalPlan = makeValidMapPlanV3();
    state.render(originalPlan);
    await state.latest.prepare();
    state.render(originalPlan);

    const pending = deferred<unknown>();
    mockService.invokePixelLab.mockImplementation(() => pending.promise);
    const confirmation = state.latest.confirm();
    const changedPlan = makeValidMapPlanV3({ description: 'A newer opaque full-map description.' });
    state.render(changedPlan);
    pending.reject(new Error('old submit failed'));
    await confirmation;
    state.render(changedPlan);

    expect(state.latest.error).toBeNull();
  });
});
