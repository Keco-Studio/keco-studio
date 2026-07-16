import { z } from 'zod';
import {
  createDocument,
  deleteDocument,
} from '@/lib/services/documentService';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import { listResolvedProjectDocuments } from '../document-resolver';
import { codePointBoundedString } from './document-parameter-schema';

const Params = z
  .object({
    name: codePointBoundedString(1, 200).refine((value) => /\S/.test(value), {
      message: 'name must contain a non-whitespace character.',
    }),
    content: codePointBoundedString(0, 500_000).default(''),
    folderId: z.string().uuid().nullable().optional(),
    allowDuplicate: z.boolean().optional(),
  })
  .strict();

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

export const createDocumentTool: AgentTool = {
  name: 'create_document',
  description:
    'Create a project document with validated Markdown/MDX content. Stop when the target folder already contains the same exact name unless the user explicitly allows a duplicate.',
  category: 'write', confirmationMode: 'pre_execute', confirmationRequired: true, requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
      content: { type: 'string', maxLength: 500_000, default: '' },
      folderId: { type: ['string', 'null'], format: 'uuid' },
      allowDuplicate: { type: 'boolean' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = Params.safeParse(params); if (!parsed.success) return { success: false, error: parsed.error.message };
    let createdDocumentId: string | undefined;
    let createdDocumentName: string | undefined;
    try {
      validateSanctionedMdx(parsed.data.content);
      const canonicalName = parsed.data.name.trim();
      if (!canonicalName) {
        return { success: false, error: 'Document name is required.' };
      }
      const canonicalFolderId = parsed.data.folderId?.toLowerCase();
      const existingDocuments = await listResolvedProjectDocuments(
        ctx.supabase,
        ctx.projectId
      );
      const duplicates = existingDocuments.filter(
        (document) =>
          document.name === canonicalName &&
          (document.folder_id?.toLowerCase() ?? undefined) === canonicalFolderId
      );
      if (duplicates.length > 0 && parsed.data.allowDuplicate !== true) {
        return {
          success: false,
          error: `A document named "${canonicalName}" already exists in the target folder.`,
          data: {
            candidates: duplicates.map((document) => ({
              id: document.id,
              name: document.name,
              folderId: document.folder_id,
              folderName: document.folderName,
              updatedAt: document.updated_at,
            })),
          },
        };
      }
      const doc = await createDocument(ctx.supabase, {
        projectId: ctx.projectId,
        name: canonicalName,
        content: parsed.data.content,
        folderId: canonicalFolderId,
      });
      createdDocumentId = doc.id;
      createdDocumentName = doc.name;
      const { documentStateGateway } = await import(
        '@/lib/documents/documentStateGateway'
      );
      await documentStateGateway.initialize(ctx.supabase, doc.id, parsed.data.content);
      queueDocumentReindex(ctx, doc.id);
      return {
        success: true,
        displayHint: 'text',
        data: { documentId: doc.id, name: doc.name },
        invalidations: [{ type: 'documents', projectId: ctx.projectId, documentId: doc.id }],
      };
    } catch (error) {
      if (createdDocumentId) {
        try {
          const { documentStateGateway } = await import(
            '@/lib/documents/documentStateGateway'
          );
          const current = await documentStateGateway.read(ctx.supabase, createdDocumentId);
          if (current.projectId === ctx.projectId && current.mode === 'collaborative') {
            queueDocumentReindex(ctx, createdDocumentId);
            return {
              success: true,
              displayHint: 'text',
              data: { documentId: createdDocumentId, name: createdDocumentName },
              invalidations: [{
                type: 'documents',
                projectId: ctx.projectId,
                documentId: createdDocumentId,
              }],
            };
          }
          if (current.projectId === ctx.projectId && current.mode === 'legacy') {
            await deleteDocument(ctx.supabase, createdDocumentId).catch(() => undefined);
          }
        } catch {
          // Preserve an outcome-unknown row rather than deleting committed state.
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create document.',
      };
    }
  },
};
