import {
  createDocumentAutosaveController,
  type DocumentAutosaveController,
} from '@/components/documents/useDocumentAutosave';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeController(overrides: {
  initialContent?: string;
  getSnapshot?: () => string;
  save?: jest.Mock;
  onSaved?: jest.Mock;
  delayMs?: number;
} = {}): {
  controller: DocumentAutosaveController;
  save: jest.Mock;
  onSaved: jest.Mock;
} {
  const save = overrides.save ?? jest.fn(async () => ({
    updatedAt: '2026-07-14T00:00:01.000Z',
  }));
  const onSaved = overrides.onSaved ?? jest.fn();
  const controller = createDocumentAutosaveController({
    initialContent: overrides.initialContent ?? 'initial',
    initialUpdatedAt: '2026-07-14T00:00:00.000Z',
    readOnly: false,
    delayMs: overrides.delayMs,
    getSnapshot: overrides.getSnapshot ?? (() => ''),
    save,
    onSaved,
  });
  return { controller, save, onSaved };
}

describe('document autosave controller', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('saves once after 1500 ms of idle time', async () => {
    const { controller, save } = makeController();

    controller.handleChange('draft');
    jest.advanceTimersByTime(1499);
    expect(save).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await jest.runAllTimersAsync();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('draft');
    expect(controller.getState()).toMatchObject({ state: 'saved', isDirty: false });
  });

  it('coalesces an edit that arrives while a save is in flight', async () => {
    const first = deferred<{ updatedAt: string }>();
    const save = jest
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ updatedAt: '2026-07-14T00:00:02.000Z' });
    const { controller } = makeController({ save });

    controller.handleChange('first');
    const flushing = controller.flush('debounce');
    controller.handleChange('second');

    expect(controller.getState().state).toBe('saving');
    first.resolve({ updatedAt: '2026-07-14T00:00:01.000Z' });
    await flushing;

    expect(save.mock.calls).toEqual([['first'], ['second']]);
    expect(controller.getState()).toMatchObject({
      state: 'saved',
      isDirty: false,
      lastSavedContent: 'second',
    });
  });

  it('persists an explicit empty edit during navigation', async () => {
    const { controller, save } = makeController({
      initialContent: 'non-empty',
      getSnapshot: () => '',
    });

    controller.handleChange('');
    await controller.flush('navigate');

    expect(save).toHaveBeenCalledWith('');
  });

  it('does not let an empty teardown snapshot clobber known content', async () => {
    const { controller, save } = makeController({
      initialContent: 'saved body',
      getSnapshot: () => '',
    });

    controller.handleChange('new body');
    await controller.flush('unmount');

    expect(save).toHaveBeenCalledWith('new body');
  });

  it('keeps dirty state and propagates a rejected flush', async () => {
    const save = jest.fn().mockRejectedValue(new Error('offline'));
    const { controller } = makeController({ save });
    controller.handleChange('draft');

    await expect(controller.flush('navigate')).rejects.toThrow('offline');

    expect(controller.getState()).toMatchObject({
      state: 'error',
      isDirty: true,
      error: 'offline',
    });
  });

  it('accepts a remote body as the new clean baseline', () => {
    const { controller } = makeController();
    controller.handleChange('local');

    controller.acceptRemote('remote', '2026-07-14T00:00:03.000Z');

    expect(controller.getState()).toMatchObject({
      state: 'saved',
      isDirty: false,
      lastSavedContent: 'remote',
      lastSavedAt: '2026-07-14T00:00:03.000Z',
    });
  });

  it('pauses a dirty debounce until the remote conflict is resolved', async () => {
    const { controller, save } = makeController();
    const conflictController = controller as unknown as {
      pauseForRemote: () => void;
      keepLocalAfterRemote: (updatedAt: string) => void;
      getRevision: () => number;
      getState: () => { isPaused: boolean; isDirty: boolean };
    };

    controller.handleChange('local draft');
    expect(conflictController.getRevision()).toBe(1);
    conflictController.pauseForRemote();
    await jest.advanceTimersByTimeAsync(1500);

    expect(save).not.toHaveBeenCalled();
    expect(conflictController.getState()).toMatchObject({
      isPaused: true,
      isDirty: true,
    });
    await expect(controller.flush('navigate')).rejects.toThrow(/conflict/i);

    conflictController.keepLocalAfterRemote('2026-07-14T00:00:03.000Z');
    await jest.advanceTimersByTimeAsync(1500);

    expect(save).toHaveBeenCalledWith('local draft');
    expect(conflictController.getState().isPaused).toBe(false);
  });

  it('accepting the remote body clears a conflict pause', () => {
    const { controller } = makeController();
    const conflictController = controller as unknown as {
      pauseForRemote: () => void;
      getState: () => { isPaused: boolean };
    };

    controller.handleChange('local draft');
    conflictController.pauseForRemote();
    controller.acceptRemote('remote body', '2026-07-14T00:00:03.000Z');

    expect(conflictController.getState().isPaused).toBe(false);
  });
});
