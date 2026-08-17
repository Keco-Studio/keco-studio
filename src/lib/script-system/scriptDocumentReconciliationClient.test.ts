import { requestScriptDocumentReconciliation } from './scriptDocumentReconciliationClient';

describe('requestScriptDocumentReconciliation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the compacted document token and both Markdown snapshots', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        updatedLibraries: 1,
        updatedLibraryIds: ['33333333-3333-4333-8333-333333333333'],
      }), { status: 200 }),
    );

    await expect(requestScriptDocumentReconciliation({
      accessToken: 'token',
      projectId: '11111111-1111-4111-8111-111111111111',
      documentId: '22222222-2222-4222-8222-222222222222',
      expected: { epoch: 3, revision: 4 },
      previousMarkdown: 'Ada：Hello',
      markdown: 'Ada：Changed',
    })).resolves.toEqual({
      status: 'synced',
      updatedLibraries: 1,
      updatedLibraryIds: ['33333333-3333-4333-8333-333333333333'],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/script-document-reconcile',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer token' }),
        body: JSON.stringify({
          projectId: '11111111-1111-4111-8111-111111111111',
          documentId: '22222222-2222-4222-8222-222222222222',
          expected: { epoch: 3, revision: 4 },
          previousMarkdown: 'Ada：Hello',
          markdown: 'Ada：Changed',
        }),
      }),
    );
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('keepalive');
  });

  it('returns not-linked when no derived Script library needs reconciliation', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await expect(requestScriptDocumentReconciliation({
      accessToken: 'token',
      projectId: '11111111-1111-4111-8111-111111111111',
      documentId: '22222222-2222-4222-8222-222222222222',
      expected: { epoch: 3, revision: 4 },
      previousMarkdown: 'before',
      markdown: 'after',
    })).resolves.toEqual({ status: 'not-linked' });
  });

  it.each([
    ['MAPPING_AMBIGUOUS', 'regenerate-required'],
    ['DOCUMENT_CONFLICT', 'conflict'],
  ] as const)('preserves the %s reason for visible recovery', async (code, status) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ code }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ));

    await expect(requestScriptDocumentReconciliation({
      accessToken: 'token',
      projectId: '11111111-1111-4111-8111-111111111111',
      documentId: '22222222-2222-4222-8222-222222222222',
      expected: { epoch: 3, revision: 4 },
      previousMarkdown: 'before',
      markdown: 'after',
    })).resolves.toEqual({ status });
  });
});
