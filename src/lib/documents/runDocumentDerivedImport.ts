/**
 * Run document Generate conversation / Generate table without ImportScriptModal.
 * Uses the same /api/import-script Story IR pipeline; progress is emitted for
 * the document-page banner.
 */

import { consumeImportStream } from '@/lib/import-script-stream';
import { toScriptImportPlainText } from '@/lib/documents/scriptImportPlainText';
import type { DocumentExportSource } from '@/lib/documents/documentExportSource';
import type { DocumentExportType } from '@/lib/services/documentDerivedLibraryService';
import type { ImportScriptResult } from '@/lib/services/scriptImportService';
import {
  defaultDerivedLibraryName,
  notifyDocumentDerivedImportProgress,
} from '@/lib/documents/documentDerivedImportProgress';

export async function runDocumentDerivedImport(input: {
  source: DocumentExportSource;
  exportType: DocumentExportType;
  accessToken: string;
}): Promise<ImportScriptResult> {
  const { source, exportType, accessToken } = input;
  const startedAt = Date.now();
  const kindLabel = exportType === 'table' ? 'table' : 'conversation';

  notifyDocumentDerivedImportProgress({
    projectId: source.projectId,
    documentId: source.documentId,
    exportType,
    phase: 'preparing',
    label: `Preparing ${kindLabel}…`,
    startedAt,
  });

  const plainText = toScriptImportPlainText(source.markdown);
  if (!plainText.trim()) {
    const error = 'Document is empty';
    notifyDocumentDerivedImportProgress({
      projectId: source.projectId,
      documentId: source.documentId,
      exportType,
      phase: 'error',
      label: error,
      error,
      startedAt,
    });
    throw new Error(error);
  }

  const libraryName = defaultDerivedLibraryName(source.documentName, exportType);
  const formData = new FormData();
  formData.append('projectId', source.projectId);
  formData.append('sourceDocumentId', source.documentId);
  formData.append('snapshotToken', source.snapshotToken ?? '');
  formData.append('documentExportType', exportType);
  formData.append('libraryName', libraryName);

  notifyDocumentDerivedImportProgress({
    projectId: source.projectId,
    documentId: source.documentId,
    exportType,
    phase: 'running',
    label: `Generating ${kindLabel}…`,
    startedAt,
  });

  try {
    const response = await fetch('/api/import-script', {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });

    const result = await consumeImportStream(response, (progress) => {
      notifyDocumentDerivedImportProgress({
        projectId: source.projectId,
        documentId: source.documentId,
        exportType,
        phase: 'running',
        label: progress.message || `Generating ${kindLabel}…`,
        startedAt,
      });
    });

    notifyDocumentDerivedImportProgress({
      projectId: source.projectId,
      documentId: source.documentId,
      exportType,
      phase: 'success',
      label:
        exportType === 'table'
          ? 'Table generated.'
          : 'Conversation generated.',
      startedAt,
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    notifyDocumentDerivedImportProgress({
      projectId: source.projectId,
      documentId: source.documentId,
      exportType,
      phase: 'error',
      label: message,
      error: message,
      startedAt,
    });
    throw err;
  }
}
