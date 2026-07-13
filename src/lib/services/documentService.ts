/**
 * Document Service
 *
 * Isomorphic CRUD for project-scoped rich-text documents (Markdown content
 * authored with MDXEditor). Follows the service conventions used across the
 * codebase: the first argument is always a SupabaseClient and there is no
 * 'use client' directive, so API routes and agent tools can import it directly
 * (the data-access.ts boundary lesson from GitHub #217).
 *
 * Access is enforced twice: RLS on the documents table (source of truth) and
 * these app-level permission checks (fast feedback + parity with the rest of
 * the services). Writes require owner/admin/editor; reads allow any accepted
 * collaborator, including viewers.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  verifyProjectAccess,
  getUserProjectRole,
  getCurrentUserId,
  AuthorizationError,
} from './authorizationService';

export type DocumentRecord = {
  id: string;
  project_id: string;
  folder_id: string | null;
  name: string;
  content: string;
  /** Base64 Y.encodeStateAsUpdate; null until the first collab persist. */
  yjs_state: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Lightweight row for the sidebar tree: excludes the (potentially large) content. */
export type DocumentSummary = Pick<
  DocumentRecord,
  'id' | 'project_id' | 'folder_id' | 'name' | 'created_at' | 'updated_at'
>;

const DOCUMENT_SUMMARY_COLUMNS = 'id, project_id, folder_id, name, created_at, updated_at';

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Owner or accepted admin/editor collaborator may mutate documents. */
async function verifyDocumentWritePermission(
  supabase: SupabaseClient,
  projectId: string,
  userId?: string
): Promise<void> {
  const role = await getUserProjectRole(supabase, projectId, userId);
  if (role !== 'admin' && role !== 'editor') {
    throw new AuthorizationError('Only admin and editor users can modify documents');
  }
}

async function getDocumentProjectId(
  supabase: SupabaseClient,
  documentId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('documents')
    .select('project_id')
    .eq('id', documentId)
    .single();
  if (error || !data) {
    throw new AuthorizationError('Document not found');
  }
  return data.project_id as string;
}

/**
 * List documents in a project for the sidebar tree. Excludes the content column
 * so large Markdown payloads never travel with the tree query.
 */
export async function listDocuments(
  supabase: SupabaseClient,
  projectId: string
): Promise<DocumentSummary[]> {
  if (!isUuid(projectId)) {
    throw new Error('Invalid project ID format');
  }

  await verifyProjectAccess(supabase, projectId);

  const { data, error } = await supabase
    .from('documents')
    .select(DOCUMENT_SUMMARY_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as DocumentSummary[];
}

/** Fetch a single document including its Markdown content. */
export async function getDocument(
  supabase: SupabaseClient,
  documentId: string
): Promise<DocumentRecord | null> {
  if (!isUuid(documentId)) {
    throw new Error('Invalid document ID format');
  }

  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw error;
  }

  return data as DocumentRecord;
}

type CreateDocumentInput = {
  projectId: string;
  name: string;
  folderId?: string | null;
  content?: string;
};

/** Create a document. Returns the new row (id + metadata). */
export async function createDocument(
  supabase: SupabaseClient,
  input: CreateDocumentInput
): Promise<DocumentRecord> {
  const name = input.name.trim();
  if (!name) {
    throw new Error('Document name is required.');
  }
  if (!isUuid(input.projectId)) {
    throw new Error('Invalid project ID format');
  }

  await verifyDocumentWritePermission(supabase, input.projectId);
  const createdBy = await getCurrentUserId(supabase);

  let folderId: string | null = null;
  if (input.folderId) {
    if (!isUuid(input.folderId)) {
      throw new Error('Invalid folder ID format');
    }
    folderId = input.folderId;
  }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      project_id: input.projectId,
      folder_id: folderId,
      name,
      content: input.content ?? '',
      created_by: createdBy,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data as DocumentRecord;
}

/** Rename a document. */
export async function updateDocumentName(
  supabase: SupabaseClient,
  documentId: string,
  name: string
): Promise<void> {
  if (!isUuid(documentId)) {
    throw new Error('Invalid document ID format');
  }
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Document name cannot be empty');
  }

  const projectId = await getDocumentProjectId(supabase, documentId);
  await verifyDocumentWritePermission(supabase, projectId);

  const { error } = await supabase
    .from('documents')
    .update({ name: trimmed })
    .eq('id', documentId);

  if (error) {
    throw error;
  }
}

/**
 * Persist collaborative document state: authoritative Yjs snapshot plus a
 * Markdown derivative for export/agent/sidebar consumers. Concurrent editing
 * is resolved by Yjs CRDT over Realtime; this write is durability only (no LWW).
 */
export async function persistDocumentCollabState(
  supabase: SupabaseClient,
  documentId: string,
  input: { yjsStateBase64: string; content: string }
): Promise<{ updatedAt: string }> {
  if (!isUuid(documentId)) {
    throw new Error('Invalid document ID format');
  }

  const projectId = await getDocumentProjectId(supabase, documentId);
  await verifyDocumentWritePermission(supabase, projectId);

  const { data, error } = await supabase
    .from('documents')
    .update({
      yjs_state: input.yjsStateBase64,
      content: input.content,
    })
    .eq('id', documentId)
    .select('updated_at')
    .single();

  if (error) {
    throw error;
  }

  return { updatedAt: (data as { updated_at: string }).updated_at };
}

/**
 * Persist Markdown content for a document.
 * Pass `userId` when the caller already resolved auth (e.g. editor shell) so
 * we do not re-hit Auth during autosave / Fast Refresh.
 */
export async function updateDocumentContent(
  supabase: SupabaseClient,
  documentId: string,
  content: string,
  userId?: string
): Promise<{ updatedAt: string }> {
  if (!isUuid(documentId)) {
    throw new Error('Invalid document ID format');
  }

  const projectId = await getDocumentProjectId(supabase, documentId);
  await verifyDocumentWritePermission(supabase, projectId, userId);

  const { data, error } = await supabase
    .from('documents')
    .update({ content })
    .eq('id', documentId)
    .select('updated_at')
    .single();

  if (error) {
    throw error;
  }

  return { updatedAt: (data as { updated_at: string }).updated_at };
}

type MoveDocumentInput = {
  folderId: string | null;
};

/** Move a document to another folder in the same project (or to the root). */
export async function moveDocument(
  supabase: SupabaseClient,
  documentId: string,
  input: MoveDocumentInput
): Promise<void> {
  if (!isUuid(documentId)) {
    throw new Error('Invalid document ID format');
  }

  const projectId = await getDocumentProjectId(supabase, documentId);
  await verifyDocumentWritePermission(supabase, projectId);

  let folderId: string | null = null;
  if (input.folderId) {
    if (!isUuid(input.folderId)) {
      throw new Error('Invalid folder ID format');
    }
    const { data: folder, error: folderError } = await supabase
      .from('folders')
      .select('project_id')
      .eq('id', input.folderId)
      .single();
    if (folderError || !folder || folder.project_id !== projectId) {
      throw new Error('Folder not found or does not belong to the project');
    }
    folderId = input.folderId;
  }

  const { error } = await supabase
    .from('documents')
    .update({ folder_id: folderId })
    .eq('id', documentId);

  if (error) {
    throw error;
  }
}

/** Delete a document. */
export async function deleteDocument(
  supabase: SupabaseClient,
  documentId: string
): Promise<void> {
  if (!isUuid(documentId)) {
    throw new Error('Invalid document ID format');
  }

  const projectId = await getDocumentProjectId(supabase, documentId);
  await verifyDocumentWritePermission(supabase, projectId);

  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId);

  if (error) {
    throw error;
  }
}
