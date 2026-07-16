import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  broadcastProjectDocumentUpdate,
  notifyProjectDocumentUpdate,
  registerProjectDocumentChannel,
  subscribeToProjectDocumentUpdates,
} from '@/lib/documents/projectDocumentChannel';
import type { DocumentUpdatedPayload } from '@/lib/documents/documentBroadcast';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const payload: DocumentUpdatedPayload = {
  projectId: PROJECT_ID,
  documentId: '22222222-2222-4222-8222-222222222222',
  action: 'save',
  updatedAt: '2026-07-14T00:00:00.000Z',
};

function channel() {
  return {
    send: jest.fn().mockResolvedValue('ok'),
  } as unknown as RealtimeChannel;
}

describe('project document channel registry', () => {
  it('returns false without a subscribed project channel', async () => {
    expect(await broadcastProjectDocumentUpdate(payload)).toBe(false);
  });

  it('sends through the registered channel without creating a channel', async () => {
    const registered = channel();
    const unregister = registerProjectDocumentChannel(PROJECT_ID, registered);

    await expect(broadcastProjectDocumentUpdate(payload)).resolves.toBe(true);
    expect(registered.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'document-updated',
      payload,
    });

    unregister();
  });

  it('does not unregister a newer channel for the same project', async () => {
    const first = channel();
    const second = channel();
    const unregisterFirst = registerProjectDocumentChannel(PROJECT_ID, first);
    const unregisterSecond = registerProjectDocumentChannel(PROJECT_ID, second);

    unregisterFirst();
    await broadcastProjectDocumentUpdate(payload);

    expect(first.send).not.toHaveBeenCalled();
    expect(second.send).toHaveBeenCalledTimes(1);
    unregisterSecond();
  });

  it('notifies local subscribers with the typed payload', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToProjectDocumentUpdates(listener);

    notifyProjectDocumentUpdate(payload);

    expect(listener).toHaveBeenCalledWith(payload);
    unsubscribe();
    notifyProjectDocumentUpdate(payload);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
