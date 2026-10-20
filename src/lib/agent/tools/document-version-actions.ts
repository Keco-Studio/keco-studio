import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';
import {
  documentIdSchema, documentStateFingerprint,
  requireScopedDocument, versionDocumentState,
} from './document-version-tool-support';

const listSchema = z.object({
  documentId: documentIdSchema,
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();
const createSchema = z.object({
  documentId: documentIdSchema, name: z.string().trim().min(1).max(120),
  idempotencyKey: z.string().uuid(),
}).strict();
const restoreSchema = z.object({
  documentId: documentIdSchema, versionId: z.string().uuid(),
}).strict();
const sealedRestoreSchema = restoreSchema.extend({
  projectId: z.string().uuid(),
  expectedEpoch: z.number().int().nonnegative(),
  expectedRevision: z.number().int().nonnegative(),
  expectedStateFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedVersionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmedRestore: z.literal(true),
}).strict();

function versionFingerprint(version: { id: string; name: string; snapshotToken: { epoch: number; revision: number }; markdown: string }) {
  return createHash('sha256').update(JSON.stringify({
    id: version.id, name: version.name, snapshotToken: version.snapshotToken, markdown: version.markdown,
  })).digest('hex');
}

function documentInvalidation(projectId: string, documentId: string) {
  return [{ type: 'documents' as const, projectId, documentId }];
}

export const listDocumentVersionsTool: AgentTool = {
  name: 'list_document_versions',
  description: 'List saved versions for one document in the selected project, 20 by default and at most 50.',
  category: 'read', confirmationMode: 'pre_execute',
  parameters: { type: 'object', properties: {
    documentId: { type: 'string', format: 'uuid' },
    offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 },
  }, required: ['documentId'], additionalProperties: false },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = listSchema.parse(params);
      await requireScopedDocument(ctx, projectId, input.documentId!);
      const { listDocumentVersions } = await import('@/lib/documents/documentVersionService');
      const versions = await listDocumentVersions(ctx.supabase, input.documentId!, {
        offset: input.offset!, limit: input.limit! + 1,
      });
      const page = versions.slice(0, input.limit!);
      return { success: true, displayHint: 'list', data: {
        documentId: input.documentId, projectId, versions: page,
        nextOffset: versions.length > input.limit! ? input.offset! + input.limit! : null,
      } };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Version list failed.' }; }
  },
};

export const createDocumentVersionTool: AgentTool = {
  name: 'create_document_version',
  description: 'Save a named version of the durable collaborative document state. Reuse the UUID idempotencyKey for retries. Active editors should flush pending local changes first.',
  category: 'write', confirmationMode: 'pre_execute', requiredPermission: 'editor',
  parameters: { type: 'object', properties: {
    documentId: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    idempotencyKey: { type: 'string', format: 'uuid' },
  }, required: ['documentId', 'name', 'idempotencyKey'], additionalProperties: false },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = createSchema.parse(params);
      await requireScopedDocument(ctx, projectId, input.documentId!, true);
      const { createDocumentVersion } = await import('@/lib/documents/documentVersionService');
      const version = await createDocumentVersion(ctx.supabase, {
        documentId: input.documentId!, name: input.name!, idempotencyKey: input.idempotencyKey!,
      });
      if (version.projectId !== projectId || version.documentId !== input.documentId) {
        return { success: false, error: 'Version was not created in the selected document.' };
      }
      return { success: true, displayHint: 'text', invalidations: documentInvalidation(projectId, input.documentId!),
        data: { projectId, documentId: input.documentId, versionId: version.id,
          name: version.name, snapshotToken: version.snapshotToken } };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Version creation failed.' }; }
  },
};

export const restoreDocumentVersionTool: AgentTool = {
  name: 'restore_document_version',
  description: 'Restore a selected document version over current collaborative content. Always requires approval; creates a backup of the current state.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', properties: {
    documentId: { type: 'string', format: 'uuid' }, versionId: { type: 'string', format: 'uuid' },
  }, required: ['documentId', 'versionId'], additionalProperties: false },
  async prepareConfirmation(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = restoreSchema.parse(params);
      const document = await requireScopedDocument(ctx, projectId, input.documentId!, true);
      const state = await versionDocumentState(ctx, projectId, input.documentId!);
      if (state.mode !== 'collaborative') return { success: false, error: 'Document collaboration is not initialized.' };
      const { getDocumentVersionPreview } = await import('@/lib/documents/documentVersionService');
      const version = await getDocumentVersionPreview(ctx.supabase, input.documentId!, input.versionId!);
      if (version.projectId !== projectId || version.documentId !== input.documentId) {
        return { success: false, error: 'Version not found in this document.' };
      }
      return { success: true,
        args: { ...input, projectId, expectedEpoch: state.token.epoch,
          expectedRevision: state.token.revision,
          expectedStateFingerprint: documentStateFingerprint(state),
          expectedVersionFingerprint: versionFingerprint(version), confirmedRestore: true },
        preview: { type: 'document_version_restore', projectId,
          documentId: input.documentId, documentName: document.name,
          versionId: version.id, versionName: version.name,
          currentToken: state.token, targetToken: version.snapshotToken,
          consequence: 'Replace current document content; a backup of the current content will be created.',
        } };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Version restore preview failed.' }; }
  },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = sealedRestoreSchema.parse(params);
      if (input.projectId !== projectId) return { success: false, error: 'Document approval project mismatch.' };
      await requireScopedDocument(ctx, projectId, input.documentId!, true);
      const state = await versionDocumentState(ctx, projectId, input.documentId!);
      if (state.token.epoch !== input.expectedEpoch || state.token.revision !== input.expectedRevision
        || documentStateFingerprint(state) !== input.expectedStateFingerprint) {
        return { success: false, error: 'Document changed after approval. Preview the restore again.' };
      }
      const { getDocumentVersionPreview } = await import('@/lib/documents/documentVersionService');
      const version = await getDocumentVersionPreview(ctx.supabase, input.documentId!, input.versionId!);
      if (version.projectId !== projectId || version.documentId !== input.documentId
        || versionFingerprint(version) !== input.expectedVersionFingerprint) {
        return { success: false, error: 'Target version changed after approval. Preview the restore again.' };
      }
      const { documentStateGateway } = await import('@/lib/documents/documentStateGateway');
      const restored = await documentStateGateway.replace(ctx.supabase, {
        documentId: input.documentId!,
        expected: { epoch: input.expectedEpoch!, revision: input.expectedRevision! },
        replacement: { kind: 'version', versionId: input.versionId! }, reason: 'restore',
      });
      const { broadcastDocumentStateReset } = await import('@/lib/documents/documentStateResetBroadcaster');
      await broadcastDocumentStateReset(ctx.supabase, restored, 'restore').catch(() => undefined);
      void import('@/lib/server/documentEmbeddingIndexService')
        .then(({ reindexProjectDocumentAsActor }) => reindexProjectDocumentAsActor({
          actorUserId: ctx.userId, projectId, documentId: input.documentId!, usageBinding: ctx.usageBinding,
        })).catch(() => undefined);
      return { success: true, displayHint: 'text', invalidations: documentInvalidation(projectId, input.documentId!),
        data: { projectId, documentId: input.documentId, versionId: input.versionId,
          backupCreated: true, epoch: restored.token.epoch, revision: restored.token.revision } };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Version restore failed.' }; }
  },
};
