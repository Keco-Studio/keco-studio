import { describe, expect, it, jest } from '@jest/globals';

import { SimulationSaveQueue } from '@/lib/simulation/SimulationSaveQueue';
import type { SimulationSaveResult } from '@/lib/simulation/storage';
import type { SimulationStateV1 } from '@/lib/simulation/types';

function state(id: string): SimulationStateV1 {
  return { version: 1, activeSessionId: null, sessions: [], marker: id } as unknown as SimulationStateV1;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function createQueue(save: (revision: number, state: SimulationStateV1) => Promise<SimulationSaveResult>) {
  const onSaved = jest.fn();
  const onUnsaved = jest.fn();
  const onConflict = jest.fn();
  return {
    queue: new SimulationSaveQueue({ revision: 2, save, onSaved, onUnsaved, onConflict }),
    onSaved, onUnsaved, onConflict,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SimulationSaveQueue', () => {
  it('keeps one request in flight and coalesces pending state to the newest snapshot', async () => {
    const first = deferred<SimulationSaveResult>();
    const second = deferred<SimulationSaveResult>();
    const save = jest.fn<(revision: number, value: SimulationStateV1) => Promise<SimulationSaveResult>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { queue, onSaved } = createQueue(save);

    queue.enqueue(state('first'));
    queue.enqueue(state('middle'));
    queue.enqueue(state('newest'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, 2, state('first'));
    expect(queue.isDirty()).toBe(true);

    first.resolve({ ok: true, revision: 3 });
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, 3, state('newest'));
    expect(onSaved).toHaveBeenLastCalledWith(3, true);

    second.resolve({ ok: true, revision: 4 });
    await settle();
    expect(queue.getRevision()).toBe(4);
    expect(queue.isDirty()).toBe(false);
    expect(onSaved).toHaveBeenLastCalledWith(4, false);
  });

  it('retries the newest failed snapshot at the unchanged revision', async () => {
    const failed: SimulationSaveResult = { ok: false, error: { code: 'write_failed', message: 'offline' } };
    const save = jest.fn<(revision: number, value: SimulationStateV1) => Promise<SimulationSaveResult>>()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce({ ok: true, revision: 3 });
    const { queue, onUnsaved } = createQueue(save);

    queue.enqueue(state('first'));
    queue.enqueue(state('newest'));
    await settle();
    expect(onUnsaved).toHaveBeenCalledWith(failed.error);
    expect(queue.isDirty()).toBe(true);

    queue.retry();
    await settle();
    expect(save).toHaveBeenNthCalledWith(2, 2, state('newest'));
    expect(queue.getRevision()).toBe(3);
    expect(queue.isDirty()).toBe(false);
  });

  it('blocks automatic and manual saves after a conflict', async () => {
    const conflict: SimulationSaveResult = { ok: false, error: { code: 'conflict', message: 'stale' } };
    const save = jest.fn<(revision: number, value: SimulationStateV1) => Promise<SimulationSaveResult>>()
      .mockResolvedValue(conflict);
    const { queue, onConflict } = createQueue(save);

    queue.enqueue(state('first'));
    await settle();
    expect(onConflict).toHaveBeenCalledWith(conflict.error);

    queue.enqueue(state('second'));
    queue.retry();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.isDirty()).toBe(false);
  });

  it('ignores late completion and follow-up work after stop', async () => {
    const first = deferred<SimulationSaveResult>();
    const save = jest.fn<(revision: number, value: SimulationStateV1) => Promise<SimulationSaveResult>>()
      .mockReturnValue(first.promise);
    const { queue, onSaved, onUnsaved, onConflict } = createQueue(save);

    queue.enqueue(state('first'));
    queue.enqueue(state('pending'));
    queue.stop();
    first.resolve({ ok: true, revision: 3 });
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onUnsaved).not.toHaveBeenCalled();
    expect(onConflict).not.toHaveBeenCalled();
  });
});
