/**
 * generate_from_document — generate a derived table/conversation library from
 * an existing project Document using the same Story IR pipeline as sidebar
 * right-click Generate table / Generate conversation.
 */

import { z } from 'zod';
import { resolveDocumentForTool, type DocumentSelector } from '../document-resolver';
import { getDocumentExportSource } from '@/lib/server/documentExportSourceService';
import { toScriptImportPlainText } from '@/lib/documents/scriptImportPlainText';
import { defaultDerivedLibraryName } from '@/lib/documents/documentDerivedImportProgress';
import { resolveStoryForImport } from '@/lib/services/scriptConversionService';
import { importStoryDocument } from '@/lib/services/scriptImportService';
import { codePointBoundedString } from './document-parameter-schema';
import type {
  AgentTool,
  ConfirmationPreparation,
  ToolContext,
  ToolResult,
} from '../types';
import type { StoryPlanProgressEvent as ImportProgressEvent } from '@/lib/story-plan/conversion';

const ParamsSchema = z
  .object({
    documentId: z.string().uuid().optional(),
    documentName: codePointBoundedString(1, 200).optional(),
    folderName: codePointBoundedString(1, 200).optional(),
    exportType: z.enum(['table', 'script']),
  })
  .strict()
  .superRefine((params, refinement) => {
    if (
      params.folderName !== undefined &&
      params.documentName === undefined &&
      params.documentId === undefined
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['folderName'],
        message: 'folderName requires documentName or documentId.',
      });
    }
  });

function selectorFromParams(params: z.infer<typeof ParamsSchema>): DocumentSelector {
  const selector: DocumentSelector = {};
  if (params.documentId !== undefined) selector.documentId = params.documentId;
  if (params.documentName !== undefined) selector.documentName = params.documentName;
  if (params.folderName !== undefined) selector.folderName = params.folderName;
  return selector;
}

async function resolveTarget(params: z.infer<typeof ParamsSchema>, ctx: ToolContext) {
  const resolution = await resolveDocumentForTool(
    ctx.supabase,
    ctx.projectId,
    selectorFromParams(params),
    ctx
  );
  if (resolution.ok === false) {
    return {
      error: {
        success: false as const,
        error: resolution.error,
        ...(resolution.candidates ? { data: { candidates: resolution.candidates } } : {}),
      },
    };
  }
  if (resolution.document.project_id !== ctx.projectId) {
    return { error: { success: false as const, error: 'Document not found in this project.' } };
  }
  return { document: resolution.document, exportType: params.exportType };
}

async function prepareConfirmation(
  params: unknown,
  ctx: ToolContext
): Promise<ConfirmationPreparation> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const resolved = await resolveTarget(parsed.data, ctx);
  if ('error' in resolved) {
    return {
      success: false,
      error: resolved.error.error,
      ...(resolved.error.data ? { data: resolved.error.data } : {}),
    };
  }
  const kind = resolved.exportType === 'table' ? 'table' : 'conversation';
  return {
    success: true,
    args: {
      documentId: resolved.document.id,
      exportType: resolved.exportType,
    },
    preview: {
      type: 'generate_from_document',
      documentId: resolved.document.id,
      name: resolved.document.name,
      folderName: resolved.document.folderName,
      exportType: resolved.exportType,
      summary: `Generate ${kind} from document "${resolved.document.name}"`,
    },
  };
}

class ProgressQueue implements AsyncIterable<ImportProgressEvent> {
  private events: ImportProgressEvent[] = [];
  private waiting: (() => void) | undefined;
  private closed = false;

  push(event: ImportProgressEvent): void {
    this.events.push(event);
    this.waiting?.();
    this.waiting = undefined;
  }

  close(): void {
    this.closed = true;
    this.waiting?.();
    this.waiting = undefined;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ImportProgressEvent> {
    while (!this.closed || this.events.length > 0) {
      if (this.events.length > 0) {
        yield this.events.shift()!;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.waiting = resolve;
      });
    }
  }
}

async function* executeStream(
  params: unknown,
  ctx: ToolContext
): AsyncGenerator<ImportProgressEvent, ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }

  const resolved = await resolveTarget(parsed.data, ctx);
  if ('error' in resolved) return resolved.error;

  let source;
  try {
    source = await getDocumentExportSource(ctx.supabase, ctx.userId, resolved.document.id);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Document export source failed',
    };
  }
  if (source.projectId !== ctx.projectId) {
    return { success: false, error: 'Source document not found in this project' };
  }

  const plainText = toScriptImportPlainText(source.markdown);
  if (!plainText.trim()) {
    return { success: false, error: 'Document is empty' };
  }

  const libraryName = defaultDerivedLibraryName(source.documentName, resolved.exportType);
  const kindLabel = resolved.exportType === 'table' ? 'table' : 'conversation';

  const queue = new ProgressQueue();
  const resolutionPromise = resolveStoryForImport(plainText, {
    sourceId: `document:${source.documentId}`,
    onProgress: (event) => queue.push(event),
  })
    .then((story) => ({ story }))
    .catch((error: unknown) => ({ error }))
    .finally(() => queue.close());

  yield { phase: 'source_segmentation', message: `Preparing ${kindLabel}…` };
  for await (const progress of queue) yield progress;

  const resolution = await resolutionPromise;
  if ('error' in resolution) {
    return {
      success: false,
      error:
        resolution.error instanceof Error
          ? resolution.error.message
          : 'Conversion failed.',
    };
  }

  yield { phase: 'table_compile', message: `Compiling ${kindLabel}` };
  yield { phase: 'database_write', message: `Writing ${kindLabel} library` };

  try {
    const result = await importStoryDocument(ctx.supabase, {
      userId: ctx.userId,
      projectId: ctx.projectId,
      folderId: source.folderId,
      libraryName,
      document: resolution.story.document,
      fileName: `${libraryName}.txt`,
      documentSource: {
        sourceDocumentId: source.documentId,
        exportType: resolved.exportType,
      },
    });

    return {
      success: true,
      displayHint: 'text',
      data: {
        libraryId: result.libraryId,
        libraryName,
        exportType: resolved.exportType,
        sourceDocumentId: source.documentId,
        documentName: source.documentName,
        rowCount: result.rowCount,
        fieldCount: result.fieldCount,
      },
      invalidations: [
        {
          type: 'library',
          id: result.libraryId,
          projectId: ctx.projectId,
          sourceDocumentId: source.documentId,
        },
      ],
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Import failed.',
    };
  }
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const iterator = executeStream(params, ctx);
  while (true) {
    const step = await iterator.next();
    if (step.done) return step.value;
  }
}

export const generateFromDocument: AgentTool = {
  name: 'generate_from_document',
  description:
    'Generate a derived table or conversation library from an existing project Document using the same Story IR pipeline as Document right-click Generate table / Generate conversation. Use exportType "table" for Generate table and "script" for Generate conversation. Do not use setup_library, create_library, or folder import_script for this intent. Select by documentId first, otherwise exact documentName (optionally folderName); with no selector, the current document is used. Admin only.',
  category: 'write',
  confirmationMode: 'pre_execute',
  confirmationPolicy: 'mode',
  confirmationRequired: true,
  requiredPermission: 'admin',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', format: 'uuid' },
      documentName: { type: 'string', minLength: 1, maxLength: 200 },
      folderName: { type: 'string', minLength: 1, maxLength: 200 },
      exportType: {
        type: 'string',
        enum: ['table', 'script'],
        description: 'table = Generate table; script = Generate conversation',
      },
    },
    required: ['exportType'],
    additionalProperties: false,
  },
  prepareConfirmation,
  execute,
  executeStream,
};
