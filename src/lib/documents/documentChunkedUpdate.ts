import { isUuid } from '@/lib/utils/uuid';

export const NORMAL_DOCUMENT_UPDATE_MAX_BYTES = 256 * 1024;
export const DOCUMENT_UPDATE_CHUNK_BYTES = 128 * 1024;
export const MAX_DOCUMENT_UPDATE_BYTES = 8 * 1024 * 1024;
export const MAX_DOCUMENT_UPDATE_CHUNKS = 64;

export type ChunkedDocumentUpdateIdentity = {
  updateId: string;
  documentId: string;
  userId: string;
  epoch: number;
};

export type ChunkedDocumentUpdateManifest = ChunkedDocumentUpdateIdentity & {
  totalBytes: number;
  chunkCount: number;
  sha256: string;
};

function validateChunkCount(chunkCount: number): void {
  if (
    !Number.isSafeInteger(chunkCount) ||
    chunkCount < 1 ||
    chunkCount > MAX_DOCUMENT_UPDATE_CHUNKS
  ) {
    throw new Error('Invalid document update chunk count');
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = bytes.slice();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

export function sliceChunkedUpdate(bytes: Uint8Array): Uint8Array[] {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_UPDATE_BYTES) {
    throw new Error('Document update size is outside the chunked upload limits');
  }
  const chunkCount = Math.ceil(bytes.byteLength / DOCUMENT_UPDATE_CHUNK_BYTES);
  validateChunkCount(chunkCount);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += DOCUMENT_UPDATE_CHUNK_BYTES) {
    chunks.push(bytes.slice(offset, offset + DOCUMENT_UPDATE_CHUNK_BYTES));
  }
  return chunks;
}

export function validateChunkIndexes(
  indexes: unknown,
  chunkCount: number
): number[] {
  validateChunkCount(chunkCount);
  if (!Array.isArray(indexes)) {
    throw new Error('Document update chunk indexes must be an array');
  }
  const seen = new Set<number>();
  for (const index of indexes) {
    if (
      !Number.isSafeInteger(index) ||
      (index as number) < 0 ||
      (index as number) >= chunkCount ||
      seen.has(index as number)
    ) {
      throw new Error('Invalid document update chunk indexes');
    }
    seen.add(index as number);
  }
  return [...seen].sort((left, right) => left - right);
}

export function missingChunkIndexes(
  receivedIndexes: unknown,
  chunkCount: number
): number[] {
  const received = new Set(validateChunkIndexes(receivedIndexes, chunkCount));
  return Array.from({ length: chunkCount }, (_, index) => index).filter(
    (index) => !received.has(index)
  );
}

export async function createChunkedUpdateManifest(
  identity: ChunkedDocumentUpdateIdentity,
  bytes: Uint8Array
): Promise<ChunkedDocumentUpdateManifest> {
  if (!isUuid(identity.updateId) || !isUuid(identity.documentId) || !isUuid(identity.userId)) {
    throw new Error('Invalid chunked document update identity');
  }
  if (!Number.isSafeInteger(identity.epoch) || identity.epoch < 0) {
    throw new Error('Invalid document collaboration epoch');
  }
  if (
    bytes.byteLength <= NORMAL_DOCUMENT_UPDATE_MAX_BYTES ||
    bytes.byteLength > MAX_DOCUMENT_UPDATE_BYTES
  ) {
    throw new Error('Document update size is outside the chunked upload limits');
  }
  const chunks = sliceChunkedUpdate(bytes);
  return {
    ...identity,
    totalBytes: bytes.byteLength,
    chunkCount: chunks.length,
    sha256: await sha256Hex(bytes),
  };
}
