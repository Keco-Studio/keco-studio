/**
 * Run document Generate conversation / Generate table without ImportScriptModal.
 * Uses the same /api/import-script Story IR pipeline; the document page shows a
 * brief Generating / Generation failed toast — detailed steps go to the console.
 */

import { consumeImportStream } from '@/lib/import-script-stream';
import { toScriptImportPlainText } from '@/lib/documents/scriptImportPlainText';
import type { DocumentExportSource } from '@/lib/documents/documentExportSource';
import type { DocumentExportType } from '@/lib/services/documentDerivedLibraryService';
import type { ImportScriptResult } from '@/lib/services/scriptImportService';
import {
  defaultDerivedLibraryName,
  notifyDocumentDerivedImportProgress,
  DOCUMENT_DERIVED_IMPORT_UI_LABEL,
  type DocumentDerivedImportPhase,
} from '@/lib/documents/documentDerivedImportProgress';

function logDerivedImport(
  phase: DocumentDerivedImportPhase,
  detail: string,
  meta: { projectId: string; documentId: string; exportType: DocumentExportType }
): void {
  console.info('[document-derived-import]', phase, detail, meta);
}

export async function runDocumentDerivedImport(input: {
  source: DocumentExportSource;
  exportType: DocumentExportType;
  accessToken: string;
}): Promise<ImportScriptResult> {
  const { source, exportType, accessToken } = input;
  const startedAt = Date.now();
  const kindLabel = exportType === 'table' ? 'table' : 'conversation';
  const meta = {
    projectId: source.projectId,
    documentId: source.documentId,
    exportType,
  };

  logDerivedImport('preparing', `Preparing ${kindLabel}…`, meta);
  notifyDocumentDerivedImportProgress({
    ...meta,
    phase: 'preparing',
    label: DOCUMENT_DERIVED_IMPORT_UI_LABEL.generating,
    startedAt,
  });

  const plainText = toScriptImportPlainText(source.markdown);
  if (!plainText.trim()) {
    const error = 'Document is empty';
    logDerivedImport('error', error, meta);
    notifyDocumentDerivedImportProgress({
      ...meta,
      phase: 'error',
      label: DOCUMENT_DERIVED_IMPORT_UI_LABEL.failed,
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

  logDerivedImport('running', `Generating ${kindLabel}…`, meta);
  notifyDocumentDerivedImportProgress({
    ...meta,
    phase: 'running',
    label: DOCUMENT_DERIVED_IMPORT_UI_LABEL.generating,
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
      const detail = progress.message || `Generating ${kindLabel}…`;
      logDerivedImport('running', detail, meta);
      notifyDocumentDerivedImportProgress({
        ...meta,
        phase: 'running',
        label: DOCUMENT_DERIVED_IMPORT_UI_LABEL.generating,
        startedAt,
      });
    });

    const successLabel =
      exportType === 'table' ? 'Table generated.' : 'Conversation generated.';
    logDerivedImport('success', successLabel, meta);
    notifyDocumentDerivedImportProgress({
      ...meta,
      phase: 'success',
      label: successLabel,
      startedAt,
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    logDerivedImport('error', message, meta);
    notifyDocumentDerivedImportProgress({
      ...meta,
      phase: 'error',
      label: DOCUMENT_DERIVED_IMPORT_UI_LABEL.failed,
      error: message,
      startedAt,
    });
    throw err;
  }
}
