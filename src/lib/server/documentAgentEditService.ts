import 'server-only';

import { documentContentCodec, mergeYjsState } from '@/lib/documents/documentContentCodec';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import {
  DocumentAccessError,
  DocumentReadOnlyError,
  DocumentStateConflictError,
  type AuthoritativeDocumentState,
  type DocumentStateToken,
} from '@/lib/documents/documentStateTypes';
import { isUuid } from '@/lib/utils/uuid';
import type { DerivedDialogueTableOperation } from '@/lib/script-system/scriptDialogueDerivedTableSync';
import { getSupabaseServiceRoleClient } from './supabaseServiceRole';

export type ReplaceDocumentAsAgentInput = {
  actorUserId: string;
  projectId: string;
  documentId: string;
  expected: DocumentStateToken;
  expectedUpdateIds: readonly string[];
  markdown: string;
  derivedTableOperations?: readonly DerivedDialogueTableOperation[];
};

export type ReplaceDocumentAsAgentOptions = {
  current?: AuthoritativeDocumentState;
};

type ReplacementRpcRow = {
  collab_epoch: number;
  collab_revision: number;
  yjs_state: string;
  content: string;
  updated_at: string;
};

function firstRow(data: unknown): ReplacementRpcRow {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    throw new DocumentAccessError('Agent document replacement returned no state');
  }
  return row as ReplacementRpcRow;
}

export async function replaceDocumentAsAgent(
  input: ReplaceDocumentAsAgentInput,
  options: ReplaceDocumentAsAgentOptions = {},
): Promise<AuthoritativeDocumentState> {
  if (!isUuid(input.actorUserId) || !isUuid(input.projectId) || !isUuid(input.documentId)) {
    throw new Error('Invalid Agent document replacement scope');
  }
  documentContentCodec.validate(input.markdown);

  const admin = getSupabaseServiceRoleClient();
  const current = options.current
    ?? await documentStateGateway.read(admin, input.documentId);
  if (current.projectId !== input.projectId) {
    throw new DocumentAccessError('Document project does not match the Agent scope');
  }
  if (
    current.token.epoch !== input.expected.epoch ||
    current.token.revision !== input.expected.revision
  ) {
    throw new DocumentStateConflictError('Document state changed', current.token);
  }
  const currentUpdateIds = current.updateTail.map((update) => update.id);
  if (
    currentUpdateIds.length !== input.expectedUpdateIds.length ||
    currentUpdateIds.some((id, index) => id !== input.expectedUpdateIds[index])
  ) {
    throw new DocumentStateConflictError('Document update tail changed', current.token);
  }
  if (!current.yjsStateBase64) {
    throw new DocumentStateConflictError('Document collaboration state is not initialized', current.token);
  }

  const merged = mergeYjsState(
    current.yjsStateBase64,
    current.updateTail.map((update) => update.updateBase64)
  );
  const currentMarkdown = options.current
    ? current.markdown
    : await documentContentCodec.yjsStateToMarkdown(merged, []);
  const replacementYjsState = await documentContentCodec.markdownToYjsState(input.markdown);
  const rpcName = input.derivedTableOperations
    ? 'replace_document_with_markdown_and_sync_tables'
    : 'replace_document_with_markdown';
  const rpcInput = {
    p_document_id: input.documentId,
    p_actor_user_id: input.actorUserId,
    p_backup_version_id: globalThis.crypto.randomUUID(),
    p_expected_epoch: input.expected.epoch,
    p_expected_revision: input.expected.revision,
    p_included_update_ids: input.expectedUpdateIds,
    p_current_yjs_state: merged,
    p_current_markdown: currentMarkdown,
    p_replacement_yjs_state: replacementYjsState,
    p_replacement_markdown: input.markdown,
    ...(input.derivedTableOperations
      ? { p_derived_table_operations: input.derivedTableOperations }
      : {}),
  };
  const { data, error } = await admin.rpc(rpcName, rpcInput);

  if (error) {
    if (error.code === 'PT409') throw new DocumentStateConflictError(error.message, current.token);
    if (error.code === '42501') throw new DocumentReadOnlyError();
    throw error;
  }
  const row = firstRow(data);
  return {
    documentId: input.documentId,
    projectId: current.projectId,
    mode: 'collaborative',
    markdown: row.content,
    yjsStateBase64: row.yjs_state,
    updateTail: [],
    token: { epoch: Number(row.collab_epoch), revision: Number(row.collab_revision) },
    epochReason: 'agent',
    updatedAt: row.updated_at,
  };
}
