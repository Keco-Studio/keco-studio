import type { SupabaseClient } from '@supabase/supabase-js';

const normalizeYjsState = jest.fn();
const readDocumentTransportState = jest.fn();
const readDocumentState = jest.fn();
const initializeDocumentState = jest.fn();
const normalizeDocumentState = jest.fn();
const broadcastDocumentStateReset = jest.fn();

jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: { normalizeYjsState },
}));

jest.mock('@/lib/documents/documentStateGateway', () => ({
  readDocumentTransportState,
  readDocumentState,
  initializeDocumentState,
  normalizeDocumentState,
}));

jest.mock('@/lib/documents/documentStateResetBroadcaster', () => ({
  broadcastDocumentStateReset,
}));

import { ensureDocumentReferenceBlocks } from '@/lib/documents/documentReferenceBlocks';
import {
  DocumentStateConflictError,
} from '@/lib/documents/documentStateTypes';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const client = {} as SupabaseClient;
const blocks = [
  {
    blockId: '33333333-3333-4333-8333-333333333333',
    blockType: 'heading' as const,
    text: 'Heading',
    headingLevel: 1,
  },
];

function blocksWithId(blockId: string) {
  return [{ ...blocks[0], blockId }];
}

function transportState(
  overrides: Partial<{
    yjsStateBase64: string | null;
    epoch: number;
    updateBase64: string;
  }> = {}
) {
  const yjsStateBase64 =
    overrides.yjsStateBase64 === undefined
      ? 'snapshot'
      : overrides.yjsStateBase64;
  return {
    documentId: DOCUMENT_ID,
    projectId: PROJECT_ID,
    mode: overrides.yjsStateBase64 === null ? 'legacy' : 'collaborative',
    yjsStateBase64,
    updateTail: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        updateBase64: overrides.updateBase64 ?? 'tail',
      },
    ],
    token: { epoch: overrides.epoch ?? 2, revision: 4 },
    updatedAt: '2026-07-17T00:00:00.000Z',
  };
}

function normalized(
  normalizationUpdateBase64: string | null,
  normalizedBlocks = blocks,
  yjsStateBase64 = 'normalized-state'
) {
  return {
    yjsStateBase64,
    markdown: '# <BlockAnchor />Heading',
    normalizationUpdateBase64,
    blocks: normalizedBlocks,
  };
}

describe('ensureDocumentReferenceBlocks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    broadcastDocumentStateReset.mockResolvedValue(undefined);
  });

  it('initializes a legacy document from markdown before listing blocks', async () => {
    readDocumentTransportState
      .mockResolvedValueOnce(transportState({ yjsStateBase64: null }))
      .mockResolvedValueOnce(transportState());
    readDocumentState.mockResolvedValue({
      ...transportState({ yjsStateBase64: null }),
      markdown: '# V0806 feedback\n\n- bug one',
    });
    initializeDocumentState.mockResolvedValue(transportState());
    normalizeYjsState.mockResolvedValue(normalized(null));

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).resolves.toEqual({ projectId: PROJECT_ID, blocks });
    expect(initializeDocumentState).toHaveBeenCalledWith(
      client,
      DOCUMENT_ID,
      '# V0806 feedback\n\n- bug one'
    );
    expect(normalizeYjsState).toHaveBeenCalledWith('snapshot', ['tail']);
  });

  it('returns canonical blocks without committing a no-op normalization', async () => {
    readDocumentTransportState.mockResolvedValue(transportState());
    normalizeYjsState.mockResolvedValue(normalized(null));

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).resolves.toEqual({ projectId: PROJECT_ID, blocks });
    expect(normalizeYjsState).toHaveBeenCalledWith('snapshot', ['tail']);
    expect(normalizeDocumentState).not.toHaveBeenCalled();
    expect(broadcastDocumentStateReset).not.toHaveBeenCalled();
  });

  it('returns blocks decoded from the exact epoch-fenced committed state', async () => {
    const transientBlocks = blocksWithId(
      '55555555-5555-4555-8555-555555555555'
    );
    const committedBlocks = blocksWithId(
      '66666666-6666-4666-8666-666666666666'
    );
    readDocumentTransportState.mockResolvedValue(transportState({ epoch: 7 }));
    normalizeYjsState
      .mockResolvedValueOnce(normalized('normalization-delta', transientBlocks))
      .mockResolvedValueOnce(normalized(null, committedBlocks, 'committed-state'));
    const committedState = {
      ...transportState({ epoch: 7 }),
      markdown: '# Committed',
      yjsStateBase64: 'committed-state',
      updateTail: [],
      token: { epoch: 8, revision: 5 },
    };
    normalizeDocumentState.mockResolvedValue(committedState);

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).resolves.toEqual({ projectId: PROJECT_ID, blocks: committedBlocks });
    expect(normalizeDocumentState).toHaveBeenCalledWith(client, {
      documentId: DOCUMENT_ID,
      expected: { epoch: 7, revision: 4 },
    });
    expect(normalizeYjsState).toHaveBeenNthCalledWith(2, 'committed-state', []);
    expect(broadcastDocumentStateReset).toHaveBeenCalledWith(
      client,
      committedState,
      'normalization'
    );
  });

  it('returns committed blocks when the normalization reset broadcast fails', async () => {
    const committedBlocks = blocksWithId(
      '66666666-6666-4666-8666-666666666666'
    );
    readDocumentTransportState.mockResolvedValue(transportState({ epoch: 7 }));
    normalizeYjsState
      .mockResolvedValueOnce(normalized('normalization-delta'))
      .mockResolvedValueOnce(normalized(null, committedBlocks, 'committed-state'));
    const committedState = {
      ...transportState({ epoch: 7 }),
      markdown: '# Committed',
      yjsStateBase64: 'committed-state',
      updateTail: [],
      token: { epoch: 8, revision: 5 },
    };
    normalizeDocumentState.mockResolvedValue(committedState);
    broadcastDocumentStateReset.mockRejectedValue(
      new Error('realtime unavailable')
    );

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).resolves.toEqual({ projectId: PROJECT_ID, blocks: committedBlocks });
    expect(broadcastDocumentStateReset).toHaveBeenCalledWith(
      client,
      committedState,
      'normalization'
    );
  });

  it('returns only the winning IDs when same-token normalizers race', async () => {
    const candidateA = blocksWithId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const candidateB = blocksWithId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const winnerBlocks = candidateA;
    let epoch = 2;
    let revision = 4;
    let storedState = 'snapshot';
    let initialNormalizations = 0;
    const pendingCandidates: Array<{
      value: ReturnType<typeof normalized>;
      resolve: (value: ReturnType<typeof normalized>) => void;
    }> = [];

    readDocumentTransportState.mockImplementation(async () => ({
      ...transportState({ yjsStateBase64: storedState }),
      updateTail: storedState === 'snapshot'
        ? transportState().updateTail
        : [],
      token: { epoch, revision },
    }));
    normalizeYjsState.mockImplementation(
      async (snapshot: string) => {
        if (snapshot === 'winner-state') {
          return normalized(null, winnerBlocks, 'winner-state');
        }
        const value = normalized(
          `delta-${initialNormalizations}`,
          initialNormalizations === 0 ? candidateA : candidateB
        );
        initialNormalizations += 1;
        return new Promise((resolve) => {
          pendingCandidates.push({ value, resolve });
          if (pendingCandidates.length === 2) {
            for (const pending of pendingCandidates) pending.resolve(pending.value);
          }
        });
      }
    );
    normalizeDocumentState.mockImplementation(
      async (
        _client: SupabaseClient,
        input: { expected: { epoch: number; revision: number } }
      ) => {
        if (
          input.expected.epoch !== epoch ||
          input.expected.revision !== revision
        ) {
          throw new DocumentStateConflictError('changed', {
            epoch,
            revision,
          });
        }
        epoch += 1;
        revision += 1;
        storedState = 'winner-state';
        return {
          ...transportState({ yjsStateBase64: storedState }),
          markdown: '# Winner',
          yjsStateBase64: storedState,
          updateTail: [],
          token: { epoch, revision },
        };
      }
    );

    const results = await Promise.all([
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID),
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID),
    ]);

    expect(initialNormalizations).toBe(2);
    expect(results).toEqual([
      { projectId: PROJECT_ID, blocks: winnerBlocks },
      { projectId: PROJECT_ID, blocks: winnerBlocks },
    ]);
    expect(results).not.toContainEqual({
      projectId: PROJECT_ID,
      blocks: candidateB,
    });
    expect(normalizeDocumentState).toHaveBeenCalledTimes(2);
    expect(broadcastDocumentStateReset).toHaveBeenCalledTimes(1);
    expect(broadcastDocumentStateReset).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ token: { epoch: 3, revision: 5 } }),
      'normalization'
    );
  });

  it('propagates a second typed conflict after the single retry', async () => {
    readDocumentTransportState.mockResolvedValue(transportState());
    normalizeYjsState.mockResolvedValue(normalized('delta'));
    const secondConflict = new DocumentStateConflictError('changed again');
    normalizeDocumentState
      .mockRejectedValueOnce(new DocumentStateConflictError('changed'))
      .mockRejectedValueOnce(secondConflict);

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).rejects.toBe(secondConflict);
    expect(readDocumentTransportState).toHaveBeenCalledTimes(2);
    expect(normalizeDocumentState).toHaveBeenCalledTimes(2);
  });
});
