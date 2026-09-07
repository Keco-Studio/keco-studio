import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPaged } from '@/lib/services/pagination';
import { isUuid } from '@/lib/utils/uuid';
import {
  documentContentCodec,
  mergeYjsState,
} from './documentContentCodec';
import {
  DOCUMENT_UPDATE_CHUNK_BYTES,
  MAX_DOCUMENT_UPDATE_BYTES,
  MAX_DOCUMENT_UPDATE_CHUNKS,
  NORMAL_DOCUMENT_UPDATE_MAX_BYTES,
  validateChunkIndexes,
  type ChunkedDocumentUpdateManifest,
} from './documentChunkedUpdate';
import {
  DocumentAccessError,
  DocumentReadOnlyError,
  DocumentStateConflictError,
  type AuthoritativeDocumentState,
  type AuthoritativeDocumentTransportState,
  type DocumentEpochReason,
  type ReplaceDocumentStateInput,
  type DocumentStateToken,
  type DurableYjsUpdate,
} from './documentStateTypes';

const DOCUMENT_STATE_COLUMNS =
  'id, project_id, content, yjs_state, collab_epoch, collab_revision, collab_epoch_reason, updated_at';
const DOCUMENT_UPDATE_COLUMNS = 'id, update_data, created_at';
const MAX_STABLE_READ_ATTEMPTS = 3;

type DocumentStateRow = {
  id: string;
  project_id: string;
  content: string;
  yjs_state: string | null;
  collab_epoch: number;
  collab_revision: number;
  collab_epoch_reason: string;
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

export type PrepareDocumentYjsUpdateUploadResult = {
  status: 'uploading' | 'ready' | 'committed';
  receivedIndexes: number[];
};

export type PutDocumentYjsUpdateChunkInput = {
  manifest: ChunkedDocumentUpdateManifest;
  chunkIndex: number;
  chunkBase64: string;
  chunkSha256: string;
};

export type PutDocumentYjsUpdateChunkResult = { receivedCount: number };

export type DocumentYjsUpdateUploadStatus = {
  status: 'uploading' | 'ready' | 'committed' | 'expired';
  missingIndexes: number[];
};

export type FinalizeDocumentYjsUpdateUploadResult = { status: 'committed' };

type RawDocumentState = {
  head: DocumentStateRow;
  tail: DocumentUpdateRow[];
};

type TransportReadResult = {
  state: AuthoritativeDocumentTransportState;
  legacyMarkdown: string;
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

function validateUploadManifest(manifest: ChunkedDocumentUpdateManifest): void {
  assertDocumentId(manifest.documentId);
  if (!isUuid(manifest.updateId) || !isUuid(manifest.userId)) {
    throw new Error('Invalid document update upload identity');
  }
  if (!Number.isSafeInteger(manifest.epoch) || manifest.epoch < 0) {
    throw new Error('Invalid document collaboration epoch');
  }
  if (
    !Number.isSafeInteger(manifest.totalBytes) ||
    manifest.totalBytes <= NORMAL_DOCUMENT_UPDATE_MAX_BYTES ||
    manifest.totalBytes > MAX_DOCUMENT_UPDATE_BYTES ||
    !Number.isSafeInteger(manifest.chunkCount) ||
    manifest.chunkCount < 2 ||
    manifest.chunkCount > MAX_DOCUMENT_UPDATE_CHUNKS ||
    manifest.chunkCount !== Math.ceil(manifest.totalBytes / DOCUMENT_UPDATE_CHUNK_BYTES) ||
    !/^[0-9a-f]{64}$/.test(manifest.sha256)
  ) {
    throw new Error('Invalid document update upload manifest');
  }
}

function uploadRpcArgs(manifest: ChunkedDocumentUpdateManifest) {
  validateUploadManifest(manifest);
  return {
    p_upload_id: manifest.updateId,
    p_document_id: manifest.documentId,
    p_epoch: manifest.epoch,
    p_total_bytes: manifest.totalBytes,
    p_chunk_count: manifest.chunkCount,
    p_sha256: manifest.sha256,
  };
}

function resultRecord(data: unknown): Record<string, unknown> {
  if (
    data === null ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    throw new DocumentAccessError('Document update upload returned invalid state');
  }
  return Object.fromEntries(Object.entries(data));
}

function parseUploadIndexes(
  value: unknown,
  chunkCount: number
): number[] {
  try {
    return validateChunkIndexes(value, chunkCount);
  } catch {
    throw new DocumentAccessError('Document update upload returned invalid indexes');
  }
}

function firstRpcRow(data: unknown): DocumentStateRpcRow {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    throw new DocumentAccessError('Document state operation returned no state');
  }
  return row as DocumentStateRpcRow;
}

function parseDocumentEpochReason(value: unknown): DocumentEpochReason {
  return value === 'normalization' || value === 'restore' || value === 'agent'
    ? value
    : 'initialize';
}

function stateFromRpc(
  documentId: string,
  projectId: string,
  row: DocumentStateRpcRow,
  epochReason: DocumentEpochReason
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
    epochReason,
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
    const tail = await fetchAllPaged<DocumentUpdateRow>((from, to) =>
      client
        .from('document_yjs_updates')
        .select(DOCUMENT_UPDATE_COLUMNS)
        .eq('document_id', documentId)
        .eq('epoch', head.collab_epoch)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
          data: DocumentUpdateRow[] | null;
          error: { message: string } | null;
        }>
    );

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
        tail,
      };
    }
  }
  throw new DocumentStateConflictError(
    'Document state changed while reading',
    latestToken
  );
}

async function readAuthoritativeTransportState(
  client: SupabaseClient,
  documentId: string
): Promise<TransportReadResult> {
  const { head, tail } = await readRawDocumentState(client, documentId);
  const updateTail = tail.map((row) => ({
    id: row.id,
    updateBase64: row.update_data,
    createdAt: row.created_at,
  }));

  return {
    state: {
      documentId: head.id,
      projectId: head.project_id,
      mode: head.yjs_state === null ? 'legacy' : 'collaborative',
      yjsStateBase64: head.yjs_state,
      updateTail,
      token: {
        epoch: Number(head.collab_epoch),
        revision: Number(head.collab_revision),
      },
      epochReason: parseDocumentEpochReason(head.collab_epoch_reason),
      updatedAt: head.updated_at,
    },
    legacyMarkdown: head.content,
  };
}

export async function readDocumentTransportState(
  client: SupabaseClient,
  documentId: string
): Promise<AuthoritativeDocumentTransportState> {
  return (await readAuthoritativeTransportState(client, documentId)).state;
}

export async function readDocumentState(
  client: SupabaseClient,
  documentId: string
): Promise<AuthoritativeDocumentState> {
  const { state, legacyMarkdown } = await readAuthoritativeTransportState(
    client,
    documentId
  );
  const markdown = state.mode === 'collaborative'
    ? await documentContentCodec.yjsStateToMarkdown(
        state.yjsStateBase64!,
        state.updateTail.map((update) => update.updateBase64)
      )
    : legacyMarkdown;

  return {
    ...state,
    markdown,
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
    firstRpcRow(data),
    'initialize'
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

export async function prepareDocumentYjsUpdateUpload(
  client: SupabaseClient,
  manifest: ChunkedDocumentUpdateManifest
): Promise<PrepareDocumentYjsUpdateUploadResult> {
  const { data, error } = await client.rpc(
    'prepare_document_yjs_update_upload',
    uploadRpcArgs(manifest)
  );
  if (error) throwMutationError(error, { epoch: manifest.epoch, revision: 0 });
  const result = resultRecord(data);
  if (
    result.status !== 'uploading' &&
    result.status !== 'ready' &&
    result.status !== 'committed'
  ) {
    throw new DocumentAccessError('Document update upload returned invalid status');
  }
  const receivedIndexes = parseUploadIndexes(
    result.receivedIndexes,
    manifest.chunkCount
  );
  return { status: result.status, receivedIndexes };
}

export async function putDocumentYjsUpdateChunk(
  client: SupabaseClient,
  input: PutDocumentYjsUpdateChunkInput
): Promise<PutDocumentYjsUpdateChunkResult> {
  const { manifest } = input;
  const indexes = validateChunkIndexes([input.chunkIndex], manifest.chunkCount);
  if (!input.chunkBase64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.chunkBase64)) {
    throw new Error('Invalid document update chunk payload');
  }
  if (!/^[0-9a-f]{64}$/.test(input.chunkSha256)) {
    throw new Error('Invalid document update chunk hash');
  }
  const { data, error } = await client.rpc('put_document_yjs_update_chunk', {
    ...uploadRpcArgs(manifest),
    p_chunk_index: indexes[0],
    p_chunk_base64: input.chunkBase64,
    p_chunk_sha256: input.chunkSha256,
  });
  if (error) throwMutationError(error, { epoch: manifest.epoch, revision: 0 });
  const result = resultRecord(data);
  const receivedCount = result.receivedCount;
  if (
    typeof receivedCount !== 'number' ||
    !Number.isSafeInteger(receivedCount) ||
    receivedCount < 0 ||
    receivedCount > manifest.chunkCount
  ) {
    throw new DocumentAccessError('Document update upload returned invalid chunk count');
  }
  return { receivedCount };
}

export async function getDocumentYjsUpdateUploadStatus(
  client: SupabaseClient,
  manifest: ChunkedDocumentUpdateManifest
): Promise<DocumentYjsUpdateUploadStatus> {
  const { data, error } = await client.rpc(
    'get_document_yjs_update_upload_status',
    uploadRpcArgs(manifest)
  );
  if (error) throwMutationError(error, { epoch: manifest.epoch, revision: 0 });
  const result = resultRecord(data);
  if (
    result.status !== 'uploading' &&
    result.status !== 'ready' &&
    result.status !== 'committed' &&
    result.status !== 'expired'
  ) {
    throw new DocumentAccessError('Document update upload returned invalid status');
  }
  return {
    status: result.status,
    missingIndexes: parseUploadIndexes(result.missingIndexes, manifest.chunkCount),
  };
}

export async function finalizeDocumentYjsUpdateUpload(
  client: SupabaseClient,
  manifest: ChunkedDocumentUpdateManifest
): Promise<FinalizeDocumentYjsUpdateUploadResult> {
  const { data, error } = await client.rpc(
    'finalize_document_yjs_update_upload',
    uploadRpcArgs(manifest)
  );
  if (error) throwMutationError(error, { epoch: manifest.epoch, revision: 0 });
  const result = resultRecord(data);
  if (result.status !== 'committed') {
    throw new DocumentAccessError('Document update upload did not commit');
  }
  return { status: 'committed' };
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
  const normalized = await documentContentCodec.normalizeYjsState(
    head.yjs_state,
    updateTail
  );
  const includedUpdateIds = tail.map((row) => row.id);
  const { data, error } = await client.rpc('compact_document_collab_state', {
    p_document_id: input.documentId,
    p_expected_epoch: input.expected.epoch,
    p_expected_revision: input.expected.revision,
    p_included_update_ids: includedUpdateIds,
    p_yjs_state: normalized.yjsStateBase64,
    p_markdown: normalized.markdown,
  });
  if (error) throwMutationError(error, current);
  return stateFromRpc(
    input.documentId,
    head.project_id,
    firstRpcRow(data),
    parseDocumentEpochReason(head.collab_epoch_reason)
  );
}

export async function normalizeDocumentState(
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

  const normalized = await documentContentCodec.normalizeYjsState(
    head.yjs_state,
    tail.map((row) => row.update_data)
  );
  const { data, error } = await client.rpc('normalize_document_collab_state', {
    p_document_id: input.documentId,
    p_expected_epoch: input.expected.epoch,
    p_expected_revision: input.expected.revision,
    p_expected_update_ids: tail.map((row) => row.id),
    p_yjs_state: normalized.yjsStateBase64,
    p_markdown: normalized.markdown,
  });
  if (error) throwMutationError(error, current);
  return stateFromRpc(
    input.documentId,
    head.project_id,
    firstRpcRow(data),
    'normalization'
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
    firstRpcRow(data),
    input.reason
  );
}

export const documentStateGateway = {
  read: readDocumentState,
  readTransport: readDocumentTransportState,
  initialize: initializeDocumentState,
  appendUpdates: appendDocumentYjsUpdates,
  prepareUpdateUpload: prepareDocumentYjsUpdateUpload,
  putUpdateChunk: putDocumentYjsUpdateChunk,
  getUpdateUploadStatus: getDocumentYjsUpdateUploadStatus,
  finalizeUpdateUpload: finalizeDocumentYjsUpdateUpload,
  compact: compactDocumentState,
  normalize: normalizeDocumentState,
  replace: replaceDocumentState,
};
