import type { SupabaseClient } from '@supabase/supabase-js';

const normalizeYjsState = jest.fn();
const readDocumentTransportState = jest.fn();
const appendDocumentYjsUpdates = jest.fn();

jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: { normalizeYjsState },
}));

jest.mock('@/lib/documents/documentStateGateway', () => ({
  readDocumentTransportState,
  appendDocumentYjsUpdates,
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

function normalized(normalizationUpdateBase64: string | null) {
  return {
    yjsStateBase64: 'normalized-state',
    markdown: '# <BlockAnchor />Heading',
    normalizationUpdateBase64,
    blocks,
  };
}

describe('ensureDocumentReferenceBlocks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appendDocumentYjsUpdates.mockResolvedValue({ acceptedIds: [] });
  });

  it('rejects a document whose collaborative Yjs state is not initialized', async () => {
    readDocumentTransportState.mockResolvedValue(
      transportState({ yjsStateBase64: null })
    );

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).rejects.toBeInstanceOf(DocumentCollaborationUnavailableError);
    expect(normalizeYjsState).not.toHaveBeenCalled();
    expect(appendDocumentYjsUpdates).not.toHaveBeenCalled();
  });

  it('returns canonical blocks without appending a no-op update', async () => {
    readDocumentTransportState.mockResolvedValue(transportState());
    normalizeYjsState.mockResolvedValue(normalized(null));

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).resolves.toEqual({ projectId: PROJECT_ID, blocks });
    expect(normalizeYjsState).toHaveBeenCalledWith('snapshot', ['tail']);
    expect(appendDocumentYjsUpdates).not.toHaveBeenCalled();
  });

  it('appends the normalization delta at the current epoch with a UUID update id', async () => {
    readDocumentTransportState.mockResolvedValue(transportState({ epoch: 7 }));
    normalizeYjsState.mockResolvedValue(normalized('normalization-delta'));

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).resolves.toEqual({ projectId: PROJECT_ID, blocks });
    expect(appendDocumentYjsUpdates).toHaveBeenCalledWith(client, {
      documentId: DOCUMENT_ID,
      epoch: 7,
      updates: [
        {
          id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          ),
          updateBase64: 'normalization-delta',
        },
      ],
    });
  });

  it('retries one conflict against freshly read document state', async () => {
    readDocumentTransportState
      .mockResolvedValueOnce(transportState({ epoch: 2, updateBase64: 'tail-a' }))
      .mockResolvedValueOnce(
        transportState({
          yjsStateBase64: 'fresh-snapshot',
          epoch: 3,
          updateBase64: 'tail-b',
        })
      );
    normalizeYjsState
      .mockResolvedValueOnce(normalized('delta-a'))
      .mockResolvedValueOnce(normalized('delta-b'));
    appendDocumentYjsUpdates
      .mockRejectedValueOnce(new DocumentStateConflictError('epoch changed'))
      .mockResolvedValueOnce({ acceptedIds: [] });

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).resolves.toEqual({ projectId: PROJECT_ID, blocks });
    expect(normalizeYjsState).toHaveBeenNthCalledWith(1, 'snapshot', ['tail-a']);
    expect(normalizeYjsState).toHaveBeenNthCalledWith(2, 'fresh-snapshot', [
      'tail-b',
    ]);
    expect(appendDocumentYjsUpdates).toHaveBeenNthCalledWith(
      2,
      client,
      expect.objectContaining({ epoch: 3 })
    );
  });

  it('propagates a second typed conflict after the single retry', async () => {
    readDocumentTransportState.mockResolvedValue(transportState());
    normalizeYjsState.mockResolvedValue(normalized('delta'));
    const secondConflict = new DocumentStateConflictError('changed again');
    appendDocumentYjsUpdates
      .mockRejectedValueOnce(new DocumentStateConflictError('changed'))
      .mockRejectedValueOnce(secondConflict);

    await expect(
      ensureDocumentReferenceBlocks(client, DOCUMENT_ID)
    ).rejects.toBe(secondConflict);
    expect(readDocumentTransportState).toHaveBeenCalledTimes(2);
    expect(appendDocumentYjsUpdates).toHaveBeenCalledTimes(2);
  });
});
