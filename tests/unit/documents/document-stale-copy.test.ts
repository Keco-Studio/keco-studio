import {
  createDocumentStaleCopyController,
} from '@/components/documents/useDocumentStaleCopy';
import type { DocumentUpdatedPayload } from '@/lib/documents/documentBroadcast';

const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const BASELINE = '2026-07-14T00:00:00.000Z';

function saveUpdate(
  overrides: Partial<DocumentUpdatedPayload> = {}
): DocumentUpdatedPayload {
  return {
    projectId: '11111111-1111-4111-8111-111111111111',
    documentId: DOCUMENT_ID,
    action: 'save',
    updatedAt: '2026-07-14T00:00:01.000Z',
    ...overrides,
  };
}

describe('document stale-copy controller', () => {
  it.each([
    saveUpdate({ documentId: '33333333-3333-4333-8333-333333333333' }),
    saveUpdate({ action: 'rename' }),
    saveUpdate({ updatedAt: undefined }),
    saveUpdate({ updatedAt: BASELINE }),
  ])('ignores irrelevant or non-newer updates', async (update) => {
    const onCleanRemoteSave = jest.fn();
    const controller = createDocumentStaleCopyController({
      documentId: DOCUMENT_ID,
      localUpdatedAt: BASELINE,
      isDirty: false,
      onCleanRemoteSave,
    });

    await controller.receive(update);

    expect(onCleanRemoteSave).not.toHaveBeenCalled();
    expect(controller.getState().isStale).toBe(false);
  });

  it('refreshes a clean editor immediately', async () => {
    const onCleanRemoteSave = jest.fn().mockResolvedValue(undefined);
    const controller = createDocumentStaleCopyController({
      documentId: DOCUMENT_ID,
      localUpdatedAt: BASELINE,
      isDirty: false,
      onCleanRemoteSave,
    });

    await controller.receive(saveUpdate());

    expect(onCleanRemoteSave).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toEqual({
      isStale: false,
      remoteUpdatedAt: null,
    });
  });

  it('shows a banner instead of replacing dirty local content', async () => {
    const onCleanRemoteSave = jest.fn();
    const controller = createDocumentStaleCopyController({
      documentId: DOCUMENT_ID,
      localUpdatedAt: BASELINE,
      isDirty: true,
      onCleanRemoteSave,
    });

    await controller.receive(saveUpdate());

    expect(onCleanRemoteSave).not.toHaveBeenCalled();
    expect(controller.getState()).toEqual({
      isStale: true,
      remoteUpdatedAt: '2026-07-14T00:00:01.000Z',
    });
  });

  it('clears a stale banner only after reload succeeds', async () => {
    const onCleanRemoteSave = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const controller = createDocumentStaleCopyController({
      documentId: DOCUMENT_ID,
      localUpdatedAt: BASELINE,
      isDirty: true,
      onCleanRemoteSave,
    });
    await controller.receive(saveUpdate());

    await expect(controller.reloadRemote()).rejects.toThrow('offline');
    expect(controller.getState().isStale).toBe(true);
    await controller.reloadRemote();
    expect(controller.getState().isStale).toBe(false);
  });

  it('keeps local content and returns the ignored remote timestamp', async () => {
    const controller = createDocumentStaleCopyController({
      documentId: DOCUMENT_ID,
      localUpdatedAt: BASELINE,
      isDirty: true,
      onCleanRemoteSave: jest.fn(),
    });
    await controller.receive(saveUpdate());

    expect(controller.keepLocal()).toBe('2026-07-14T00:00:01.000Z');
    expect(controller.getState().isStale).toBe(false);
  });
});
