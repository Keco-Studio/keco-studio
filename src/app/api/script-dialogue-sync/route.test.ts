import { NextRequest } from 'next/server';

const syncScriptDialogueDocument = jest.fn();
const withAuth = jest.fn((handler: unknown) => async (request: NextRequest) => (
  (handler as Function)(request, undefined, {
    supabase: { source: 'test' },
    user: { id: '44444444-4444-4444-8444-444444444444' },
  })
));

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: unknown) => withAuth(handler),
}));
jest.mock('@/lib/server/scriptDialogueDocumentSyncService', () => ({
  syncScriptDialogueDocument: (...args: unknown[]) => syncScriptDialogueDocument(...args),
  mapScriptDialogueSyncError: (error: unknown) => ({
    code: 'SYNC_FAILED',
    status: 500,
    message: error instanceof Error ? 'Failed to synchronize the source document.' : 'Failed to synchronize the source document.',
  }),
}));

import { POST } from './route';

const validBody = {
  projectId: '11111111-1111-4111-8111-111111111111',
  libraryId: '22222222-2222-4222-8222-222222222222',
  documentId: '33333333-3333-4333-8333-333333333333',
  expected: { epoch: 1, revision: 2 },
  command: { type: 'edit', role: 'action', previousText: 'Old', nextText: 'New' },
};

describe('script dialogue sync route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs the internal cause when synchronization fails generically', async () => {
    const error = { message: 'postgres detail', code: '23505', details: 'private row detail' };
    syncScriptDialogueDocument.mockRejectedValueOnce(error);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(new NextRequest('https://example.test/api/script-dialogue-sync', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'content-type': 'application/json' },
    }), undefined);

    expect(response.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith(
      '[script-dialogue-sync] synchronization failed',
      expect.objectContaining({ message: 'postgres detail', code: '23505' }),
    );
    errorSpy.mockRestore();
  });
});
