import {
  DOCUMENT_UPDATE_CHUNK_BYTES,
  MAX_DOCUMENT_UPDATE_BYTES,
  createChunkedUpdateManifest,
  missingChunkIndexes,
  sha256Hex,
  sliceChunkedUpdate,
  validateChunkIndexes,
} from '@/lib/documents/documentChunkedUpdate';

const UPDATE_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

describe('documentChunkedUpdate', () => {
  it.each([
    [262_145, [DOCUMENT_UPDATE_CHUNK_BYTES, DOCUMENT_UPDATE_CHUNK_BYTES, 1]],
    [270_019, [DOCUMENT_UPDATE_CHUNK_BYTES, DOCUMENT_UPDATE_CHUNK_BYTES, 7_875]],
    [MAX_DOCUMENT_UPDATE_BYTES, Array(64).fill(DOCUMENT_UPDATE_CHUNK_BYTES)],
  ])('slices %i bytes into copied deterministic chunks', (size, expectedSizes) => {
    const bytes = new Uint8Array(size);
    bytes[size - 1] = 9;
    const chunks = sliceChunkedUpdate(bytes);

    expect(chunks.map((chunk) => chunk.byteLength)).toEqual(expectedSizes);
    chunks.at(-1)![chunks.at(-1)!.byteLength - 1] = 7;
    expect(bytes[size - 1]).toBe(9);
  });

  it('rejects empty and over-limit input', () => {
    expect(() => sliceChunkedUpdate(new Uint8Array())).toThrow(/size/i);
    expect(() => sliceChunkedUpdate(new Uint8Array(MAX_DOCUMENT_UPDATE_BYTES + 1))).toThrow(
      /size/i
    );
  });

  it('hashes the exact typed-array view as lowercase SHA-256', async () => {
    const backing = new Uint8Array(262_147);
    backing[0] = 1;
    backing[262_146] = 1;
    await expect(sha256Hex(backing.subarray(1, 262_146))).resolves.toBe(
      'b27a032984ea8a6bec700c3d6f63f8fcfbf8ff8ef87e972891feda4eea4aad0c'
    );
  });

  it('creates a validated immutable manifest only for large updates', async () => {
    await expect(
      createChunkedUpdateManifest(
        { updateId: UPDATE_ID, documentId: DOCUMENT_ID, userId: USER_ID, epoch: 4 },
        new Uint8Array(262_145)
      )
    ).resolves.toEqual({
      updateId: UPDATE_ID,
      documentId: DOCUMENT_ID,
      userId: USER_ID,
      epoch: 4,
      totalBytes: 262_145,
      chunkCount: 3,
      sha256: 'b27a032984ea8a6bec700c3d6f63f8fcfbf8ff8ef87e972891feda4eea4aad0c',
    });
    await expect(
      createChunkedUpdateManifest(
        { updateId: UPDATE_ID, documentId: DOCUMENT_ID, userId: USER_ID, epoch: 4 },
        new Uint8Array(262_144)
      )
    ).rejects.toThrow(/size/i);
    await expect(
      createChunkedUpdateManifest(
        { updateId: 'invalid', documentId: DOCUMENT_ID, userId: USER_ID, epoch: 4 },
        new Uint8Array(262_145)
      )
    ).rejects.toThrow(/identity/i);
  });

  it('validates, sorts, and complements chunk indexes', () => {
    expect(validateChunkIndexes([2, 0], 3)).toEqual([0, 2]);
    expect(missingChunkIndexes([2, 0], 3)).toEqual([1]);
    expect(() => validateChunkIndexes([0, 0], 3)).toThrow(/indexes/i);
    expect(() => validateChunkIndexes([3], 3)).toThrow(/indexes/i);
    expect(() => validateChunkIndexes([1.5], 3)).toThrow(/indexes/i);
    expect(() => validateChunkIndexes('0', 3)).toThrow(/array/i);
  });
});
