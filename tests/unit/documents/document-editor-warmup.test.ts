import { NORMAL_DOCUMENT_UPDATE_MAX_BYTES } from '../../../src/lib/documents/documentChunkedUpdate';
import { shouldDeferPendingDocumentEditor } from '../../../src/lib/documents/documentEditorWarmup';

describe('pending document editor warmup', () => {
  it('defers markdown whose UTF-8 payload exceeds the normal update limit', () => {
    expect(
      shouldDeferPendingDocumentEditor('a'.repeat(NORMAL_DOCUMENT_UPDATE_MAX_BYTES))
    ).toBe(false);
    expect(
      shouldDeferPendingDocumentEditor(
        'a'.repeat(NORMAL_DOCUMENT_UPDATE_MAX_BYTES + 1)
      )
    ).toBe(true);
    expect(
      shouldDeferPendingDocumentEditor(
        String.fromCodePoint(0x4e2d).repeat(
          Math.floor(NORMAL_DOCUMENT_UPDATE_MAX_BYTES / 3) + 1
        )
      )
    ).toBe(true);
  });
});
