import type { SupabaseClient } from '@supabase/supabase-js';

const normalizeYjsState = jest.fn();
const readDocumentTransportState = jest.fn();
const compactDocumentState = jest.fn();

jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: { normalizeYjsState },
}));

jest.mock('@/lib/documents/documentStateGateway', () => ({
  readDocumentTransportState,
  compactDocumentState,
}));

import { ensureDocumentReferenceBlocks } from '@/lib/documents/documentReferenceBlocks';
import {
  DocumentCollaborationUnavailableError,
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
  });

  it('rejects a document whose collaborative Yjs state is not initialized', async () => {
    readDocumentTransportState.mockResolvedValue(
      transportState({ yjsStateBase64: null })
    );

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).rejects.toBeInstanceOf(DocumentCollaborationUnavailableError);
    expect(normalizeYjsState).not.toHaveBeenCalled();
    expect(compactDocumentState).not.toHaveBeenCalled();
  });

  it('returns canonical blocks without compacting a no-op normalization', async () => {
    readDocumentTransportState.mockResolvedValue(transportState());
    normalizeYjsState.mockResolvedValue(normalized(null));

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).resolves.toEqual({ projectId: PROJECT_ID, blocks });
    expect(normalizeYjsState).toHaveBeenCalledWith('snapshot', ['tail']);
    expect(compactDocumentState).not.toHaveBeenCalled();
  });

  it('returns blocks decoded from the exact state committed by compaction', async () => {
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
    compactDocumentState.mockResolvedValue({
      ...transportState({ epoch: 7 }),
      markdown: '# Committed',
      yjsStateBase64: 'committed-state',
      updateTail: [],
      token: { epoch: 7, revision: 5 },
    });

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).resolves.toEqual({ projectId: PROJECT_ID, blocks: committedBlocks });
    expect(compactDocumentState).toHaveBeenCalledWith(client, {
      documentId: DOCUMENT_ID,
      expected: { epoch: 7, revision: 4 },
    });
    expect(normalizeYjsState).toHaveBeenNthCalledWith(2, 'committed-state', []);
  });

  it('returns only the winning IDs when same-token normalizers race', async () => {
    const candidateA = blocksWithId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const candidateB = blocksWithId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const winnerBlocks = candidateA;
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
      token: { epoch: 2, revision },
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
    compactDocumentState.mockImplementation(
      async (_client: SupabaseClient, input: { expected: { revision: number } }) => {
        if (input.expected.revision !== revision) {
          throw new DocumentStateConflictError('changed', {
            epoch: 2,
            revision,
          });
        }
        revision += 1;
        storedState = 'winner-state';
        return {
          ...transportState({ yjsStateBase64: storedState }),
          markdown: '# Winner',
          yjsStateBase64: storedState,
          updateTail: [],
          token: { epoch: 2, revision },
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
    expect(compactDocumentState).toHaveBeenCalledTimes(2);
  });

  it('propagates a second typed conflict after the single retry', async () => {
    readDocumentTransportState.mockResolvedValue(transportState());
    normalizeYjsState.mockResolvedValue(normalized('delta'));
    const secondConflict = new DocumentStateConflictError('changed again');
    compactDocumentState
      .mockRejectedValueOnce(new DocumentStateConflictError('changed'))
      .mockRejectedValueOnce(secondConflict);

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).rejects.toBe(secondConflict);
    expect(readDocumentTransportState).toHaveBeenCalledTimes(2);
    expect(compactDocumentState).toHaveBeenCalledTimes(2);
  });
});
