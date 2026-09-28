import { createHash } from 'node:crypto';
import {
  canonicalProjectAssetMimeType,
  projectAssetExtensionMatches,
  projectAssetMaxBytes,
  projectAssetMimeFromName,
} from '@/lib/services/projectAssetUploadContract';
import { projectAssetContentMatches } from '@/lib/services/projectAssetContent';

export const MAX_AGENT_GAME_MEDIA_BYTES = 10 * 1024 * 1024;

export interface GameMediaAttachment {
  fileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  bytes: Uint8Array;
}

export type GameMediaAttachmentRecord = Omit<GameMediaAttachment, 'bytes'>;

export async function validateGameMediaAttachment(file: File): Promise<GameMediaAttachment> {
  const fileName = file.name.trim();
  const mimeType = canonicalProjectAssetMimeType(file.type) ?? projectAssetMimeFromName(fileName);
  if (!fileName || fileName.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(fileName)
    || !mimeType || !projectAssetExtensionMatches(fileName, mimeType)) {
    throw new Error('Unsupported game-media name or format.');
  }
  if (file.size < 1 || file.size > Math.min(MAX_AGENT_GAME_MEDIA_BYTES, projectAssetMaxBytes(mimeType))) {
    throw new Error('Game media must be 10 MB or smaller.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || !projectAssetContentMatches(mimeType, bytes)) {
    throw new Error('Game-media bytes do not match the declared format.');
  }
  return {
    fileName, mimeType, fileSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes,
  };
}

export function gameMediaAttachmentRecord(attachment: GameMediaAttachment): GameMediaAttachmentRecord {
  const { fileName, mimeType, fileSize, sha256 } = attachment;
  return { fileName, mimeType, fileSize, sha256 };
}
