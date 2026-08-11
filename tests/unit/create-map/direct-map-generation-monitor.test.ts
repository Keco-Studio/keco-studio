import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type EffectCleanup = () => void;
type EffectCallback = () => EffectCleanup | void;
type EffectSlot = { kind: 'effect'; cleanup?: EffectCleanup; dependencies?: readonly unknown[]; effect: EffectCallback };
type RefSlot = { kind: 'ref'; value: { current: unknown } };
type HookSlot = EffectSlot | RefSlot;

class HookRuntime {
  private cursor = 0;
  private pendingEffects: EffectSlot[] = [];
  private slots: HookSlot[] = [];

  useEffect(effect: EffectCallback, dependencies?: readonly unknown[]): void {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (previous && previous.kind !== 'effect') throw new Error(`Hook order changed at slot ${index}`);
    const prior = previous as EffectSlot | undefined;
    const unchanged = prior !== undefined && dependencies !== undefined && prior.dependencies !== undefined
      && dependencies.length === prior.dependencies.length
      && dependencies.every((dependency, dependencyIndex) => Object.is(dependency, prior.dependencies?.[dependencyIndex]));
    if (unchanged) return;
    const next = { kind: 'effect' as const, cleanup: prior?.cleanup, dependencies, effect };
    this.slots[index] = next;
    this.pendingEffects.push(next);
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
      if (slot.kind === 'effect') slot.cleanup?.();
    }
  }
}

let runtime: HookRuntime | null = null;

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('react')>('react'),
  useEffect: (effect: EffectCallback, dependencies?: readonly unknown[]) => runtime?.useEffect(effect, dependencies),
  useRef: <T,>(initialValue: T) => runtime?.useRef(initialValue),
}));
jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));

import {
  DIRECT_MAP_POLL_DEADLINE_MS,
  useDirectMapGenerationMonitoring,
  type DirectMapGenerationAsset,
  type DirectMapGenerationTarget,
  type DirectMapGenerationPhase,
} from '@/features/create-map/hooks/useDirectMapGeneration';

const TARGET: DirectMapGenerationTarget = {
  projectId: 'project-1', mapId: 'map-1', revisionId: 'revision-1',
  generationId: 'generation-1', planFingerprint: 'a'.repeat(64),
};

function generatingAsset(id = 'asset-1'): DirectMapGenerationAsset {
  return {
    id,
    status: 'generating',
    lastErrorCode: null,
    providerOperation: 'create_image_pro',
    providerJobId: 'job-1',
    generationId: TARGET.generationId,
    planFingerprint: TARGET.planFingerprint,
    storagePath: null,
    sha256: null,
    width: null,
    height: null,
    hasTransparency: null,
    signedUrl: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, reject, resolve };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function setup() {
  runtime = new HookRuntime();
  const calls: string[] = [];
  const service = {
    invokePixelLab: jest.fn(async (input: { operation: string }) => {
      calls.push(input.operation);
      return input.operation === 'poll' ? { status: 'completed' } : { status: 'ready' };
    }),
  };
  const refresh = jest.fn(async () => { calls.push('refresh'); });
  const setPhase = jest.fn((phase: DirectMapGenerationPhase) => { calls.push(`phase:${phase}`); });
  const setError = jest.fn();
  const render = (asset = generatingAsset(), target = TARGET) => runtime?.render(() => {
    useDirectMapGenerationMonitoring({ asset, target, service, refresh, setPhase, setError });
  });
  return { calls, refresh, render, service, setError, setPhase };
}

beforeEach(() => {
  jest.useFakeTimers();
  runtime = null;
});

afterEach(() => {
  runtime?.unmount();
  jest.clearAllTimers();
  jest.useRealTimers();
  runtime = null;
});

describe('direct map generation monitoring', () => {
  it('runs poll, validating, validate, then refresh in order', async () => {
    const state = setup();
    state.render();
    await flushAsync();

    expect(state.calls).toEqual(['poll', 'phase:validating', 'validate', 'refresh']);
  });

  it('keeps one poll timer for cloned state of the same semantic target', async () => {
    const state = setup();
    state.service.invokePixelLab.mockResolvedValue({ status: 'processing' });
    state.render();
    await flushAsync();
    expect(jest.getTimerCount()).toBe(1);

    state.render({ ...generatingAsset() }, { ...TARGET });
    await flushAsync();
    expect(state.service.invokePixelLab).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(2500);
    expect(state.service.invokePixelLab).toHaveBeenCalledTimes(2);
  });

  it('backs off repeated provider polling instead of using a fixed interval', async () => {
    const state = setup();
    state.service.invokePixelLab.mockResolvedValue({ status: 'processing' });
    state.render();
    await flushAsync();

    await jest.advanceTimersByTimeAsync(2500);
    expect(state.service.invokePixelLab).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(4999);
    expect(state.service.invokePixelLab).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(state.service.invokePixelLab).toHaveBeenCalledTimes(3);
  });

  it('stops polling at the local deadline while leaving the durable job resumable', async () => {
    const state = setup();
    state.service.invokePixelLab.mockResolvedValue({ status: 'processing' });
    state.render();
    await flushAsync();

    await jest.advanceTimersByTimeAsync(DIRECT_MAP_POLL_DEADLINE_MS + 15_000);

    expect(state.setPhase).toHaveBeenCalledWith('blocked');
    expect(state.setError).toHaveBeenCalledWith('Direct map monitoring timed out. Reload this page to resume.');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resumes polling after remount', async () => {
    const first = setup();
    first.service.invokePixelLab.mockResolvedValue({ status: 'processing' });
    first.render();
    await flushAsync();
    runtime?.unmount();

    const second = setup();
    second.service.invokePixelLab.mockResolvedValue({ status: 'processing' });
    second.render();
    await flushAsync();
    expect(second.service.invokePixelLab).toHaveBeenCalledTimes(1);
  });

  it('does not validate or report errors from a stale target', async () => {
    const state = setup();
    const oldPoll = deferred<{ status: string }>();
    state.service.invokePixelLab.mockImplementation(async (input: { operation: string; assetId?: string }) => {
      if (input.operation === 'poll' && input.assetId === 'old-asset') return oldPoll.promise;
      return { status: input.operation === 'poll' ? 'processing' : 'ready' };
    });
    state.render(generatingAsset('old-asset'), { ...TARGET, mapId: 'old-map' });
    await flushAsync();
    state.render(generatingAsset('new-asset'), { ...TARGET, mapId: 'new-map' });
    await flushAsync();

    oldPoll.resolve({ status: 'completed' });
    await flushAsync();
    expect(state.service.invokePixelLab.mock.calls.filter(([input]) =>
      (input as { operation: string }).operation === 'validate'
    )).toHaveLength(0);
    expect(state.setError).not.toHaveBeenCalled();
  });

  it('refreshes durable state after validation fails', async () => {
    const state = setup();
    state.service.invokePixelLab.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === 'poll') return { status: 'completed' };
      throw new Error('PNG validation failed');
    });
    state.render();
    await flushAsync();

    expect(state.setError).toHaveBeenCalledWith('PNG validation failed');
    expect(state.refresh).toHaveBeenCalledWith(TARGET);
  });

  it('does not duplicate an in-flight poll when callback identity changes', async () => {
    runtime = new HookRuntime();
    const pending = deferred<{ status: string }>();
    const service = { invokePixelLab: jest.fn(() => pending.promise) };
    const setPhase = jest.fn();
    const setError = jest.fn();
    const render = (refresh: () => Promise<void>) => runtime?.render(() => {
      useDirectMapGenerationMonitoring({
        asset: generatingAsset(), target: TARGET, service,
        refresh, setPhase, setError,
      });
    });

    render(jest.fn(async () => undefined));
    await flushAsync();
    render(jest.fn(async () => undefined));
    await flushAsync();
    expect(service.invokePixelLab).toHaveBeenCalledTimes(1);

    pending.resolve({ status: 'processing' });
    await flushAsync();
  });
});
