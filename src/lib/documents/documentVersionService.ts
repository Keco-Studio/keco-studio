import type { SupabaseClient } from '@supabase/supabase-js';
import { validateName } from '@/lib/utils/nameValidation';
import { isUuid } from '@/lib/utils/uuid';
import {
  documentContentCodec,
  mergeYjsState,
} from './documentContentCodec';
import { readDocumentState } from './documentStateGateway';
import {
  DocumentAccessError,
  DocumentCollaborationUnavailableError,
  DocumentReadOnlyError,
  DocumentStateConflictError,
  type DocumentStateToken,
} from './documentStateTypes';

const DOCUMENT_VERSION_METADATA_COLUMNS =
  'id, document_id, project_id, name, version_type, source_version_id, snapshot_epoch, snapshot_revision, created_by, created_at';
const DOCUMENT_VERSION_PREVIEW_COLUMNS = `${DOCUMENT_VERSION_METADATA_COLUMNS}, snapshot_content`;
const DOCUMENT_ACCESS_PROBE_COLUMNS = 'id';
const PROFILE_COLUMNS = 'id, full_name, username';
const MAX_CREATE_ATTEMPTS = 3;

export type DocumentVersionType =
  | 'manual'
  | 'automatic'
  | 'pre_restore'
  | 'restore'
  | 'pre_agent'
  | 'import';

export type DocumentVersionSummary = {
  id: string;
  documentId: string;
  projectId: string;
  name: string;
  type: DocumentVersionType;
  sourceVersionId: string | null;
  snapshotToken: DocumentStateToken;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type DocumentVersionPreview = DocumentVersionSummary & {
  markdown: string;
};

type DocumentVersionRow = {
  id?: string;
  version_id?: string;
  document_id: string;
  project_id: string;
  name: string;
  version_type: DocumentVersionType;
  source_version_id: string | null;
  snapshot_epoch: number;
  snapshot_revision: number;
  created_by: string | null;
  created_at: string;
  snapshot_content?: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  username: string | null;
};

function assertDocumentId(documentId: string): void {
  if (!isUuid(documentId)) throw new Error('Invalid document ID format');
}

function assertVersionId(versionId: string): void {
  if (!isUuid(versionId)) throw new Error('Invalid document version ID format');
}

function normalizeVersionName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error('Version name is required');
  if (normalized.length > 120) {
    throw new Error('Version name must be 120 characters or fewer');
  }
  const validationError = validateName(normalized);
  if (validationError) throw new Error(validationError);
  return normalized;
}

function isConflictError(error: { code?: string } | null): boolean {
  return error?.code === 'PT409';
}

function throwVersionReadError(error: { code?: string }): never {
  if (error.code === '42501' || error.code === 'PGRST116') {
    throw new DocumentAccessError();
  }
  throw error;
}

function throwMutationError(
  error: { code?: string; message?: string },
  token?: DocumentStateToken
): never {
  if (isConflictError(error)) {
    throw new DocumentStateConflictError(error.message, token);
  }
  if (error.code === 'P0002' || error.code === 'PGRST116') {
    throw new DocumentAccessError('Document version not found');
  }
  if (error.code === '42501') throw new DocumentReadOnlyError();
  throw error;
}

function firstVersionRow(data: unknown): DocumentVersionRow {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    throw new DocumentAccessError('Document version operation returned no row');
  }
  return row as DocumentVersionRow;
}

function profileName(profile: ProfileRow | undefined): string | null {
  return profile?.full_name?.trim() || profile?.username?.trim() || null;
}

function mapVersionRow(
  row: DocumentVersionRow,
  profiles: ReadonlyMap<string, ProfileRow>
): DocumentVersionSummary {
  const id = row.version_id ?? row.id;
  if (!id) throw new DocumentAccessError('Document version row has no id');
  return {
    id,
    documentId: row.document_id,
    projectId: row.project_id,
    name: row.name,
    type: row.version_type,
    sourceVersionId: row.source_version_id,
    snapshotToken: {
      epoch: Number(row.snapshot_epoch),
      revision: Number(row.snapshot_revision),
    },
    createdBy: row.created_by,
    createdByName: row.created_by
      ? profileName(profiles.get(row.created_by))
      : null,
    createdAt: row.created_at,
  };
}

async function loadProfiles(
  client: SupabaseClient,
  rows: readonly DocumentVersionRow[]
): Promise<Map<string, ProfileRow>> {
  const ids = [...new Set(rows.flatMap((row) => (row.created_by ? [row.created_by] : [])))];
  if (ids.length === 0) return new Map();
  const { data, error } = await client
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .in('id', ids);
  if (error || !data) return new Map();
  return new Map(
    (data as unknown as ProfileRow[]).map((profile) => [profile.id, profile])
  );
}

export async function listDocumentVersions(
  client: SupabaseClient,
  documentId: string
): Promise<DocumentVersionSummary[]> {
  assertDocumentId(documentId);
  const { data, error } = await client
    .from('document_versions')
    .select(DOCUMENT_VERSION_METADATA_COLUMNS)
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throwVersionReadError(error);
  const rows = (data ?? []) as unknown as DocumentVersionRow[];
  if (rows.length === 0) {
    const { data: document, error: accessError } = await client
      .from('documents')
      .select(DOCUMENT_ACCESS_PROBE_COLUMNS)
      .eq('id', documentId)
      .maybeSingle();
    if (accessError) throwVersionReadError(accessError);
    if (!document) throw new DocumentAccessError();
  }
  const profiles = await loadProfiles(client, rows);
  return rows.map((row) => mapVersionRow(row, profiles));
}

export async function getDocumentVersionPreview(
  client: SupabaseClient,
  documentId: string,
  versionId: string
): Promise<DocumentVersionPreview> {
  assertDocumentId(documentId);
  assertVersionId(versionId);
  const { data, error } = await client
    .from('document_versions')
    .select(DOCUMENT_VERSION_PREVIEW_COLUMNS)
    .eq('document_id', documentId)
    .eq('id', versionId)
    .single();
  if (error || !data) {
    if (!error || error.code === 'PGRST116' || error.code === '42501') {
      throw new DocumentAccessError();
    }
    throw error;
  }
  const row = data as unknown as DocumentVersionRow;
  const profiles = await loadProfiles(client, [row]);
  return {
    ...mapVersionRow(row, profiles),
    markdown: row.snapshot_content ?? '',
  };
}

export async function deleteDocumentVersion(
  client: SupabaseClient,
  documentId: string,
  versionId: string
): Promise<string> {
  assertDocumentId(documentId);
  assertVersionId(versionId);
  const { data, error } = await client.rpc('delete_document_version', {
    p_document_id: documentId,
    p_version_id: versionId,
  });
  if (error) throwMutationError(error);
  if (data !== versionId) {
    throw new DocumentAccessError('Document version deletion returned no id');
  }
  return data;
}

export async function createDocumentVersion(
  client: SupabaseClient,
  input: { documentId: string; name: string }
): Promise<DocumentVersionSummary> {
  assertDocumentId(input.documentId);
  const name = normalizeVersionName(input.name);
  const versionId = globalThis.crypto.randomUUID();

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const state = await readDocumentState(client, input.documentId);
    if (state.mode !== 'collaborative' || !state.yjsStateBase64) {
      throw new DocumentCollaborationUnavailableError(
        'Document collaboration must be initialized before creating a version'
      );
    }
    const merged = mergeYjsState(
      state.yjsStateBase64,
      state.updateTail.map((update) => update.updateBase64)
    );
    const markdown = await documentContentCodec.yjsStateToMarkdown(merged, []);
    const { data, error } = await client.rpc('create_document_version', {
      p_version_id: versionId,
      p_document_id: input.documentId,
      p_expected_epoch: state.token.epoch,
      p_expected_revision: state.token.revision,
      p_included_update_ids: state.updateTail.map((update) => update.id),
      p_name: name,
      p_yjs_state: merged,
      p_markdown: markdown,
    });

    if (error) {
      if (isConflictError(error) && attempt + 1 < MAX_CREATE_ATTEMPTS) continue;
      throwMutationError(error, state.token);
    }

    const row = firstVersionRow(data);
    const profiles = await loadProfiles(client, [row]);
    return mapVersionRow(row, profiles);
  }

  throw new DocumentStateConflictError('Document state changed repeatedly');
}

export async function createDocumentImportCheckpoint(
  client: SupabaseClient,
  input: {
    documentId: string;
    expected: DocumentStateToken;
    name: string;
  }
): Promise<DocumentVersionSummary> {
  assertDocumentId(input.documentId);
  const name = normalizeVersionName(input.name);
  if (
    !Number.isSafeInteger(input.expected.epoch) ||
    input.expected.epoch < 0 ||
    !Number.isSafeInteger(input.expected.revision) ||
    input.expected.revision < 0
  ) {
    throw new Error('Invalid document state token');
  }

  const { data, error } = await client.rpc('create_document_import_checkpoint', {
    p_version_id: globalThis.crypto.randomUUID(),
    p_document_id: input.documentId,
    p_expected_epoch: input.expected.epoch,
    p_expected_revision: input.expected.revision,
    p_name: name,
  });
  if (error) throwMutationError(error, input.expected);
  const row = firstVersionRow(data);
  const profiles = await loadProfiles(client, [row]);
  return mapVersionRow(row, profiles);
}
