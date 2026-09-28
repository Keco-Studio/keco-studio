import { z } from 'zod';
import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';
import {
  deleteDocumentVersionIfUnchanged,
  prepareDocumentVersionDelete,
} from '../document-version-delete-service';

const inputSchema = z.object({
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
}).strict();
const sealedSchema = inputSchema.extend({
  projectId: z.string().uuid(),
  expectedEpoch: z.number().int().nonnegative(),
  expectedRevision: z.number().int().nonnegative(),
  expectedStateFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedVersionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmedDelete: z.literal(true),
}).strict();

export const deleteDocumentVersionTool: AgentTool = {
  name: 'delete_document_version',
  description: 'Permanently delete a manual or automatic document version after exact-state confirmation. Audit versions cannot be deleted.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', properties: {
    documentId: { type: 'string', format: 'uuid' },
    versionId: { type: 'string', format: 'uuid' },
  }, required: ['documentId', 'versionId'], additionalProperties: false },
  async prepareConfirmation(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = inputSchema.parse(params);
      const prepared = await prepareDocumentVersionDelete(ctx.supabase, {
        projectId, documentId: input.documentId!, versionId: input.versionId!,
      });
      return { success: true,
        args: { documentId: input.documentId, versionId: input.versionId,
          projectId, expectedEpoch: prepared.expectedEpoch,
          expectedRevision: prepared.expectedRevision,
          expectedStateFingerprint: prepared.expectedStateFingerprint,
          expectedVersionFingerprint: prepared.expectedVersionFingerprint,
          confirmedDelete: true },
        preview: { type: 'document_version_delete', projectId,
          documentId: input.documentId, documentName: prepared.documentName,
          versionId: input.versionId, versionName: prepared.versionName,
          versionType: prepared.versionType,
          currentToken: { epoch: prepared.expectedEpoch, revision: prepared.expectedRevision },
          consequence: 'Permanently delete this saved version. This cannot be undone.',
        } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Version deletion preview failed.' };
    }
  },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = sealedSchema.parse(params);
      if (input.projectId !== projectId) return { success: false, error: 'Version approval project mismatch.' };
      const versionId = await deleteDocumentVersionIfUnchanged(ctx.supabase, {
        projectId, documentId: input.documentId!, versionId: input.versionId!,
        expectedEpoch: input.expectedEpoch!, expectedRevision: input.expectedRevision!,
        expectedStateFingerprint: input.expectedStateFingerprint!,
        expectedVersionFingerprint: input.expectedVersionFingerprint!,
      });
      return { success: true, displayHint: 'text',
        invalidations: [{ type: 'documents', projectId, documentId: input.documentId! }],
        data: { projectId, documentId: input.documentId, versionId, deleted: true },
      };
    } catch (error) {
      return { success: false,
        error: error && typeof error === 'object' && 'code' in error && error.code === 'PT409'
          ? 'Document or version changed after approval. Preview deletion again.'
          : error instanceof Error ? error.message : 'Version deletion failed.',
      };
    }
  },
};
