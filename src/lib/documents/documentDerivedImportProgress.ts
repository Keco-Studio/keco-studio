/**
 * Progress bus for silent document Generate conversation / Generate table.
 * Drives the shared bottom toast directly so Generating stays visible even when
 * DocumentEditor is unmounted (e.g. after navigating to a newly created library).
 */

import type { DocumentExportType } from '@/lib/services/documentDerivedLibraryService';
import { dismissToast, showToast } from '@/lib/utils/toast';

export const DOCUMENT_DERIVED_IMPORT_PROGRESS_EVENT =
  'document-derived-import:progress';

/** Generating label for the shared toast; errors show the real message instead. */
export const DOCUMENT_DERIVED_IMPORT_UI_LABEL = {
  generating: 'Generating…',
  failed: 'Generation failed.',
} as const;

export const DOCUMENT_DERIVED_IMPORT_PROGRESS_TEST_ID =
  'document-derived-import-progress';

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

function mirrorProgressToast(detail: DocumentDerivedImportProgress): void {
  if (detail.phase === 'preparing' || detail.phase === 'running') {
    showToast({
      message: DOCUMENT_DERIVED_IMPORT_UI_LABEL.generating,
      type: 'info',
      duration: 0,
      testId: DOCUMENT_DERIVED_IMPORT_PROGRESS_TEST_ID,
    });
    return;
  }

  if (detail.phase === 'error') {
    showToast({
      message:
        detail.error ||
        detail.label ||
        DOCUMENT_DERIVED_IMPORT_UI_LABEL.failed,
      type: 'error',
      duration: 8000,
      testId: DOCUMENT_DERIVED_IMPORT_PROGRESS_TEST_ID,
    });
    window.setTimeout(() => {
      const current = latestByDocument.get(
        progressKey(detail.projectId, detail.documentId)
      );
      if (
        current?.startedAt === detail.startedAt &&
        current.phase === 'error'
      ) {
        latestByDocument.delete(
          progressKey(detail.projectId, detail.documentId)
        );
      }
    }, 8000);
    return;
  }

  if (detail.phase === 'success') {
    // Keep Generating visible briefly so navigation-bound clicks (Playwright
    // waits for router.push) and users can still observe progress.
    const key = progressKey(detail.projectId, detail.documentId);
    const startedAt = detail.startedAt;
    const minVisibleMs = 600;
    const dismiss = () => {
      const current = latestByDocument.get(key);
      if (!current || current.startedAt !== startedAt) return;
      dismissToast();
      latestByDocument.delete(key);
    };
    const elapsed = Date.now() - startedAt;
    if (elapsed < minVisibleMs) {
      window.setTimeout(dismiss, minVisibleMs - elapsed);
    } else {
      dismiss();
    }
  }
}

export function notifyDocumentDerivedImportProgress(
  detail: DocumentDerivedImportProgress
): void {
  latestByDocument.set(progressKey(detail.projectId, detail.documentId), detail);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(DOCUMENT_DERIVED_IMPORT_PROGRESS_EVENT, { detail })
  );
  mirrorProgressToast(detail);
}

export function defaultDerivedLibraryName(
  documentName: string,
  exportType: DocumentExportType
): string {
  const base = documentName.trim() || 'Document';
  return exportType === 'table' ? `${base} Table` : `${base} Conversation`;
}
