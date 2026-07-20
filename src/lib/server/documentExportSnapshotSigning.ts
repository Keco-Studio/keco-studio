import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DocumentExportSource } from '@/lib/documents/documentExportSource';
import { getAgentConfirmationSigningSecret } from './agentConfirmationSigning';

const VERSION = 'document-export-snapshot-v1';
const MAX_TOKEN_LENGTH = 2_000_000;
const MAX_MARKDOWN_LENGTH = 500_000;

export type DocumentExportSnapshot = Omit<DocumentExportSource, 'snapshotToken'>;

function canonicalPayload(source: DocumentExportSnapshot): string {
  return JSON.stringify([
    VERSION,
    source.documentId,
    source.documentName,
    source.projectId,
    source.folderId,
    source.markdown,
    source.token.epoch,
    source.token.revision,
  ]);
}

function sign(payload: string): string {
  return createHmac('sha256', getAgentConfirmationSigningSecret())
    .update(payload, 'utf8')
    .digest('hex');
}

export function createDocumentExportSnapshotToken(source: DocumentExportSnapshot): string {
  const payload = canonicalPayload(source);
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  return `${encoded}.${sign(payload)}`;
}

function invalidToken(): never {
  throw new Error('Invalid document export snapshot token');
}

export function verifyDocumentExportSnapshotToken(raw: string): DocumentExportSnapshot {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_TOKEN_LENGTH) invalidToken();
  const separator = raw.lastIndexOf('.');
  if (separator <= 0 || separator === raw.length - 1) invalidToken();
  const encoded = raw.slice(0, separator);
  const provided = raw.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[0-9a-f]{64}$/.test(provided)) invalidToken();

  let payload: string;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    invalidToken();
  }
  const expected = Buffer.from(sign(payload), 'hex');
  const actual = Buffer.from(provided, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) invalidToken();

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    invalidToken();
  }
  if (!Array.isArray(parsed) || parsed.length !== 8 || parsed[0] !== VERSION) invalidToken();
  const [, documentId, documentName, projectId, folderId, markdown, epoch, revision] = parsed;
  if (
    typeof documentId !== 'string' ||
    typeof documentName !== 'string' ||
    typeof projectId !== 'string' ||
    (folderId !== null && typeof folderId !== 'string') ||
    typeof markdown !== 'string' ||
    markdown.length > MAX_MARKDOWN_LENGTH ||
    !Number.isInteger(epoch) ||
    !Number.isInteger(revision)
  ) invalidToken();

  return {
    documentId,
    documentName,
    projectId,
    folderId,
    markdown,
    token: { epoch, revision },
  };
}
