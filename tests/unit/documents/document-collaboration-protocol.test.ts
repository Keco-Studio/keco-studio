import { randomUUID } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import {
  COLLABORATION_MAX_UPDATE_BYTES,
  decodeBase64,
  documentCollabTopic,
  encodeBase64,
  parseDocumentCollaborationEvent,
} from '@/lib/documents/documentCollaborationProtocol';

const documentId = randomUUID();
const requesterId = randomUUID();
const updateId = randomUUID();
const encoded = encodeBase64(new Uint8Array([0, 1, 2, 127, 128, 255]));

describe('document collaboration protocol', () => {
  it('round-trips bytes with the Node codec', () => {
    expect(Array.from(decodeBase64(encoded))).toEqual([0, 1, 2, 127, 128, 255]);
  });

  it('round-trips bytes with the browser-compatible codec path', () => {
    const nodeBuffer = globalThis.Buffer;
    // @ts-expect-error Exercise the browser branch in the Node test environment.
    globalThis.Buffer = undefined;
    try {
      const browserEncoded = encodeBase64(new Uint8Array([3, 4, 250]));
      expect(Array.from(decodeBase64(browserEncoded))).toEqual([3, 4, 250]);
    } finally {
      globalThis.Buffer = nodeBuffer;
    }
  });

  it('builds only canonical document-scoped topics', () => {
    expect(documentCollabTopic(documentId)).toBe(`doc-collab:${documentId}`);
    expect(() => documentCollabTopic('not-a-uuid')).toThrow(/document id/i);
  });

  it.each([
    '',
    'not-base64',
    'AQ=',
    'AQID====',
    'AQID\n',
  ])('rejects malformed or non-canonical base64: %j', (value) => {
    expect(() => decodeBase64(value)).toThrow(/base64/i);
  });

  it('parses every v1 event variant', () => {
    const cases = [
      [
        'yjs-update',
        { v: 1, documentId, epoch: 2, updateId, updateBase64: encoded },
      ],
      [
        'yjs-sync-request',
        { v: 1, documentId, epoch: 2, requesterId, stateVectorBase64: encoded },
      ],
      [
        'yjs-sync-response',
        { v: 1, documentId, epoch: 2, requesterId, updateBase64: encoded },
      ],
      [
        'yjs-awareness',
        { v: 1, documentId, epoch: 2, updateBase64: encoded },
      ],
      [
        'document-state-reset',
        {
          v: 1,
          documentId,
          epoch: 3,
          revision: 7,
          reason: 'restore',
          updatedAt: '2026-07-14T12:00:00.000Z',
        },
      ],
      [
        'document-state-reset',
        {
          v: 1,
          documentId,
          epoch: 4,
          revision: 8,
          reason: 'normalization',
          updatedAt: '2026-07-17T01:00:00.000Z',
        },
      ],
    ] as const;

    for (const [event, payload] of cases) {
      expect(parseDocumentCollaborationEvent(event, payload)).toMatchObject(payload);
    }
  });

  it.each([
    ['unknown', { v: 1, documentId, epoch: 0 }],
    ['yjs-update', { v: 2, documentId, epoch: 0, updateId, updateBase64: encoded }],
    ['yjs-update', { v: 1, documentId: randomUUID(), epoch: 2, updateId, updateBase64: encoded }],
    ['yjs-update', { v: 1, documentId, epoch: 3, updateId, updateBase64: encoded }],
    ['yjs-update', { v: 1, documentId, epoch: 2, updateId, updateBase64: encoded, extra: true }],
    ['yjs-sync-request', { v: 1, documentId, epoch: 2, requesterId: 'bad', stateVectorBase64: encoded }],
  ])('rejects wrong event scope or shape: %s', (event, payload) => {
    expect(() =>
      parseDocumentCollaborationEvent(event, payload, { documentId, epoch: 2 })
    ).toThrow(/collaboration/i);
  });

  it('rejects an oversized decoded update before it reaches Yjs', () => {
    const oversized = encodeBase64(
      new Uint8Array(COLLABORATION_MAX_UPDATE_BYTES + 1)
    );
    expect(() =>
      parseDocumentCollaborationEvent('yjs-update', {
        v: 1,
        documentId,
        epoch: 2,
        updateId,
        updateBase64: oversized,
      })
    ).toThrow(/size/i);
  });

  it('exposes typed collaboration state errors', async () => {
    const types = await import('@/lib/documents/documentStateTypes');
    const token = { epoch: 2, revision: 4 };
    expect(new types.DocumentStateConflictError('changed', token).token).toEqual(token);
    expect(new types.DocumentCollaborationUnavailableError('offline').name).toBe(
      'DocumentCollaborationUnavailableError'
    );
  });
});
