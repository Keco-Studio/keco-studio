import {
  registerDocumentFlushHandler,
  flushOpenDocumentEditor,
} from '../../../src/lib/documents/documentFlushRegistry';

describe('documentFlushRegistry', () => {
  it('returns true when no editor is mounted', async () => {
    await expect(flushOpenDocumentEditor()).resolves.toBe(true);
  });

  it('returns true when the flush succeeds', async () => {
    const unregister = registerDocumentFlushHandler(async () => {});
    await expect(flushOpenDocumentEditor()).resolves.toBe(true);
    unregister();
  });

  it('returns false when the flush fails, so callers can block navigation', async () => {
    const unregister = registerDocumentFlushHandler(async () => {
      throw new Error('save failed');
    });
    await expect(flushOpenDocumentEditor()).resolves.toBe(false);
    unregister();
  });

  it('unregister only clears the handler it registered', async () => {
    const unregisterA = registerDocumentFlushHandler(async () => {
      throw new Error('A still active');
    });
    const unregisterB = registerDocumentFlushHandler(async () => {});
    // B replaced A as the active handler; unregistering A must be a no-op.
    unregisterA();
    await expect(flushOpenDocumentEditor()).resolves.toBe(true);
    unregisterB();
  });
});
