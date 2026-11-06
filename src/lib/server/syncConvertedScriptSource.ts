import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { DocumentStateConflictError } from '@/lib/documents/documentStateTypes';
import { broadcastDocumentStateReset } from '@/lib/documents/documentStateResetBroadcaster';
import { buildConvertedScriptSource } from '@/lib/script-system/convertedScriptSource';
import type { DocumentExportSnapshot } from './documentExportSnapshotSigning';
import { replaceDocumentAsAgent } from './documentAgentEditService';

export async function syncConvertedScriptSource(supabase: SupabaseClient, actorUserId: string,
  source: DocumentExportSnapshot, scriptText: string) {
  let current = await documentStateGateway.read(supabase, source.documentId);
  if (current.projectId !== source.projectId || current.token.epoch !== source.token.epoch
    || current.token.revision !== source.token.revision || current.markdown !== source.markdown) {
    throw new DocumentStateConflictError('Source document changed during conversion. Please retry.', current.token);
  }
  const markdown = buildConvertedScriptSource(current.markdown, scriptText);
  if (markdown === current.markdown) return current;
  if (!current.yjsStateBase64) {
    current = await documentStateGateway.initialize(supabase, source.documentId, current.markdown);
  }
  const state = await replaceDocumentAsAgent({
    actorUserId, projectId: source.projectId, documentId: source.documentId,
    expected: current.token, expectedUpdateIds: current.updateTail.map(update => update.id),
    markdown, changeSummary: 'Convert source document to the established Script syntax',
  }, { current });
  // Replacement writes a backup version and checks the document revision atomically.
  await broadcastDocumentStateReset(supabase, state).catch(() => undefined);
  return state;
}
