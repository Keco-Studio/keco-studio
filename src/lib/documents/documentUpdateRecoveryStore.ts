import type { ChunkedDocumentUpdateManifest } from './documentChunkedUpdate';

const DATABASE_NAME = 'keco-document-collaboration';
const DATABASE_VERSION = 1;
const STORE_NAME = 'chunked-update-recovery';
const USER_DOCUMENT_INDEX = 'by-user-document';

export type DocumentUpdateRecoveryRecord = ChunkedDocumentUpdateManifest & {
  bytes: Uint8Array;
  createdAt: string;
};

type StoredDocumentUpdateRecoveryRecord = DocumentUpdateRecoveryRecord & {
  key: string;
};

export interface DocumentUpdateRecoveryStore {
  put(record: DocumentUpdateRecoveryRecord): Promise<void>;
  listForDocument(
    userId: string,
    documentId: string
  ): Promise<DocumentUpdateRecoveryRecord[]>;
  delete(key: string): Promise<void>;
}

export class DocumentUpdateRecoveryStoreUnavailableError extends Error {
  constructor() {
    super('IndexedDB is unavailable');
    this.name = 'DocumentUpdateRecoveryStoreUnavailableError';
  }
}

export function recoveryRecordKey(
  record: Pick<
    DocumentUpdateRecoveryRecord,
    'userId' | 'documentId' | 'epoch' | 'updateId'
  >
): string {
  return `${record.userId}:${record.documentId}:${record.epoch}:${record.updateId}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function cloneRecord(
  record: DocumentUpdateRecoveryRecord
): DocumentUpdateRecoveryRecord {
  return { ...record, bytes: record.bytes.slice() };
}

export class IndexedDbDocumentUpdateRecoveryStore
  implements DocumentUpdateRecoveryStore
{
  private readonly factory: IDBFactory | null;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(factory: IDBFactory | null = globalThis.indexedDB ?? null) {
    this.factory = factory;
  }

  private database(): Promise<IDBDatabase> {
    if (!this.factory) {
      return Promise.reject(new DocumentUpdateRecoveryStoreUnavailableError());
    }
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory!.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (database.objectStoreNames.contains(STORE_NAME)) return;
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex(USER_DOCUMENT_INDEX, ['userId', 'documentId']);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error ?? new Error('IndexedDB could not be opened'));
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(new Error('IndexedDB open request was blocked'));
      };
    });
    return this.databasePromise;
  }

  async put(record: DocumentUpdateRecoveryRecord): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completion = transactionDone(transaction);
    const stored: StoredDocumentUpdateRecoveryRecord = {
      ...cloneRecord(record),
      key: recoveryRecordKey(record),
    };
    transaction.objectStore(STORE_NAME).put(stored);
    await completion;
  }

  async listForDocument(
    userId: string,
    documentId: string
  ): Promise<DocumentUpdateRecoveryRecord[]> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const completion = transactionDone(transaction);
    const request = transaction
      .objectStore(STORE_NAME)
      .index(USER_DOCUMENT_INDEX)
      .getAll([userId, documentId]);
    const rows = await requestResult(request) as StoredDocumentUpdateRecoveryRecord[];
    await completion;
    return rows
      .map(({ key: _key, ...record }) => cloneRecord(record))
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.updateId.localeCompare(right.updateId)
      );
  }

  async delete(key: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completion = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).delete(key);
    await completion;
  }
}
