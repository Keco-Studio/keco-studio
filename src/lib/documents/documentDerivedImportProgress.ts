/**
 * Progress bus for silent document Generate conversation / Generate table.
 * DocumentEditor mirrors this into the shared bottom toast — no ImportScriptModal.
 */

import type { DocumentExportType } from '@/lib/services/documentDerivedLibraryService';

export const DOCUMENT_DERIVED_IMPORT_PROGRESS_EVENT =
  'document-derived-import:progress';

/** Generating label for the shared toast; errors show the real message instead. */
export const DOCUMENT_DERIVED_IMPORT_UI_LABEL = {
  generating: 'Generating…',
  failed: 'Generation failed.',
} as const;

export type DocumentDerivedImportPhase =
  | 'preparing'
  | 'running'
  | 'success'
  | 'error';

export type DocumentDerivedImportProgress = {
  projectId: string;
  documentId: string;
  exportType: DocumentExportType;
  phase: DocumentDerivedImportPhase;
  label: string;
  startedAt: number;
  error?: string;
};

const latestByDocument = new Map<string, DocumentDerivedImportProgress>();

function progressKey(projectId: string, documentId: string): string {
  return `${projectId}:${documentId}`;
}

export function getDocumentDerivedImportProgress(
  projectId: string,
  documentId: string
): DocumentDerivedImportProgress | null {
  return latestByDocument.get(progressKey(projectId, documentId)) ?? null;
}

export function clearDocumentDerivedImportProgress(
  projectId: string,
  documentId: string
): void {
  latestByDocument.delete(progressKey(projectId, documentId));
}

export function notifyDocumentDerivedImportProgress(
  detail: DocumentDerivedImportProgress
): void {
  latestByDocument.set(progressKey(detail.projectId, detail.documentId), detail);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(DOCUMENT_DERIVED_IMPORT_PROGRESS_EVENT, { detail })
  );
}

export function defaultDerivedLibraryName(
  documentName: string,
  exportType: DocumentExportType
): string {
  const base = documentName.trim() || 'Document';
  return exportType === 'table' ? `${base} Table` : `${base} Conversation`;
}
