import { createHash } from 'node:crypto';

export const MAX_AGENT_MAP_REFERENCE_BYTES = 5 * 1024 * 1024;

export interface MapReferenceAttachment {
  fileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  normalizedSha256: string;
  width: number;
  height: number;
  bytes: Uint8Array;
  normalizedBytes: Uint8Array;
}

export type MapReferenceAttachmentRecord = Omit<MapReferenceAttachment, 'bytes' | 'normalizedBytes'>;

const mimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function validateMapReferenceAttachment(file: File): Promise<MapReferenceAttachment> {
  const fileName = file.name.trim();
  const mimeType = file.type.split(';', 1)[0].toLowerCase();
  if (!fileName || fileName.length > 160 || /[\u0000-\u001f\u007f/\\]/.test(fileName)
    || !mimeTypes.has(mimeType) || file.size < 1 || file.size > MAX_AGENT_MAP_REFERENCE_BYTES) {
    throw new Error('Invalid map reference attachment.');
  }
  const { normalizeReferenceImage } = await import('@/lib/server/createMapReferenceService');
  const normalized = await normalizeReferenceImage(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) throw new Error('Invalid map reference attachment.');
  return { fileName, mimeType, fileSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    normalizedSha256: normalized.sha256, width: normalized.width, height: normalized.height,
    bytes, normalizedBytes: new Uint8Array(normalized.bytes) };
}

export function mapReferenceAttachmentRecord(attachment: MapReferenceAttachment): MapReferenceAttachmentRecord {
  const { fileName, mimeType, fileSize, sha256, normalizedSha256, width, height } = attachment;
  return { fileName, mimeType, fileSize, sha256, normalizedSha256, width, height };
}
