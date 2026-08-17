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
      libraryId: '33333333-3333-4333-8333-333333333333',
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

  it('returns a synchronized plot plan from a reorder response', async () => {
    const plotPlan = {
      version: 2 as const,
      entryPlotNodeId: 'Opening',
      storyNodeOrder: ['LineB', 'LineA'],
      nodes: [{ id: 'Opening', title: 'Opening', storyNodeIds: ['LineB', 'LineA'] }],
      edges: [],
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      state: { markdown: 'updated', token: { epoch: 2, revision: 3 } },
      plotPlan,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await syncScriptDialogueDocumentWithConflictRetry({
      projectId: '11111111-1111-4111-8111-111111111111',
      libraryId: '33333333-3333-4333-8333-333333333333',
      documentId: '22222222-2222-4222-8222-222222222222',
      expected: { epoch: 1, revision: 2 },
      command: {
        type: 'reorder',
        movingTexts: ['Ben：Wait'],
        targetText: 'Ada：Hello',
        edge: 'before',
      },
    }, jest.fn());

    expect(result.plotPlan).toEqual(plotPlan);
  });
});
