import { z } from 'zod';
import {
  createDocument,
  deleteDocument,
} from '@/lib/services/documentService';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import { listResolvedProjectDocuments } from '../document-resolver';

const Params = z
  .object({
    name: z.string().min(1).max(200),
    content: z.string().max(500_000).default(''),
    folderId: z.string().uuid().nullable().optional(),
    allowDuplicate: z.boolean().optional(),
  })
  .strict();

export const createDocumentTool: AgentTool = {
  name: 'create_document',
  description: 'Create a project document with validated Markdown/MDX content.',
  category: 'write', confirmationMode: 'pre_execute', confirmationRequired: true, requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
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
      const targetFolderId = parsed.data.folderId ?? null;
      const existingDocuments = await listResolvedProjectDocuments(
        ctx.supabase,
        ctx.projectId
      );
      const duplicates = existingDocuments.filter(
        (document) =>
          document.name === parsed.data.name &&
          document.folder_id === targetFolderId
      );
      if (duplicates.length > 0 && parsed.data.allowDuplicate !== true) {
        return {
          success: false,
          error: `A document named "${parsed.data.name}" already exists in the target folder.`,
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
        name: parsed.data.name,
        content: parsed.data.content,
        folderId: parsed.data.folderId,
      });
      createdDocumentId = doc.id;
      createdDocumentName = doc.name;
      const { documentStateGateway } = await import(
        '@/lib/documents/documentStateGateway'
      );
      await documentStateGateway.initialize(ctx.supabase, doc.id, parsed.data.content);
      return {
        success: true,
        displayHint: 'text',
        data: { documentId: doc.id, name: doc.name },
      };
    } catch (error) {
      if (createdDocumentId) {
        try {
          const { documentStateGateway } = await import(
            '@/lib/documents/documentStateGateway'
          );
          const current = await documentStateGateway.read(ctx.supabase, createdDocumentId);
          if (current.projectId === ctx.projectId && current.mode === 'collaborative') {
            return {
              success: true,
              displayHint: 'text',
              data: { documentId: createdDocumentId, name: createdDocumentName },
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
