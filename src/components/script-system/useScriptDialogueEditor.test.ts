import { describe, expect, it, jest } from '@jest/globals';
import {
  createSerializedCommandQueue,
  invalidateSynchronizedLibraryQueries,
  persistSourceBeforeDialogueRows,
  resolveEditingBlockAfterFinish,
} from './useScriptDialogueEditor';
import { queryKeys } from '@/lib/utils/queryKeys';

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
