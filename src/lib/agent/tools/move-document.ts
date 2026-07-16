import { z } from 'zod';
import { findFolderByName } from '../data-access';
import { resolveDocumentForTool, type DocumentSelector } from '../document-resolver';
import { moveDocument } from '@/lib/services/documentService';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { codePointBoundedString } from './document-parameter-schema';

const ParamsSchema = z
  .object({
    documentId: z.string().uuid().optional(),
    documentName: codePointBoundedString(1, 200).optional(),
    folderName: codePointBoundedString(1, 200).optional(),
    moveToRoot: z.boolean().optional(),
  })
  .strict()
  .superRefine((params, refinement) => {
    if (params.folderName === undefined && params.moveToRoot !== true) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['folderName'],
        message: 'folderName is required unless moveToRoot is true.',
      });
    }
    if (params.folderName !== undefined && params.moveToRoot === true) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['moveToRoot'],
        message: 'folderName and moveToRoot: true cannot be used together.',
      });
    }
  });

function selectorFromParams(params: z.infer<typeof ParamsSchema>): DocumentSelector {
  const selector: DocumentSelector = {};
  if (params.documentId !== undefined) selector.documentId = params.documentId;
  if (params.documentName !== undefined) selector.documentName = params.documentName;
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

    let destination: { id: string | null; name: string | null } = {
      id: null,
      name: null,
    };
    if (parsed.data.folderName !== undefined) {
      const { folder, available } = await findFolderByName(
        ctx.supabase,
        ctx.projectId,
        parsed.data.folderName,
        ctx
      );
      if (!folder) {
        return {
          success: false,
          error: `Folder "${parsed.data.folderName}" not found. Available folders: ${available.join(', ') || '(none)'}`,
        };
      }
      destination = folder;
    }

    await moveDocument(ctx.supabase, resolution.document.id, {
      folderId: destination.id,
    });
    queueDocumentReindex(ctx, resolution.document.id);
    return {
      success: true,
      displayHint: 'text',
      data: {
        documentId: resolution.document.id,
        name: resolution.document.name,
        previousFolderId: resolution.document.folder_id,
        previousFolderName: resolution.document.folderName,
        folderId: destination.id,
        folderName: destination.name,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to move document.',
    };
  }
}

export const moveDocumentTool: AgentTool = {
  name: 'move_document',
  description:
    'Move a project document into an exact folderName or to the project root with moveToRoot: true. Select by documentId first, otherwise exact documentName; with no selector, the current document is used.',
  category: 'write',
  confirmationMode: 'pre_execute',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', format: 'uuid' },
      documentName: { type: 'string', minLength: 1, maxLength: 200 },
      folderName: { type: 'string', minLength: 1, maxLength: 200 },
      moveToRoot: { type: 'boolean' },
    },
    required: [],
    oneOf: [
      {
        required: ['folderName'],
        not: {
          required: ['moveToRoot'],
          properties: { moveToRoot: { const: true } },
        },
      },
      {
        required: ['moveToRoot'],
        properties: { moveToRoot: { const: true } },
        not: { required: ['folderName'] },
      },
    ],
    additionalProperties: false,
  },
  execute,
};
