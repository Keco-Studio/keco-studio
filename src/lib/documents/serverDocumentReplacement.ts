import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { documentContentCodec, mergeYjsState } from './documentContentCodec';
import { documentStateGateway } from './documentStateGateway';
import { DocumentAccessError, DocumentStateConflictError } from './documentStateTypes';

export async function replaceDialogueReference(
  serviceClient: SupabaseClient,
  input: {
    actorUserId: string;
    projectId: string;
    documentId: string;
    dialogueJobId: string;
    scriptLibraryId: string;
  },
): Promise<boolean> {
  const current = await documentStateGateway.read(serviceClient, input.documentId);
  if (current.projectId !== input.projectId) throw new DocumentAccessError();
  if (!current.yjsStateBase64) return false;

  const escapedJobId = input.dialogueJobId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const marker = new RegExp(`(^[ \\t]*- GDD dialogue job: ${escapedJobId}\\s*$\\n)[ \\t]*- Script: [^\\n]*`, 'm');
  if (!marker.test(current.markdown)) return false;
  const scriptHref = `/script-system/${encodeURIComponent(input.projectId)}/script/${encodeURIComponent(input.scriptLibraryId)}`;
  const replacementMarkdown = current.markdown.replace(
    marker,
    `$1  - Script: Completed - [Script](${scriptHref})`,
  );
  const currentYjsState = mergeYjsState(
    current.yjsStateBase64,
    current.updateTail.map((update) => update.updateBase64),
  );
  const { data, error } = await serviceClient.rpc('replace_document_with_markdown', {
    p_document_id: input.documentId,
    p_actor_user_id: input.actorUserId,
    p_backup_version_id: randomUUID(),
    p_expected_epoch: current.token.epoch,
    p_expected_revision: current.token.revision,
    p_included_update_ids: current.updateTail.map((update) => update.id),
    p_current_yjs_state: currentYjsState,
    p_current_markdown: current.markdown,
    p_replacement_yjs_state: await documentContentCodec.markdownToYjsState(replacementMarkdown),
    p_replacement_markdown: replacementMarkdown,
  });
  if (error) {
    if (error.code === 'PT409') throw new DocumentStateConflictError(error.message, current.token);
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new DocumentAccessError('Dialogue reference replacement returned no state');
  return true;
}
