/** @jest-environment jsdom */

import React, { type PropsWithChildren } from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow } from '@/lib/types/libraryAssets';

jest.mock('@/lib/services/libraryAssetsService', () => ({
  createAsset: jest.fn(),
  deleteAssets: jest.fn(),
  normalizeRowIndices: jest.fn(),
  shiftRowIndices: jest.fn(),
  updateAsset: jest.fn(async () => undefined),
}));
jest.mock('@/lib/utils/toast', () => ({
  showErrorToast: jest.fn(),
}));

import {
  createSerializedCommandQueue,
  invalidateSynchronizedLibraryQueries,
  persistSourceBeforeDialogueRows,
  resolveEditingBlockAfterFinish,
  useScriptDialogueEditor,
} from './useScriptDialogueEditor';
import { queryKeys } from '@/lib/utils/queryKeys';

function row(id: string, type: string, speaker: string): AssetRow {
  return {
    id,
    libraryId: 'current-script',
    name: speaker,
    propertyValues: { type, name: speaker, content: id },
  };
}

function queryWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useScriptDialogueEditor character side', () => {
  it('persists and previews one speaker side across the current Script only', async () => {
    const rows = [
      row('hero-speech-a', '2', 'Hero'),
      row('hero-action', '3', 'Hero'),
      row('hero-speech-b', '2', 'Hero'),
      row('rival-speech', '2', 'Rival'),
    ];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const mutationEvents: string[] = [];
    const cancelQueries = jest.spyOn(queryClient, 'cancelQueries').mockImplementation(async () => {
      mutationEvents.push('cancel');
    });
    const rpc = jest.fn(async (_functionName: string, _params: Record<string, unknown>) => ({
      ...(() => { mutationEvents.push('rpc'); return {}; })(),
      data: ['hero-speech-a', 'hero-speech-b'],
      error: null,
    }));
    queryClient.setQueryData(queryKeys.libraryAssets('current-script'), rows);
    const { result } = renderHook(() => useScriptDialogueEditor({
      supabase: { rpc } as unknown as SupabaseClient,
      libraryId: 'current-script',
      rows,
      selectedRows: rows.slice(0, 2),
      fields: { typeKey: 'type', nameKey: 'name', contentKey: 'content' },
    }), { wrapper: queryWrapper(queryClient) });
    await act(async () => {
      await expect(result.current.changeSpeakerSide('Hero', 'right')).resolves.toBe(true);
    });

    const cachedRows = queryClient.getQueryData<AssetRow[]>(
      queryKeys.libraryAssets('current-script'),
    );
    expect(cachedRows?.map((item) => [item.id, item.propertyValues.type])).toEqual([
      ['hero-speech-a', '1'],
      ['hero-action', '3'],
      ['hero-speech-b', '1'],
      ['rival-speech', '2'],
    ]);
    expect(rpc).toHaveBeenCalledWith('set_script_dialogue_speaker_side', {
      p_library_id: 'current-script',
      p_speaker: 'Hero',
      p_speech_type: '1',
      p_type_field_id: 'type',
      p_name_field_id: 'name',
    });
    expect(cancelQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.libraryAssets('current-script'),
    });
    expect(mutationEvents).toEqual(['cancel', 'rpc']);
    const { updateAsset } = jest.requireMock('@/lib/services/libraryAssetsService') as {
      updateAsset: jest.Mock;
    };
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it('rolls back only the optimistic side when persistence fails', async () => {
    const rows = [
      row('hero-speech', '2', 'Hero'),
      row('rival-speech', '2', 'Rival'),
    ];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let rejectRpc: ((reason: Error) => void) | undefined;
    const rpc = jest.fn(() => new Promise<never>((_resolve, reject) => {
      rejectRpc = reject;
    }));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    queryClient.setQueryData(queryKeys.libraryAssets('current-script'), rows);
    const { result } = renderHook(() => useScriptDialogueEditor({
      supabase: { rpc } as unknown as SupabaseClient,
      libraryId: 'current-script',
      rows,
      selectedRows: rows,
      fields: { typeKey: 'type', nameKey: 'name', contentKey: 'content' },
    }), { wrapper: queryWrapper(queryClient) });

    let pending!: Promise<boolean>;
    await act(async () => {
      pending = result.current.changeSpeakerSide('Hero', 'right');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    queryClient.setQueryData<AssetRow[]>(
      queryKeys.libraryAssets('current-script'),
      (current = []) => current.map((item) => item.id === 'hero-speech'
        ? {
          ...item,
          propertyValues: { ...item.propertyValues, content: 'edited while saving' },
        }
        : item),
    );

    rejectRpc?.(new Error('rpc failed'));
    await act(async () => {
      await expect(pending).resolves.toBe(false);
    });

    const cachedRows = queryClient.getQueryData<AssetRow[]>(
      queryKeys.libraryAssets('current-script'),
    );
    expect(cachedRows?.map((item) => [
      item.id,
      item.propertyValues.type,
      item.propertyValues.content,
    ])).toEqual([
      ['hero-speech', '2', 'edited while saving'],
      ['rival-speech', '2', 'rival-speech'],
    ]);
    consoleError.mockRestore();
  });

  it('uses the speaker-side RPC for undo and redo without overwriting later content edits', async () => {
    const rows = [row('hero-speech', '2', 'Hero')];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rpc = jest.fn(async (_functionName: string, _params: Record<string, unknown>) => ({
      data: ['hero-speech'],
      error: null,
    }));
    queryClient.setQueryData(queryKeys.libraryAssets('current-script'), rows);
    const { result } = renderHook(() => useScriptDialogueEditor({
      supabase: { rpc } as unknown as SupabaseClient,
      libraryId: 'current-script',
      rows,
      selectedRows: rows,
      fields: { typeKey: 'type', nameKey: 'name', contentKey: 'content' },
    }), { wrapper: queryWrapper(queryClient) });

    await act(async () => {
      await result.current.changeSpeakerSide('Hero', 'right');
    });
    queryClient.setQueryData<AssetRow[]>(queryKeys.libraryAssets('current-script'), (current = []) => (
      current.map((item) => ({
        ...item,
        propertyValues: { ...item.propertyValues, content: 'edited after side change' },
      }))
    ));
    await act(async () => {
      await result.current.undo();
    });
    await act(async () => {
      await result.current.redo();
    });

    expect(rpc).toHaveBeenNthCalledWith(2, 'set_script_dialogue_speaker_side', expect.objectContaining({
      p_speaker: 'Hero',
      p_speech_type: '2',
    }));
    expect(rpc).toHaveBeenNthCalledWith(3, 'set_script_dialogue_speaker_side', expect.objectContaining({
      p_speaker: 'Hero',
      p_speech_type: '1',
    }));
    const { updateAsset } = jest.requireMock('@/lib/services/libraryAssetsService') as {
      updateAsset: jest.Mock;
    };
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it('undoes and redoes a block character change without using the speaker-side RPC', async () => {
    const rows = [
      row('hero-speech', '2', 'Hero'),
      row('rival-speech', '1', 'Rival'),
    ];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rpc = jest.fn(async (_functionName: string, _params: Record<string, unknown>) => ({
      data: [],
      error: null,
    }));
    queryClient.setQueryData(queryKeys.libraryAssets('current-script'), rows);
    const { updateAsset } = jest.requireMock('@/lib/services/libraryAssetsService') as {
      updateAsset: jest.Mock;
    };
    updateAsset.mockClear();
    const { result } = renderHook(() => useScriptDialogueEditor({
      supabase: { rpc } as unknown as SupabaseClient,
      libraryId: 'current-script',
      rows,
      selectedRows: rows,
      fields: { typeKey: 'type', nameKey: 'name', contentKey: 'content' },
    }), { wrapper: queryWrapper(queryClient) });

    await act(async () => {
      await result.current.changeBlockSpeaker('hero-speech', 'Rival');
    });
    await act(async () => {
      await result.current.undo();
    });
    await act(async () => {
      await result.current.redo();
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(updateAsset).toHaveBeenNthCalledWith(2, expect.anything(), 'hero-speech', 'Hero', expect.objectContaining({
      name: 'Hero',
      type: '2',
    }));
    expect(updateAsset).toHaveBeenNthCalledWith(3, expect.anything(), 'hero-speech', 'Rival', expect.objectContaining({
      name: 'Rival',
      type: '1',
    }));
  });
});

describe('createSerializedCommandQueue', () => {
  it('runs overlapping commands in invocation order', async () => {
    const pendingChanges: number[] = [];
    const enqueue = createSerializedCommandQueue((pending) => pendingChanges.push(pending));
    let finishFirst: (() => void) | undefined;
    const events: string[] = [];

    const first = enqueue(async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      events.push('first:end');
      return true;
    });
    const second = enqueue(async () => {
      events.push('second');
      return true;
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    expect(pendingChanges).toEqual([1, 2]);

    finishFirst?.();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
    expect(pendingChanges).toEqual([1, 2, 1, 0]);
  });

  it('continues after a rejected command', async () => {
    const enqueue = createSerializedCommandQueue(jest.fn());
    const failure = new Error('save failed');

    await expect(enqueue(async () => { throw failure; })).rejects.toBe(failure);
    await expect(enqueue(async () => 'next')).resolves.toBe('next');
  });
});

describe('resolveEditingBlockAfterFinish', () => {
  it('closes only the block that actually finished saving', () => {
    expect(resolveEditingBlockAfterFinish('a', 'a')).toBeNull();
    expect(resolveEditingBlockAfterFinish('b', 'a')).toBe('b');
    expect(resolveEditingBlockAfterFinish(null, 'a')).toBeNull();
  });
});

describe('persistSourceBeforeDialogueRows', () => {
  it('does not write dialogue rows when source synchronization fails', async () => {
    const sourceError = new Error('source failed');
    const writeRows = jest.fn(async () => ['updated']);

    await expect(persistSourceBeforeDialogueRows(
      async () => { throw sourceError; },
      writeRows,
    )).rejects.toBe(sourceError);

    expect(writeRows).not.toHaveBeenCalled();
  });

  it('writes dialogue rows only after source synchronization succeeds', async () => {
    const events: string[] = [];

    await expect(persistSourceBeforeDialogueRows(
      async () => { events.push('source'); },
      async () => { events.push('rows'); return ['updated']; },
    )).resolves.toEqual(['updated']);

    expect(events).toEqual(['source', 'rows']);
  });
});

describe('invalidateSynchronizedLibraryQueries', () => {
  it('refetches updated Table assets even when their query is inactive', async () => {
    const invalidateQueries = jest.fn(async (_options: unknown) => undefined);
    const libraryId = 'table-id';

    await invalidateSynchronizedLibraryQueries(
      { invalidateQueries },
      [libraryId],
    );

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.library(libraryId),
      refetchType: 'all',
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.libraryAssets(libraryId),
      refetchType: 'all',
    });
  });
});
