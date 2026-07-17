import { describe, expect, it, jest, beforeEach } from '@jest/globals';

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
    if (previous && previous.kind !== 'effect') {
      throw new Error(`Hook order changed at slot ${index}`);
    }
    const previousEffect = previous as EffectSlot | undefined;

    const unchanged =
      previousEffect !== undefined &&
      dependencies !== undefined &&
      previousEffect.dependencies !== undefined &&
      dependencies.length === previousEffect.dependencies.length &&
      dependencies.every((dependency, dependencyIndex) =>
        Object.is(dependency, previousEffect.dependencies?.[dependencyIndex])
      );
    if (unchanged) return;

    const next: EffectSlot = {
      kind: 'effect',
      cleanup: previousEffect?.cleanup,
      dependencies,
      effect,
    };
    this.slots[index] = next;
    this.pendingEffects.push(next);
  }

  useRef<T>(initialValue: T): { current: T } {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (previous && previous.kind !== 'ref') {
      throw new Error(`Hook order changed at slot ${index}`);
    }
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
const mockDocumentChannelCleanups = new Map<string, jest.Mock>();
const mockRegisterProjectDocumentChannel = jest.fn(
  (projectId: string, _channel: unknown) => {
    const cleanup = jest.fn();
    mockDocumentChannelCleanups.set(projectId, cleanup);
    return cleanup;
  }
);

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('react')>('react'),
  useEffect: (effect: EffectCallback, dependencies?: readonly unknown[]) =>
    mockHookRuntime?.useEffect(effect, dependencies),
  useRef: <T,>(initialValue: T) => mockHookRuntime?.useRef(initialValue),
}));
jest.mock('@/lib/documents/projectDocumentChannel', () => ({
  notifyProjectDocumentUpdate: jest.fn(),
  registerProjectDocumentChannel: (
    projectId: string,
    channel: unknown
  ) => mockRegisterProjectDocumentChannel(projectId, channel),
}));

import { queryKeys } from '@/lib/utils/queryKeys';
import {
  invalidateSidebarLibraryChange,
  useSidebarRealtime,
  type UseSidebarRealtimeParams,
} from './useSidebarRealtime';

type Binding = {
  event: string;
  config: Record<string, unknown>;
  callback: (payload: Record<string, unknown>) => unknown;
};
type SubscribeCallback = (status: string, error?: Error) => void;
type FakeChannel = {
  topic: string;
  options?: Record<string, unknown>;
  bindings: Binding[];
  subscribeCallbacks: SubscribeCallback[];
  on: (
    event: string,
    config: Record<string, unknown>,
    callback: Binding['callback']
  ) => FakeChannel;
  subscribe: (callback: SubscribeCallback) => FakeChannel;
};

function createSupabaseFake() {
  const channels: FakeChannel[] = [];
  const removeChannel = jest.fn();
  const supabase = {
    channel: (topic: string, options?: Record<string, unknown>) => {
      const channel: FakeChannel = {
        topic,
        options,
        bindings: [],
        subscribeCallbacks: [],
        on(event, config, callback) {
          channel.bindings.push({ event, config, callback });
          return channel;
        },
        subscribe(callback) {
          channel.subscribeCallbacks.push(callback);
          return channel;
        },
      };
      channels.push(channel);
      return channel;
    },
    removeChannel,
  };

  return { channels, removeChannel, supabase };
}

function createHookSetup() {
  const realtime = createSupabaseFake();
  const router = { push: jest.fn() };
  const queryClient = {
    getQueryData: jest.fn(() => [{ id: 'p1' }, { id: 'p2' }]),
    invalidateQueries: jest.fn(async () => undefined),
    refetchQueries: jest.fn(async () => undefined),
    setQueryData: jest.fn(),
  };
  const runtime = new HookRuntime();
  mockHookRuntime = runtime;

  const render = (currentProjectId: string | null) => {
    runtime.render(() => {
      useSidebarRealtime({
        supabase: realtime.supabase,
        queryClient,
        userId: 'user-1',
        currentProjectId,
        router,
      } as unknown as UseSidebarRealtimeParams);
    });
  };

  return { ...realtime, queryClient, render, router, runtime };
}

function channelWithTopic(channels: FakeChannel[], topic: string): FakeChannel {
  const channel = channels.find((candidate) => candidate.topic === topic);
  if (!channel) throw new Error(`Missing channel ${topic}`);
  return channel;
}

beforeEach(() => {
  mockHookRuntime = null;
  mockDocumentChannelCleanups.clear();
  mockRegisterProjectDocumentChannel.mockClear();
});

describe('sidebar realtime hook lifecycle', () => {
  it('registers exactly three explicit project table bindings', () => {
    const { channels, render } = createHookSetup();

    render('p1');

    const projectChannel = channelWithTopic(channels, 'folders:project:p1');
    const projectBindings = projectChannel.bindings.filter(
      ({ event }) => event === 'postgres_changes'
    );
    expect(projectBindings.map(({ config }) => config)).toEqual([
      {
        event: '*',
        schema: 'public',
        table: 'libraries',
        filter: 'project_id=eq.p1',
      },
      {
        event: '*',
        schema: 'public',
        table: 'folders',
        filter: 'project_id=eq.p1',
      },
      {
        event: '*',
        schema: 'public',
        table: 'predefine_properties',
      },
    ]);
    expect(projectBindings.every(({ config }) => 'table' in config)).toBe(true);
  });

  it('keeps the projects user channel across project changes', () => {
    const { channels, removeChannel, render, runtime } = createHookSetup();
    render('p1');
    const projectsUserChannel = channelWithTopic(
      channels,
      'projects:user:user-1'
    );
    const projectP1Channel = channelWithTopic(channels, 'folders:project:p1');
    projectP1Channel.subscribeCallbacks[0]?.('SUBSCRIBED');

    render('p2');

    const projectP2Channel = channelWithTopic(channels, 'folders:project:p2');
    projectP2Channel.subscribeCallbacks[0]?.('SUBSCRIBED');
    expect(
      channels.filter((channel) => channel.topic === 'projects:user:user-1')
    ).toHaveLength(1);
    expect(removeChannel).toHaveBeenCalledWith(projectP1Channel);
    expect(removeChannel).not.toHaveBeenCalledWith(projectsUserChannel);
    expect(mockDocumentChannelCleanups.get('p1')).toHaveBeenCalledTimes(1);

    runtime.unmount();

    expect(removeChannel).toHaveBeenCalledWith(projectsUserChannel);
    expect(removeChannel).toHaveBeenCalledWith(projectP2Channel);
    expect(mockDocumentChannelCleanups.get('p2')).toHaveBeenCalledTimes(1);
  });

  it('uses the latest project for delete navigation', async () => {
    const { channels, render, router } = createHookSetup();
    render('p1');
    const projectsUserChannel = channelWithTopic(
      channels,
      'projects:user:user-1'
    );
    const projectsBinding = projectsUserChannel.bindings.find(
      ({ config }) => config.table === 'projects'
    );
    if (!projectsBinding) throw new Error('Missing projects binding');

    render('p2');
    await projectsBinding.callback({
      eventType: 'DELETE',
      schema: 'public',
      table: 'projects',
      new: {},
      old: { id: 'p2' },
    });

    expect(router.push).toHaveBeenCalledWith('/projects');
  });
});

describe('sidebar library realtime invalidation', () => {
  it('invalidates each library change once', async () => {
    const queryClient = {
      invalidateQueries: jest.fn<(
        filters: { queryKey: readonly unknown[] }
      ) => Promise<void>>(async () => undefined),
      refetchQueries: jest.fn(async () => undefined),
    };

    await invalidateSidebarLibraryChange(
      queryClient as never,
      'project-1',
      { id: 'library-1', folder_id: 'folder-1' },
      {}
    );

    const detailCalls = queryClient.invalidateQueries.mock.calls.filter(([filters]) => (
      JSON.stringify(filters.queryKey) === JSON.stringify(queryKeys.library('library-1'))
    ));
    expect(detailCalls).toHaveLength(1);
  });
});
