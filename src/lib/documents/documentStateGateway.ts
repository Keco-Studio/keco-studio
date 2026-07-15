import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid } from '@/lib/utils/uuid';
import {
  documentContentCodec,
  mergeYjsState,
} from './documentContentCodec';
import {
  DocumentAccessError,
  DocumentReadOnlyError,
  DocumentStateConflictError,
  type AuthoritativeDocumentState,
  type ReplaceDocumentStateInput,
  type DocumentStateToken,
  type DurableYjsUpdate,
} from './documentStateTypes';

const DOCUMENT_STATE_COLUMNS =
  'id, project_id, content, yjs_state, collab_epoch, collab_revision, updated_at';
const DOCUMENT_UPDATE_COLUMNS = 'id, update_data, created_at';
const MAX_STABLE_READ_ATTEMPTS = 3;

type DocumentStateRow = {
  id: string;
  project_id: string;
  content: string;
  yjs_state: string | null;
  collab_epoch: number;
  collab_revision: number;
  updated_at: string;
};

type DocumentUpdateRow = {
  id: string;
  update_data: string;
  created_at: string;
};

type DocumentStateRpcRow = Pick<
  DocumentStateRow,
  'collab_epoch' | 'collab_revision' | 'yjs_state' | 'content' | 'updated_at'
>;

export type AppendDocumentYjsUpdatesInput = {
  documentId: string;
  epoch: number;
  updates: DurableYjsUpdate[];
};

export type CompactDocumentStateInput = {
  documentId: string;
  expected: DocumentStateToken;
};

type RawDocumentState = {
  head: DocumentStateRow;
  tail: DocumentUpdateRow[];
};

function assertDocumentId(documentId: string): void {
  if (!isUuid(documentId)) throw new Error('Invalid document ID format');
}

function isConflictError(error: { code?: string } | null): boolean {
  return error?.code === 'PT409';
}

function throwMutationError(
  error: { code?: string; message?: string },
  token?: DocumentStateToken
): never {
  if (isConflictError(error)) {
    throw new DocumentStateConflictError(error.message, token);
  }
  if (error.code === '42501') {
    throw new DocumentReadOnlyError();
  }
  throw error;
}

function firstRpcRow(data: unknown): DocumentStateRpcRow {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    throw new DocumentAccessError('Document state operation returned no state');
  }
  return row as DocumentStateRpcRow;
}

function stateFromRpc(
  documentId: string,
  projectId: string,
  row: DocumentStateRpcRow
): AuthoritativeDocumentState {
  return {
    documentId,
    projectId,
    mode: 'collaborative',
    markdown: row.content,
    yjsStateBase64: row.yjs_state,
    updateTail: [],
    token: {
      epoch: Number(row.collab_epoch),
      revision: Number(row.collab_revision),
    },
    updatedAt: row.updated_at,
  };
}

async function readRawDocumentState(
  client: SupabaseClient,
  documentId: string
): Promise<RawDocumentState> {
  assertDocumentId(documentId);
  let latestToken: DocumentStateToken | undefined;

  for (let attempt = 0; attempt < MAX_STABLE_READ_ATTEMPTS; attempt += 1) {
    const readHead = async (): Promise<DocumentStateRow> => {
      const { data, error } = await client
        .from('documents')
        .select(DOCUMENT_STATE_COLUMNS)
        .eq('id', documentId)
        .single();

      if (error || !data) {
        if (!error || error.code === 'PGRST116' || error.code === '42501') {
          throw new DocumentAccessError();
        }
        throw error;
      }
      return data as unknown as DocumentStateRow;
    };

    const head = await readHead();
    const { data: tailData, error: tailError } = await client
      .from('document_yjs_updates')
      .select(DOCUMENT_UPDATE_COLUMNS)
      .eq('document_id', documentId)
      .eq('epoch', head.collab_epoch)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (tailError) throw tailError;

    const verifiedHead = await readHead();
    latestToken = {
      epoch: Number(verifiedHead.collab_epoch),
      revision: Number(verifiedHead.collab_revision),
    };
    if (
      Number(head.collab_epoch) === latestToken.epoch &&
      Number(head.collab_revision) === latestToken.revision
    ) {
      return {
        head,
        tail: (tailData ?? []) as unknown as DocumentUpdateRow[],
      };
    }
  }
  throw new DocumentStateConflictError(
    'Document state changed while reading',
    latestToken
  );
}

export async function readDocumentState(
  client: SupabaseClient,
  documentId: string
): Promise<AuthoritativeDocumentState> {
  const { head, tail } = await readRawDocumentState(client, documentId);
  const updateTail = tail.map((row) => ({
    id: row.id,
    updateBase64: row.update_data,
    createdAt: row.created_at,
  }));
  const collaborative = head.yjs_state !== null;
  const markdown = collaborative
    ? await documentContentCodec.yjsStateToMarkdown(
        head.yjs_state,
        updateTail.map((update) => update.updateBase64)
      )
    : head.content;

  return {
    documentId: head.id,
    projectId: head.project_id,
    mode: collaborative ? 'collaborative' : 'legacy',
    markdown,
    yjsStateBase64: head.yjs_state,
    updateTail,
    token: {
      epoch: Number(head.collab_epoch),
      revision: Number(head.collab_revision),
    },
    updatedAt: head.updated_at,
  };
}

export async function initializeDocumentState(
  client: SupabaseClient,
  documentId: string,
  markdown: string
): Promise<AuthoritativeDocumentState> {
  assertDocumentId(documentId);
  const yjsStateBase64 = await documentContentCodec.markdownToYjsState(markdown);
  const projectResult = await client
    .from('documents')
    .select('project_id')
    .eq('id', documentId)
    .single();
  if (projectResult.error || !projectResult.data) throw new DocumentAccessError();
  const projectId = (projectResult.data as { project_id: string }).project_id;

  const { data, error } = await client.rpc('initialize_document_collab_state', {
    p_document_id: documentId,
    p_expected_epoch: 0,
    p_yjs_state: yjsStateBase64,
    p_markdown: markdown,
  });
  if (error) throwMutationError(error, { epoch: 0, revision: 0 });
  return stateFromRpc(
    documentId,
    projectId,
    firstRpcRow(data)
  );
}

export async function appendDocumentYjsUpdates(
  client: SupabaseClient,
  input: AppendDocumentYjsUpdatesInput
): Promise<{ acceptedIds: string[] }> {
  assertDocumentId(input.documentId);
  if (!Number.isSafeInteger(input.epoch) || input.epoch < 0) {
    throw new Error('Invalid document collaboration epoch');
  }
  if (input.updates.length === 0 || input.updates.length > 100) {
    throw new Error('Document update batch must contain between 1 and 100 updates');
  }
  for (const update of input.updates) {
    if (!isUuid(update.id) || !update.updateBase64) {
      throw new Error('Invalid durable document update');
    }
  }

  const { error } = await client.rpc('append_document_yjs_updates', {
    p_document_id: input.documentId,
    p_epoch: input.epoch,
    p_updates: input.updates.map((update) => ({
      id: update.id,
      updateBase64: update.updateBase64,
    })),
  });
  if (error) throwMutationError(error, { epoch: input.epoch, revision: 0 });
  return { acceptedIds: input.updates.map((update) => update.id) };
}

export async function compactDocumentState(
  client: SupabaseClient,
  input: CompactDocumentStateInput
): Promise<AuthoritativeDocumentState> {
  assertDocumentId(input.documentId);
  const { head, tail } = await readRawDocumentState(client, input.documentId);
  const current = {
    epoch: Number(head.collab_epoch),
    revision: Number(head.collab_revision),
  };
  if (
    current.epoch !== input.expected.epoch ||
    current.revision !== input.expected.revision
  ) {
    throw new DocumentStateConflictError('Document state changed', current);
  }

  const updateTail = tail.map((row) => row.update_data);
  const merged = mergeYjsState(head.yjs_state, updateTail);
  const markdown = await documentContentCodec.yjsStateToMarkdown(merged, []);
  const includedUpdateIds = tail.map((row) => row.id);
  const { data, error } = await client.rpc('compact_document_collab_state', {
    p_document_id: input.documentId,
    p_expected_epoch: input.expected.epoch,
    p_expected_revision: input.expected.revision,
    p_included_update_ids: includedUpdateIds,
    p_yjs_state: merged,
    p_markdown: markdown,
  });
  if (error) throwMutationError(error, current);
  return stateFromRpc(
    input.documentId,
    head.project_id,
    firstRpcRow(data)
  );
}

export async function replaceDocumentState(
  client: SupabaseClient,
  input: ReplaceDocumentStateInput
): Promise<AuthoritativeDocumentState> {
  assertDocumentId(input.documentId);
  const versionReplacement =
    input.replacement.kind === 'version' ? input.replacement : null;
  const markdownReplacement =
    input.replacement.kind === 'markdown' ? input.replacement : null;
  const restoring =
    input.reason === 'restore' && versionReplacement !== null;
  const agentEdit =
    input.reason === 'agent' && markdownReplacement !== null;
  if (agentEdit) {
    throw new Error('Agent Markdown replacement requires the trusted server command');
  }
  if (!restoring && !agentEdit) {
    throw new Error('Document replacement reason does not match its payload');
  }
  if (versionReplacement && !isUuid(versionReplacement.versionId)) {
    throw new Error('Invalid document version ID format');
  }

  const { head, tail } = await readRawDocumentState(client, input.documentId);
  const current = {
    epoch: Number(head.collab_epoch),
    revision: Number(head.collab_revision),
  };
  if (
    current.epoch !== input.expected.epoch ||
    current.revision !== input.expected.revision
  ) {
    throw new DocumentStateConflictError('Document state changed', current);
  }
  if (!head.yjs_state) {
    throw new DocumentStateConflictError(
      'Document collaboration state is not initialized',
      current
    );
  }

  if (agentEdit) {
    const expectedUpdateIds = input.expectedUpdateIds ?? [];
    const currentUpdateIds = tail.map((row) => row.id);
    if (
      expectedUpdateIds.length !== currentUpdateIds.length ||
      expectedUpdateIds.some((id, index) => id !== currentUpdateIds[index])
    ) {
      throw new DocumentStateConflictError('Document update tail changed', current);
    }
  }

  const updateTail = tail.map((row) => row.update_data);
  const merged = mergeYjsState(head.yjs_state, updateTail);
  const markdown = await documentContentCodec.yjsStateToMarkdown(merged, []);
  const backupVersionId = globalThis.crypto.randomUUID();
  const commonArgs = {
    p_document_id: input.documentId,
    p_backup_version_id: backupVersionId,
    p_expected_epoch: input.expected.epoch,
    p_expected_revision: input.expected.revision,
    p_included_update_ids: tail.map((row) => row.id),
    p_current_yjs_state: merged,
    p_current_markdown: markdown,
  };
  const rpc = restoring
    ? await client.rpc('restore_document_version', {
        ...commonArgs,
        p_target_version_id: versionReplacement.versionId,
        p_audit_version_id: globalThis.crypto.randomUUID(),
      })
    : await client.rpc('replace_document_with_markdown', {
        ...commonArgs,
        p_replacement_yjs_state: await documentContentCodec.markdownToYjsState(
          markdownReplacement!.markdown
        ),
        p_replacement_markdown: markdownReplacement!.markdown,
      });
  const { data, error } = rpc;
  if (error) throwMutationError(error, current);
  return stateFromRpc(
    input.documentId,
    head.project_id,
    firstRpcRow(data)
  );
}

export const documentStateGateway = {
  read: readDocumentState,
  initialize: initializeDocumentState,
  appendUpdates: appendDocumentYjsUpdates,
  compact: compactDocumentState,
  replace: replaceDocumentState,
};
