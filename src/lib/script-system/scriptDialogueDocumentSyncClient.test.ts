import {
  syncScriptDialogueDocumentWithConflictRetry,
} from './scriptDialogueDocumentSyncClient';

describe('script dialogue document sync client', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refreshes the document token and retries once after a conflict', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 'DOCUMENT_CONFLICT',
        error: 'The source document changed. Refresh and try again.',
      }), { status: 409, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        state: { markdown: 'updated', token: { epoch: 4, revision: 7 } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const refreshExpected = jest.fn().mockResolvedValue({ epoch: 3, revision: 6 });

    const result = await syncScriptDialogueDocumentWithConflictRetry({
      projectId: '11111111-1111-4111-8111-111111111111',
      documentId: '22222222-2222-4222-8222-222222222222',
      expected: { epoch: 1, revision: 2 },
      command: { type: 'delete', previousTexts: ['Ada：Hello'] },
    }, refreshExpected);

    expect(refreshExpected).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual(
      expect.objectContaining({ expected: { epoch: 3, revision: 6 } }),
    );
    expect(result.state.token).toEqual({ epoch: 4, revision: 7 });
  });
});
