import { NORMAL_DOCUMENT_UPDATE_MAX_BYTES } from './documentChunkedUpdate';

const utf8Encoder = new TextEncoder();

export function shouldDeferPendingDocumentEditor(markdown: string): boolean {
  return utf8Encoder.encode(markdown).byteLength > NORMAL_DOCUMENT_UPDATE_MAX_BYTES;
}
