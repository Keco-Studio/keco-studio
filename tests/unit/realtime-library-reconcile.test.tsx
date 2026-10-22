/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, jest } from '@jest/globals';
import { useLibraryBroadcasts } from '@/lib/hooks/realtime/useLibraryBroadcasts';
import { useLibraryChannel } from '@/lib/hooks/realtime/useLibraryChannel';
import type {
  LibraryBroadcastRuntime,
  LibraryChannelRuntime,
  RealtimeSubscriptionConfig,
} from '@/lib/hooks/realtime/types';

function createConfig(onReconcile = jest.fn()): RealtimeSubscriptionConfig {
  return {
    libraryId: 'library-1',
    currentUserId: 'user-1',
    currentUserName: 'Owner',
    currentUserEmail: 'owner@example.com',
    avatarColor: '#123456',
    onCellUpdate: jest.fn(),
    onAssetCreate: jest.fn(),
    onAssetDelete: jest.fn(),
    onConflict: jest.fn(),
    onReconcile,
  };
}

describe('library reconciliation broadcasts', () => {
  it('broadcasts a reconciliation request for the current library user', async () => {
    const httpSend = jest.fn(async () => ({ success: true }));
    const runtime = {
      channelRef: { current: { httpSend } },
      broadcastDebounceRef: { current: new Map() },
      connectionStatus: 'connected',
      addOptimisticUpdate: jest.fn(),
      removeOptimisticUpdate: jest.fn(),
      queueUpdate: jest.fn(),
    } as unknown as LibraryBroadcastRuntime;
    const { result } = renderHook(() => useLibraryBroadcasts(createConfig(), runtime));

    await act(async () => {
      await result.current.broadcastReconcile();
    });

    expect(httpSend).toHaveBeenCalledWith('library:reconcile', {
      type: 'library:reconcile',
      userId: 'user-1',
      timestamp: expect.any(Number),
    });
  });

  it('reconciles remote requests and ignores requests from the current user', async () => {
    const broadcastHandlers = new Map<string, (payload: { payload: unknown }) => void>();
    const channel = {
      on: jest.fn((kind: string, filter: { event?: string }, handler: (payload: { payload: unknown }) => void) => {
        if (kind === 'broadcast' && filter.event) broadcastHandlers.set(filter.event, handler);
        return channel;
      }),
      subscribe: jest.fn(() => channel),
      unsubscribe: jest.fn(async () => undefined),
    };
    const supabase = {
      channel: jest.fn(() => channel),
    };
    const onReconcile = jest.fn(async () => undefined);
    const runtimeRef = {
      current: {
        config: createConfig(onReconcile),
        optimisticUpdatesRef: { current: new Map() },
        removeOptimisticUpdate: jest.fn(),
        processQueuedUpdates: jest.fn(async () => undefined),
        setConnectionStatus: jest.fn(),
        broadcastDebounceRef: { current: new Map() },
      } satisfies LibraryChannelRuntime,
    };
    const channelRef = { current: null };

    const { unmount } = renderHook(() => useLibraryChannel({
      supabase: supabase as never,
      libraryId: 'library-1',
      channelRef,
      runtimeRef,
    }));
    const handleReconcile = broadcastHandlers.get('library:reconcile');

    expect(handleReconcile).toBeDefined();
    await act(async () => {
      handleReconcile?.({ payload: { type: 'library:reconcile', userId: 'user-2', timestamp: 1 } });
      await Promise.resolve();
    });
    expect(onReconcile).toHaveBeenCalledTimes(1);

    await act(async () => {
      handleReconcile?.({ payload: { type: 'library:reconcile', userId: 'user-1', timestamp: 2 } });
      await Promise.resolve();
    });
    expect(onReconcile).toHaveBeenCalledTimes(1);

    unmount();
  });
});
