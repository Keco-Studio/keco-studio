import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkProjectDocument, hashContent } from '@/lib/agent/chunking';
import { embedTexts } from '@/lib/agent/embedding-client';
import { AGENT_INDEXING_ENABLED } from '@/lib/agent/embedding-config';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { fetchAllPaged } from '@/lib/services/pagination';
import { isUuid } from '@/lib/utils/uuid';
import { getSupabaseServiceRoleClient } from './supabaseServiceRole';

type DocumentIndexScope = {
  actorUserId: string;
  projectId: string;
  documentId: string;
};

type DocumentReindexResult = {
  documentId: string;
  chunks: number;
  skipped?: true;
};

type ProjectDocumentsReindexResult = {
  documents: number;
  chunks: number;
  skipped?: true;
};

type DocumentMetadata = {
  id: string;
  project_id: string;
  folder_id: string | null;
  name: string;
  updated_at?: string;
};

export class ProjectDocumentIndexAccessError extends Error {
  constructor(message = 'Project document indexing access denied') {
    super(message);
    this.name = 'ProjectDocumentIndexAccessError';
  }
}

function assertScope(input: DocumentIndexScope): void {
  if (!isUuid(input.actorUserId) || !isUuid(input.projectId) || !isUuid(input.documentId)) {
    throw new Error('Invalid project document indexing scope');
  }
}

async function assertActorProjectAccess(
  admin: SupabaseClient,
  actorUserId: string,
  projectId: string
): Promise<void> {
  const { data, error } = await admin.rpc('user_has_project_access', {
    p_project_id: projectId,
    p_user_id: actorUserId,
  });
  if (error || data !== true) throw new ProjectDocumentIndexAccessError();
}

async function clearDocumentChunks(
  admin: SupabaseClient,
  projectId: string,
  documentId: string
): Promise<void> {
  const { error } = await admin
    .from('agent_embedding_chunks')
    .delete()
    .eq('project_id', projectId)
    .eq('source_type', 'project_document')
    .like('source_id', `${documentId}:%`);
  if (error) throw error;
}

async function loadDocumentMetadata(
  admin: SupabaseClient,
  projectId: string,
  documentId: string
): Promise<DocumentMetadata> {
  const { data, error } = await admin
    .from('documents')
    .select('id, project_id, folder_id, name, updated_at')
    .eq('id', documentId)
    .eq('project_id', projectId)
    .single();
  if (error || !data) {
    throw new ProjectDocumentIndexAccessError('Document is not readable in this project');
  }
  return data as DocumentMetadata;
}

async function folderNameFor(
  admin: SupabaseClient,
  projectId: string,
  folderId: string | null
): Promise<string | null> {
  if (!folderId) return null;
  const { data, error } = await admin
    .from('folders')
    .select('name')
    .eq('id', folderId)
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw error;
  return typeof data?.name === 'string' ? data.name : null;
}

async function reindexWithVerifiedActor(
  admin: SupabaseClient,
  input: DocumentIndexScope
): Promise<{ documentId: string; chunks: number }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await documentStateGateway.read(admin, input.documentId);
    if (state.documentId !== input.documentId || state.projectId !== input.projectId) {
      throw new ProjectDocumentIndexAccessError('Document project mismatch');
    }
    const metadata = await loadDocumentMetadata(admin, input.projectId, input.documentId);
    if (metadata.updated_at && metadata.updated_at !== state.updatedAt) continue;
    const folderName = await folderNameFor(admin, input.projectId, metadata.folder_id);
    const chunks = chunkProjectDocument(state.markdown);
    const embeddings = chunks.length > 0
      ? await embedTexts(chunks.map((chunk) => chunk.content))
      : [];
    if (embeddings.length !== chunks.length) {
      throw new Error('Embedding response did not match project document chunks');
    }
    const rows = chunks.map((chunk, index) => ({
      sourceId: `${input.documentId}:chunk:${chunk.chunkIndex}`,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      contentHash: hashContent(chunk.content),
      metadata: {
        documentId: input.documentId,
        documentName: metadata.name,
        folderId: metadata.folder_id,
        folderName,
        ...(chunk.heading ? { heading: chunk.heading } : {}),
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        documentUpdatedAt: state.updatedAt,
      },
      embedding: embeddings[index],
    }));
    const { data, error } = await admin.rpc(
      'replace_project_document_embedding_chunks',
      {
        p_project_id: input.projectId,
        p_document_id: input.documentId,
        p_expected_updated_at: state.updatedAt,
        p_expected_epoch: state.token.epoch,
        p_expected_revision: state.token.revision,
        p_expected_update_ids: state.updateTail.map((update) => update.id),
        p_rows: rows,
      }
    );
    if (error) throw error;
    if (data === true) return { documentId: input.documentId, chunks: rows.length };
  }
  throw new Error('Document state changed repeatedly during embedding indexing');
}

export async function reindexProjectDocumentAsActor(
  input: DocumentIndexScope
): Promise<DocumentReindexResult> {
  assertScope(input);
  if (!AGENT_INDEXING_ENABLED) {
    return { documentId: input.documentId, chunks: 0, skipped: true };
  }
  const admin = getSupabaseServiceRoleClient();
  await assertActorProjectAccess(admin, input.actorUserId, input.projectId);
  return reindexWithVerifiedActor(admin, input);
}

export async function removeProjectDocumentIndex(input: DocumentIndexScope): Promise<void> {
  assertScope(input);
  const admin = getSupabaseServiceRoleClient();
  await assertActorProjectAccess(admin, input.actorUserId, input.projectId);
  await clearDocumentChunks(admin, input.projectId, input.documentId);
}

export async function reindexProjectDocumentsAsActor(input: {
  actorUserId: string;
  projectId: string;
}): Promise<ProjectDocumentsReindexResult> {
  if (!isUuid(input.actorUserId) || !isUuid(input.projectId)) {
    throw new Error('Invalid project document indexing scope');
  }
  if (!AGENT_INDEXING_ENABLED) {
    return { documents: 0, chunks: 0, skipped: true };
  }
  const admin = getSupabaseServiceRoleClient();
  await assertActorProjectAccess(admin, input.actorUserId, input.projectId);
  const documents = await fetchAllPaged<DocumentMetadata>((from, to) =>
    admin
      .from('documents')
      .select('id, project_id, folder_id, name, updated_at')
      .eq('project_id', input.projectId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
        data: DocumentMetadata[] | null;
        error: { message: string } | null;
      }>
  );
  let chunks = 0;
  for (const document of documents) {
    const result = await reindexWithVerifiedActor(admin, {
      ...input,
      documentId: document.id,
    });
    chunks += result.chunks;
  }
  return { documents: documents.length, chunks };
}
