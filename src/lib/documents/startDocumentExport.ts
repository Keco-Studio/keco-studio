import { buildDesignMessage } from '@/lib/design-message';
import {
  DESIGN_UPLOAD_EVENT,
  saveDesignHandoff,
} from '@/lib/design-upload-handoff';
import type { DocumentExportSource } from '@/lib/documents/documentExportSource';

function isDocumentExportSource(value: unknown): value is DocumentExportSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as DocumentExportSource;
  return (
    typeof source.documentId === 'string' &&
    typeof source.documentName === 'string' &&
    typeof source.projectId === 'string' &&
    typeof source.markdown === 'string' &&
    !!source.token &&
    typeof source.token.epoch === 'number' &&
    typeof source.token.revision === 'number'
  );
}

export async function fetchDocumentExportSource(
  documentId: string,
  accessToken: string
): Promise<DocumentExportSource> {
  const response = await fetch(`/api/documents/${documentId}/export-source`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Document export source failed');
  const payload = (await response.json()) as { source?: unknown };
  if (!isDocumentExportSource(payload.source) || payload.source.documentId !== documentId) {
    throw new Error('Document export source failed');
  }
  return payload.source;
}

export function handoffDocumentTableExport(
  projectId: string,
  source: DocumentExportSource
): void {
  const message = buildDesignMessage({
    fileName: source.documentName,
    documentText: source.markdown,
    intent: 'tables',
    documentId: source.documentId,
    sourceKind: 'project-document',
  });
  saveDesignHandoff(projectId, {
    message,
    fileName: source.documentName,
    documentId: source.documentId,
    documentExport: {
      sourceDocumentId: source.documentId,
      exportType: 'table',
      snapshotToken: source.snapshotToken,
    },
  });
  window.dispatchEvent(
    new CustomEvent(DESIGN_UPLOAD_EVENT, { detail: { projectId } })
  );
}
