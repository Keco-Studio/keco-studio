import { z } from 'zod';
import { resolveDocumentForTool, type DocumentSelector } from '../document-resolver';
import { deleteDocument } from '@/lib/services/documentService';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { codePointBoundedString } from './document-parameter-schema';

const ParamsSchema = z
  .object({
    documentId: z.string().uuid().optional(),
    documentName: codePointBoundedString(1, 200).optional(),
    folderName: codePointBoundedString(1, 200).optional(),
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

const PreviewSchema = z
  .object({
    type: z.literal('document_delete'),
    documentId: z.string().uuid(),
    projectId: z.string().uuid(),
    name: z.string(),
    folderName: z.string().nullable(),
    updatedAt: z.string(),
  })
  .strict();

function selectorFromParams(params: z.infer<typeof ParamsSchema>): DocumentSelector {
  const selector: DocumentSelector = {};
  if (params.documentId !== undefined) selector.documentId = params.documentId;
  if (params.documentName !== undefined) selector.documentName = params.documentName;
  if (params.folderName !== undefined) selector.folderName = params.folderName;
  return selector;
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
    if (resolution.document.project_id !== ctx.projectId) {
      return { success: false, error: 'Document not found in this project.' };
    }

    const preview = PreviewSchema.parse({
      type: 'document_delete',
      documentId: resolution.document.id,
      projectId: resolution.document.project_id,
      name: resolution.document.name,
      folderName: resolution.document.folderName,
      updatedAt: resolution.document.updated_at,
    });
    return {
      success: true,
      displayHint: 'text',
      data: preview,
      internalData: preview,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to preview document deletion.',
    };
  }
}

async function executeImport(
  previewResult: ToolResult,
  _params: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const preview = PreviewSchema.safeParse(previewResult.internalData);
  if (!preview.success) {
    return { success: false, error: 'Delete confirmation data is unavailable; please retry.' };
  }
  if (preview.data.projectId !== ctx.projectId) {
    return { success: false, error: 'Document not found in this project.' };
  }

  try {
    const resolution = await resolveDocumentForTool(
      ctx.supabase,
      ctx.projectId,
      { documentId: preview.data.documentId },
      ctx
    );
    if (resolution.ok === false) {
      return { success: false, error: resolution.error };
    }
    const document = resolution.document;
    if (
      document.id !== preview.data.documentId ||
      document.project_id !== preview.data.projectId
    ) {
      return { success: false, error: 'Document not found in this project.' };
    }
    if (
      document.name !== preview.data.name ||
      document.folderName !== preview.data.folderName ||
      document.updated_at !== preview.data.updatedAt
    ) {
      return {
        success: false,
        error: 'The document changed after deletion was approved; preview it again.',
      };
    }

    await deleteDocument(ctx.supabase, preview.data.documentId);
    return { success: true, displayHint: 'text', data: preview.data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete document.',
    };
  }
}

export const deleteDocumentTool: AgentTool = {
  name: 'delete_document',
  description:
    'Permanently delete a project document after an irreversible-action confirmation. Select by documentId first, otherwise exact documentName (optionally folderName); with no selector, the current document is used.',
  category: 'write',
  confirmationMode: 'post_preview',
  confirmationPolicy: 'always',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', format: 'uuid' },
      documentName: { type: 'string', minLength: 1, maxLength: 200 },
      folderName: { type: 'string', minLength: 1, maxLength: 200 },
    },
    required: [],
    anyOf: [
      { not: { required: ['folderName'] } },
      { required: ['documentId'] },
      { required: ['documentName'] },
    ],
    additionalProperties: false,
  },
  execute,
  executeImport,
};
