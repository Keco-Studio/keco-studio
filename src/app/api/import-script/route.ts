import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { importStoryDocument } from '@/lib/services/scriptImportService';
import { resolveStoryForImport } from '@/lib/services/scriptConversionService';
import { getDocumentExportSource } from '@/lib/server/documentExportSourceService';
import { verifyDocumentExportSnapshotToken, type DocumentExportSnapshot } from '@/lib/server/documentExportSnapshotSigning';
import { toScriptImportPlainText } from '@/lib/documents/scriptImportPlainText';
import { getOrResolveStory } from '@/lib/import-script-conversion-cache';
import type { StoryPlanProgressEvent as ImportProgressEvent } from '@/lib/story-plan/conversion';

export const maxDuration = 300;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['txt', 'md']);

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export const POST = withAuth(async function POST(
  request,
  _context,
  { supabase, user }
) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const projectId = String(formData.get('projectId') ?? '').trim();
  const folderId = String(formData.get('folderId') ?? '').trim();
  const sourceDocumentId = String(formData.get('sourceDocumentId') ?? '').trim();
  const snapshotToken = String(formData.get('snapshotToken') ?? '').trim();
  const rawDocumentExportType = String(formData.get('documentExportType') ?? '').trim();
  const documentExportType =
    rawDocumentExportType === 'table' || rawDocumentExportType === 'script'
      ? rawDocumentExportType
      : 'script';
  const libraryName = String(formData.get('libraryName') ?? '').trim();
  const file = formData.get('file');
  const uploadedFile = file instanceof File ? file : undefined;

  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  if (sourceDocumentId && !isUuid(sourceDocumentId)) {
    return NextResponse.json({ error: 'Invalid sourceDocumentId' }, { status: 400 });
  }
  if (sourceDocumentId && !snapshotToken) {
    return NextResponse.json({ error: 'Invalid document export snapshot' }, { status: 400 });
  }
  let resolvedFolderId: string | null = null;
  if (!sourceDocumentId) {
    if (!folderId) {
      resolvedFolderId = null;
    } else if (!isUuid(folderId)) {
      return NextResponse.json({ error: 'Invalid folderId' }, { status: 400 });
    } else {
      resolvedFolderId = folderId;
    }
  }
  if (!libraryName) {
    return NextResponse.json({ error: 'Library name is required' }, { status: 400 });
  }
  if (!sourceDocumentId && !uploadedFile) {
    return NextResponse.json({ error: 'File is required' }, { status: 400 });
  }

  if (uploadedFile) {
    const ext = uploadedFile.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json({ error: 'File must be .txt or .md' }, { status: 400 });
    }
    if (uploadedFile.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 400 });
    }
  }

  let verifiedSource: DocumentExportSnapshot | undefined;
  if (sourceDocumentId) {
    try {
      const source = await getDocumentExportSource(supabase, user.id, sourceDocumentId);
      if (source.projectId !== projectId) {
        return NextResponse.json(
          { error: 'Source document not found in this project' },
          { status: 404 }
        );
      }
      verifiedSource = verifyDocumentExportSnapshotToken(snapshotToken);
      if (
        verifiedSource.documentId !== sourceDocumentId ||
        verifiedSource.projectId !== projectId
      ) {
        return NextResponse.json({ error: 'Invalid document export snapshot' }, { status: 400 });
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'Invalid document export snapshot' ||
          error.message === 'Invalid document export snapshot token')
      ) {
        return NextResponse.json({ error: 'Invalid document export snapshot' }, { status: 400 });
      }
      return documentSourceErrorResponse(error);
    }
  }

  const encoder = new TextEncoder();
  const conversionController = new AbortController();
  let streamClosed = false;
  const abortFromRequest = () => conversionController.abort(request.signal.reason);
  if (request.signal.aborted) {
    abortFromRequest();
  } else {
    request.signal.addEventListener('abort', abortFromRequest, { once: true });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (record: unknown) => {
        if (streamClosed || conversionController.signal.aborted) return false;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(record)}\n`));
          return true;
        } catch {
          streamClosed = true;
          conversionController.abort(new DOMException('Import response stream closed', 'AbortError'));
          return false;
        }
      };
      void (async () => {
        try {
          const rawContent = verifiedSource?.markdown ?? await uploadedFile!.text();
          const fileContent = toScriptImportPlainText(rawContent);
          const skipSemanticAuditAfterValidation = Boolean(sourceDocumentId);
          const conversion = await getOrResolveStory(
            fileContent,
            (content) => resolveStoryForImport(content, {
              sourceId: `modal:${crypto.randomUUID()}`,
              signal: conversionController.signal,
              skipSemanticAuditAfterValidation,
              enableAiPlotPlanning: false,
              onProgress: (progress: ImportProgressEvent) => send({ type: 'progress', progress }),
              onLlmTelemetry: (event) => console.info('[import-script:llm]', event),
            }),
            {
              variant: skipSemanticAuditAfterValidation
                ? 'document-validation-merge-heading-v12'
                : 'mandatory-audit-merge-heading-v12',
            }
          );
          if (conversion.cacheHit) {
            send({
              type: 'progress',
              progress: {
                phase: 'conversion',
                message: 'Reusing cached Story IR conversion',
              },
            });
          }
          const resolved = conversion.value;
          if (conversionController.signal.aborted) return;
          send({
            type: 'progress',
            progress: { phase: 'table_compile', message: 'Compiling script table' },
          });
          send({
            type: 'progress',
            progress: { phase: 'database_write', message: 'Writing script library' },
          });
          const result = await importStoryDocument(supabase, {
            userId: user.id,
            projectId,
            folderId: sourceDocumentId ? null : resolvedFolderId,
            libraryName,
            document: resolved.document,
            plotPlan: resolved.plotPlan,
            fileName: uploadedFile
              ? uploadedFile.name
              : `${verifiedSource?.documentName ?? 'document'}.txt`,
            ...(sourceDocumentId
              ? { documentSource: { sourceDocumentId, exportType: documentExportType } }
              : {}),
          });
          send({ type: 'result', result });
        } catch (error) {
          if (!conversionController.signal.aborted) {
            send({ type: 'error', error: safeErrorMessage(error) });
          }
        } finally {
          request.signal.removeEventListener('abort', abortFromRequest);
          if (!streamClosed) {
            streamClosed = true;
            try {
              controller.close();
            } catch {
              // The consumer may have cancelled between the state check and close.
            }
          }
        }
      })();
    },
    cancel(reason) {
      streamClosed = true;
      conversionController.abort(reason);
      request.signal.removeEventListener('abort', abortFromRequest);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
});

function documentSourceErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (
    message === 'Only admin users can export project content'
    || (error instanceof Error && error.name === 'AuthorizationError')
  ) {
    return NextResponse.json(
      { error: 'Only admin users can export project content' },
      { status: 403 }
    );
  }
  if (message === 'Document is empty') {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (message === 'Document not found or not accessible') {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  console.error('[POST /api/import-script] Document source validation failed', {
    name: error instanceof Error ? error.name : typeof error,
  });
  return NextResponse.json({ error: 'Failed to validate document source' }, { status: 500 });
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : 'Import failed';
  return message.slice(0, 1000);
}
