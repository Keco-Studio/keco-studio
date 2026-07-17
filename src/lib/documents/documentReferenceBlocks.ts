import type { SupabaseClient } from '@supabase/supabase-js';
import { documentContentCodec } from './documentContentCodec';
import type { DocumentReferenceBlock } from './documentBlockIdentity';
import {
  normalizeDocumentState,
  readDocumentTransportState,
} from './documentStateGateway';
import { broadcastDocumentStateReset } from './documentStateResetBroadcaster';
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

      const committedState = await normalizeDocumentState(client, {
        documentId,
        expected: state.token,
      });
      if (committedState.yjsStateBase64 === null) {
        throw new DocumentCollaborationUnavailableError(
          'Committed document collaboration state is unavailable'
        );
      }
      const committed = await documentContentCodec.normalizeYjsState(
        committedState.yjsStateBase64,
        []
      );
      if (committed.normalizationUpdateBase64 !== null) {
        throw new DocumentStateConflictError(
          'Committed document state is not normalized',
          committedState.token
        );
      }
      await broadcastDocumentStateReset(
        client,
        committedState,
        'normalization'
      );
      return { projectId: committedState.projectId, blocks: committed.blocks };
    } catch (error) {
      if (!(error instanceof DocumentStateConflictError) || attempt === 1) {
        throw error;
      }
    }
  }

  throw new DocumentStateConflictError('Document state changed repeatedly');
}
