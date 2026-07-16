import { z } from 'zod';
import { resolveDocumentForTool, type DocumentSelector } from '../document-resolver';
import { updateDocumentName } from '@/lib/services/documentService';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { codePointBoundedString } from './document-parameter-schema';

const ParamsSchema = z
  .object({
    documentId: z.string().uuid().optional(),
    documentName: codePointBoundedString(1, 200).optional(),
    folderName: codePointBoundedString(1, 200).optional(),
    newName: codePointBoundedString(1, 200).refine((value) => /\S/.test(value), {
      message: 'newName must contain a non-whitespace character.',
    }),
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

function queueDocumentReindex(ctx: ToolContext, documentId: string): void {
  void import('@/lib/server/documentEmbeddingIndexService')
    .then(({ reindexProjectDocumentAsActor }) =>
      reindexProjectDocumentAsActor({
        actorUserId: ctx.userId,
        projectId: ctx.projectId,
        documentId,
      })
    )
    .catch((error: unknown) => {
      console.error('embedding.index.project_document_failed', { documentId, error });
    });
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }

  try {
    const resolution = await resolveDocumentForTool(
      ctx.supabase,
      ctx.projectId,
      selectorFromParams(parsed.data),
      ctx
    );
    if (resolution.ok === false) {
      return {
        success: false,
        error: resolution.error,
        ...(resolution.candidates ? { data: { candidates: resolution.candidates } } : {}),
      };
    }

    const newName = parsed.data.newName.trim();
    await updateDocumentName(
      ctx.supabase,
      resolution.document.id,
      newName
    );
    queueDocumentReindex(ctx, resolution.document.id);
    return {
      success: true,
      displayHint: 'text',
      data: {
        documentId: resolution.document.id,
        oldName: resolution.document.name,
        name: newName,
        folderId: resolution.document.folder_id,
        folderName: resolution.document.folderName,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to rename document.',
    };
  }
}

export const renameDocument: AgentTool = {
  name: 'rename_document',
  description:
    'Rename a project document. Select by documentId first, otherwise exact documentName (optionally folderName); with no selector, the current document is used.',
  category: 'write',
  confirmationMode: 'pre_execute',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', format: 'uuid' },
      documentName: { type: 'string', minLength: 1, maxLength: 200 },
      folderName: { type: 'string', minLength: 1, maxLength: 200 },
      newName: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
    },
    required: ['newName'],
    anyOf: [
      { not: { required: ['folderName'] } },
      { required: ['documentId'] },
      { required: ['documentName'] },
    ],
    additionalProperties: false,
  },
  execute,
};
