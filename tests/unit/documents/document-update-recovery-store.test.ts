import { IDBFactory } from 'fake-indexeddb';
import {
  IndexedDbDocumentUpdateRecoveryStore,
  recoveryRecordKey,
  type DocumentUpdateRecoveryRecord,
} from '@/lib/documents/documentUpdateRecoveryStore';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';

function record(
  updateId: string,
  createdAt: string,
  overrides: Partial<DocumentUpdateRecoveryRecord> = {}
): DocumentUpdateRecoveryRecord {
  return {
    updateId,
    documentId: DOCUMENT_ID,
    userId: USER_ID,
    epoch: 2,
    totalBytes: 262_145,
    chunkCount: 3,
    sha256: 'a'.repeat(64),
    bytes: new Uint8Array([1, 2, 3]),
    createdAt,
    ...overrides,
  };
}

describe('IndexedDbDocumentUpdateRecoveryStore', () => {
  it('round-trips isolated cloned records in stable order and deletes by key', async () => {
    const store = new IndexedDbDocumentUpdateRecoveryStore(new IDBFactory());
    const later = record(
      '33333333-3333-4333-8333-333333333333',
      '2026-09-07T02:00:00.000Z'
    );
    const firstAtSameTime = record(
      '11111111-1111-4111-8111-111111111111',
      '2026-09-07T01:00:00.000Z'
    );
    const secondAtSameTime = record(
      '22222222-2222-4222-8222-222222222222',
      '2026-09-07T01:00:00.000Z'
    );
    const otherDocument = record(
      '44444444-4444-4444-8444-444444444444',
      '2026-09-07T00:00:00.000Z',
      { documentId: '55555555-5555-4555-8555-555555555555' }
    );

    await store.put(later);
    await store.put(secondAtSameTime);
    await store.put(firstAtSameTime);
    await store.put(otherDocument);
    later.bytes[0] = 9;

    const rows = await store.listForDocument(USER_ID, DOCUMENT_ID);
    expect(rows.map((item) => item.updateId)).toEqual([
      firstAtSameTime.updateId,
      secondAtSameTime.updateId,
      later.updateId,
    ]);
    expect(rows[2]!.bytes).toEqual(new Uint8Array([1, 2, 3]));
    rows[2]!.bytes[0] = 8;
    expect((await store.listForDocument(USER_ID, DOCUMENT_ID))[2]!.bytes[0]).toBe(1);

    await store.delete(recoveryRecordKey(firstAtSameTime));
    expect((await store.listForDocument(USER_ID, DOCUMENT_ID)).map((item) => item.updateId)).toEqual([
      secondAtSameTime.updateId,
      later.updateId,
    ]);
  });

  it('fails explicitly when IndexedDB is unavailable', async () => {
    const store = new IndexedDbDocumentUpdateRecoveryStore(null);
    await expect(store.listForDocument(USER_ID, DOCUMENT_ID)).rejects.toThrow(
      'IndexedDB is unavailable'
    );
  });
});
