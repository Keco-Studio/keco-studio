import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type EffectCleanup = () => void;
type EffectCallback = () => EffectCleanup | void;
type EffectSlot = {
  kind: 'effect';
  cleanup?: EffectCleanup;
  dependencies?: readonly unknown[];
  effect: EffectCallback;
};
type RefSlot = {
  kind: 'ref';
  value: { current: unknown };
};
type HookSlot = EffectSlot | RefSlot;

class HookRuntime {
  private cursor = 0;
  private pendingEffects: EffectSlot[] = [];
  private slots: HookSlot[] = [];

  useEffect(effect: EffectCallback, dependencies?: readonly unknown[]): void {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (previous && previous.kind !== 'effect') throw new Error(`Hook order changed at slot ${index}`);
    const previousEffect = previous as EffectSlot | undefined;
    const unchanged = previousEffect !== undefined
      && dependencies !== undefined
      && previousEffect.dependencies !== undefined
      && dependencies.length === previousEffect.dependencies.length
      && dependencies.every((dependency, dependencyIndex) =>
        Object.is(dependency, previousEffect.dependencies?.[dependencyIndex])
      );
    if (unchanged) return;

    const next: EffectSlot = {
      kind: 'effect', cleanup: previousEffect?.cleanup, dependencies, effect,
    };
    this.slots[index] = next;
    this.pendingEffects.push(next);
  }

  useRef<T>(initialValue: T): { current: T } {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (previous && previous.kind !== 'ref') throw new Error(`Hook order changed at slot ${index}`);
    const previousRef = previous as RefSlot | undefined;
    if (previousRef) return previousRef.value as { current: T };

    const value = { current: initialValue };
    this.slots[index] = { kind: 'ref', value };
    return value;
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

  unmount(): void {
    for (const slot of this.slots) {
      if (slot.kind === 'effect') {
        slot.cleanup?.();
        slot.cleanup = undefined;
      }
    }
  }
}

let mockHookRuntime: HookRuntime | null = null;

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('react')>('react'),
  useEffect: (effect: EffectCallback, dependencies?: readonly unknown[]) =>
    mockHookRuntime?.useEffect(effect, dependencies),
  useRef: <T,>(initialValue: T) => mockHookRuntime?.useRef(initialValue),
}));
jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));

import {
  generationWatchPlan,
  useMapGenerationMonitoring,
  type MapGenerationAsset,
} from '@/features/create-map/hooks/useMapGeneration';

function generationAsset(id: string, status: MapGenerationAsset['status']): MapGenerationAsset {
  return {
    assetKey: id,
    kind: 'terrain',
    prompt: id,
    requestedCapability: 'create_topdown_tileset',
    generationParams: {},
    metadata: {},
    id,
    status,
    attemptCount: 0,
    errorCode: null,
    storagePath: null,
    signedUrl: null,
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createMonitorSetup() {
  const runtime = new HookRuntime();
  const service = { invokePixelLab: jest.fn(async (_input: unknown) => undefined) };
  const refresh = jest.fn(async (_revisionId: string) => undefined);
  const setError = jest.fn();
  const submissionActive = { current: false };
  const target = { mapId: 'map-1', revisionId: 'revision-assets' };
  mockHookRuntime = runtime;

  const render = (assets: MapGenerationAsset[], nextTarget = target) => runtime.render(() => {
    useMapGenerationMonitoring({
      watch: generationWatchPlan(assets),
      target: nextTarget,
      projectId: 'project-1',
      service,
      refresh,
      setError,
      submissionActive,
    });
  });
  const polledIds = () => service.invokePixelLab.mock.calls.map(([input]) =>
    (input as { assetId: string }).assetId
  );

  return { polledIds, refresh, render, runtime, service, setError };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockHookRuntime = null;
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  mockHookRuntime = null;
});

describe('map generation monitoring lifecycle', () => {
  it('preserves cadence across clones and reads the latest generating IDs on each tick', async () => {
    const setup = createMonitorSetup();
    const assets = [
      generationAsset('generate-a', 'generating'),
      generationAsset('generate-b', 'generating'),
      generationAsset('queue-a', 'queued'),
    ];

    setup.render(assets);
    await flushAsync();
    expect(setup.polledIds()).toEqual(['generate-a', 'generate-b']);
    expect(setup.refresh).toHaveBeenCalledTimes(1);

    setup.render([...assets].reverse().map((asset) => ({ ...asset })));
    await flushAsync();
    expect(setup.polledIds()).toEqual(['generate-a', 'generate-b']);
    expect(setup.refresh).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(2499);
    expect(setup.refresh).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(setup.polledIds()).toEqual(['generate-a', 'generate-b', 'generate-b', 'generate-a']);
    expect(setup.refresh).toHaveBeenCalledTimes(2);

    setup.runtime.unmount();
  });

  it('restarts promptly when a watched status or ID changes', async () => {
    const setup = createMonitorSetup();

    setup.render([generationAsset('asset-1', 'queued')]);
    await flushAsync();
    expect(setup.polledIds()).toEqual([]);
    expect(setup.refresh).toHaveBeenCalledTimes(1);

    setup.render([generationAsset('asset-1', 'generating')]);
    await flushAsync();
    expect(setup.polledIds()).toEqual(['asset-1']);
    expect(setup.refresh).toHaveBeenCalledTimes(2);

    setup.render([generationAsset('asset-2', 'generating')]);
    await flushAsync();
    expect(setup.polledIds()).toEqual(['asset-1', 'asset-2']);
    expect(setup.refresh).toHaveBeenCalledTimes(3);

    setup.runtime.unmount();
  });

  it('invalidates an old semantic watch cycle without delaying the replacement cycle', async () => {
    const setup = createMonitorSetup();
    const oldPoll = deferred<void>();
    setup.service.invokePixelLab.mockImplementation(async ({ assetId }: { assetId: string }) =>
      assetId === 'old-asset' ? oldPoll.promise : undefined
    );

    setup.render([generationAsset('old-asset', 'generating')]);
    await flushAsync();
    expect(setup.polledIds()).toEqual(['old-asset']);
    expect(setup.refresh).not.toHaveBeenCalled();

    setup.render([generationAsset('new-asset', 'generating')]);
    await flushAsync();
    expect(setup.polledIds()).toEqual(['old-asset', 'new-asset']);
    expect(setup.refresh).toHaveBeenCalledTimes(1);

    oldPoll.resolve();
    await flushAsync();
    expect(setup.refresh).toHaveBeenCalledTimes(1);
    expect(setup.setError).not.toHaveBeenCalled();

    setup.runtime.unmount();
  });

  it('does not report an old target refresh failure after replacing the workspace target', async () => {
    const setup = createMonitorSetup();
    const oldRefresh = deferred<void>();
    setup.refresh.mockImplementation(async (revisionId: string) =>
      revisionId === 'revision-old' ? oldRefresh.promise : undefined
    );

    setup.render([generationAsset('old-asset', 'generating')], { mapId: 'map-old', revisionId: 'revision-old' });
    await flushAsync();
    expect(setup.refresh).toHaveBeenCalledWith('revision-old');

    setup.render([generationAsset('new-asset', 'generating')], { mapId: 'map-new', revisionId: 'revision-new' });
    await flushAsync();
    expect(setup.refresh).toHaveBeenCalledWith('revision-new');

    oldRefresh.reject(new Error('old target refresh failed'));
    await flushAsync();
    expect(setup.setError).not.toHaveBeenCalled();

    setup.runtime.unmount();
  });

  it('refreshes queued-only work without direct polls and clears its timer on cleanup', async () => {
    const setup = createMonitorSetup();

    setup.render([generationAsset('queue-a', 'queued')]);
    await flushAsync();
    expect(setup.service.invokePixelLab).not.toHaveBeenCalled();
    expect(setup.refresh).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(2500);
    expect(setup.service.invokePixelLab).not.toHaveBeenCalled();
    expect(setup.refresh).toHaveBeenCalledTimes(2);

    setup.runtime.unmount();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(2500);
    expect(setup.refresh).toHaveBeenCalledTimes(2);
  });
});
