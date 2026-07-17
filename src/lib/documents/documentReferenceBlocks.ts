import type { SupabaseClient } from '@supabase/supabase-js';
import { documentContentCodec } from './documentContentCodec';
import type { DocumentReferenceBlock } from './documentBlockIdentity';
import {
  appendDocumentYjsUpdates,
  readDocumentTransportState,
} from './documentStateGateway';
import {
  DocumentCollaborationUnavailableError,
  DocumentStateConflictError,
} from './documentStateTypes';

export async function ensureDocumentReferenceBlocks(
  client: SupabaseClient,
  documentId: string
): Promise<{ projectId: string; blocks: DocumentReferenceBlock[] }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const state = await readDocumentTransportState(client, documentId);
      if (state.yjsStateBase64 === null) {
        throw new DocumentCollaborationUnavailableError(
          'Document collaboration state is not initialized'
        );
      }

      const normalized = await documentContentCodec.normalizeYjsState(
        state.yjsStateBase64,
        state.updateTail.map((update) => update.updateBase64)
      );
      if (normalized.normalizationUpdateBase64 === null) {
        return { projectId: state.projectId, blocks: normalized.blocks };
      }

      await appendDocumentYjsUpdates(client, {
        documentId,
        epoch: state.token.epoch,
        updates: [
          {
            id: globalThis.crypto.randomUUID(),
            updateBase64: normalized.normalizationUpdateBase64,
          },
        ],
      });
      return { projectId: state.projectId, blocks: normalized.blocks };
    } catch (error) {
      if (!(error instanceof DocumentStateConflictError) || attempt === 1) {
        throw error;
      }
    }
  }

  throw new DocumentStateConflictError('Document state changed repeatedly');
}
