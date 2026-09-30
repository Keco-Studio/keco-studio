/** @jest-environment jsdom */
import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import {
  SerializedMapDraftWriter,
  useMapDraft,
  validateMapDraftPayloadV3,
  type MapDraftPayloadV3,
} from '@/features/create-map/hooks/useMapDraft';
import { CreateMapServiceError, type MapDraftIdentity } from '@/features/create-map/services/createMapService';
import { makeEmptyMapSceneV3, makeValidMapPlanV3 } from './fixtures';

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));

function identity(mapId: string, revisionId: string, saveVersion = 0): MapDraftIdentity {
  return { mapId, revisionId, revisionNumber: 1, saveVersion };
}

function payload(name: string): MapDraftPayloadV3 {
  return {
    plan: { ...makeValidMapPlanV3(), name },
    scene: makeEmptyMapSceneV3(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('SerializedMapDraftWriter', () => {
  it('serializes two edits made while the first save is delayed and advances CAS versions', async () => {
    const first = deferred<number>();
    const calls: Array<{ identity: MapDraftIdentity; name: string }> = [];
    const saved: string[] = [];
    const writer = new SerializedMapDraftWriter<MapDraftPayloadV3>(async (target, nextPayload) => {
      calls.push({ identity: { ...target }, name: nextPayload.plan.name });
      return calls.length === 1 ? first.promise : 2;
    }, { onSaved: (_target, nextPayload) => saved.push(nextPayload.plan.name) });
    writer.install(identity('map-a', 'revision-a'));

    const running = writer.enqueue(payload('First edit'));
    void writer.enqueue(payload('Second edit'));
    first.resolve(1);
    await running;

    expect(calls.map((call) => [call.name, call.identity.saveVersion])).toEqual([
      ['First edit', 0],
      ['Second edit', 1],
    ]);
    expect(saved).toEqual(['First edit', 'Second edit']);
    expect(writer.currentIdentity()?.saveVersion).toBe(2);
  });

  it('discards an old completion and saves the replacement map with its own identity', async () => {
    const oldSave = deferred<number>();
    const saved: Array<[string, string]> = [];
    const writer = new SerializedMapDraftWriter<MapDraftPayloadV3>(async (target, nextPayload) => {
      if (target.mapId === 'map-old') return oldSave.promise;
      expect(nextPayload.plan.name).toBe('New map edit');
      return 8;
    }, { onSaved: (target, nextPayload) => saved.push([target.mapId, nextPayload.plan.name]) });
    writer.install(identity('map-old', 'revision-old'));

    const running = writer.enqueue(payload('Old map edit'));
    writer.install(identity('map-new', 'revision-new', 7));
    void writer.enqueue(payload('New map edit'));
    oldSave.resolve(1);
    await running;

    expect(saved).toEqual([['map-new', 'New map edit']]);
    expect(writer.currentIdentity()).toMatchObject({ mapId: 'map-new', revisionId: 'revision-new', saveVersion: 8 });
  });

  it('freezes after a CAS conflict until a workspace is explicitly reinstalled', async () => {
    const save = jest.fn(async () => {
      throw new CreateMapServiceError('save_conflict');
    });
    const onConflict = jest.fn();
    const writer = new SerializedMapDraftWriter<MapDraftPayloadV3>(save, { onConflict });
    writer.install(identity('map-a', 'revision-a'));

    await writer.enqueue(payload('Conflicting edit'));
    await writer.enqueue(payload('Ignored while frozen'));

    expect(writer.isFrozen()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(onConflict).toHaveBeenCalledTimes(1);
    writer.install(identity('map-a', 'revision-next'));
    expect(writer.isFrozen()).toBe(false);
  });

  it('rejects an invalid local payload before it can enter the writer', async () => {
    const save = jest.fn(async () => 1);
    const writer = new SerializedMapDraftWriter<MapDraftPayloadV3>(save);
    writer.install(identity('map-a', 'revision-a'));
    const validPlan = makeValidMapPlanV3();
    const plan = { ...validPlan, map: { ...validPlan.map, width: 65 } };

    const validation = validateMapDraftPayloadV3(plan, makeEmptyMapSceneV3());
    if (validation.success) await writer.enqueue(validation.payload);

    expect(validation.success).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('serializes a V3 payload without merging it into the V2 schema', async () => {
    const saved: MapDraftPayloadV3[] = [];
    const writer = new SerializedMapDraftWriter<MapDraftPayloadV3>(async (_target, nextPayload) => {
      saved.push(nextPayload);
      return 1;
    });
    writer.install(identity('map-v3', 'revision-v3'));
    const plan = makeValidMapPlanV3();
    const scene = makeEmptyMapSceneV3();
    const validation = validateMapDraftPayloadV3(plan, scene);
    if (validation.success) await writer.enqueue(validation.payload);

    expect(validation.success).toBe(true);
    expect(saved).toEqual([{ plan, scene }]);
    expect((saved[0].plan as { visualBrief?: unknown }).visualBrief).toBeUndefined();
  });
});

describe('useMapDraft', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('cancels a pending autosave when saveNow persists the same payload', async () => {
    jest.useFakeTimers();
    const initial = payload('Initial plan');
    const changed = payload('Changed plan');
    const draftIdentity = identity('map-a', 'revision-a');
    const firstSave = deferred<number>();
    const save = jest.fn(async (current: MapDraftIdentity) => (
      save.mock.calls.length === 1 ? firstSave.promise : current.saveVersion + 1
    ));
    const adapter = {
      validate: () => true,
      create: async () => draftIdentity,
      save,
      publish: async () => ({ publishedRevisionId: 'published', nextDraftRevisionId: 'next' }),
      load: async () => ({ identity: draftIdentity, plan: initial.plan, scene: initial.scene }),
    };
    const { result, rerender } = renderHook(({ plan }) => useMapDraft(plan, initial.scene, adapter), {
      initialProps: { plan: initial.plan },
    });

    await act(async () => {
      await result.current.create('project-a', null, initial.plan, initial.scene);
    });
    rerender({ plan: changed.plan });

    let saveNow!: Promise<MapDraftIdentity | null>;
    act(() => {
      saveNow = result.current.saveNow();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(750);
    });
    firstSave.resolve(1);
    await act(async () => {
      await saveNow;
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.identity?.saveVersion).toBe(1);
  });
});
