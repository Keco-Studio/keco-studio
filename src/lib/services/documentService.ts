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
import { isUuid } from '@/lib/utils/uuid';
import {
  verifyProjectAccess,
  getUserProjectRole,
  getCurrentUserId,
  AuthorizationError,
} from './authorizationService';
import { DocumentStateConflictError } from '@/lib/documents/documentStateTypes';

export type DocumentRecord = {
  id: string;
  project_id: string;
  folder_id: string | null;
  parent_document_id: string | null;
  name: string;
  description: string;
  content: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Lightweight row for the sidebar tree: excludes the (potentially large) content. */
export type DocumentSummary = Pick<
  DocumentRecord,
  | 'id'
  | 'project_id'
  | 'folder_id'
  | 'parent_document_id'
  | 'name'
  | 'description'
  | 'created_at'
  | 'updated_at'
>;

const DOCUMENT_RECORD_COLUMNS =
  'id, project_id, folder_id, parent_document_id, name, description, content, created_by, created_at, updated_at';
const DOCUMENT_SUMMARY_COLUMNS =
  'id, project_id, folder_id, parent_document_id, name, description, created_at, updated_at';
const DOCUMENT_LIST_PAGE_SIZE = 1000;

/**
 * Thrown when a document does not exist OR the caller cannot read it (RLS makes
 * these indistinguishable). Consumers should render an error state instead of a
 * perpetual loading spinner.
 */
export class DocumentNotFoundError extends Error {
  constructor(documentId: string) {
    super(`Document ${documentId} not found or not accessible`);
    this.name = 'DocumentNotFoundError';
  }
}

/** Assert a folder exists and belongs to `projectId`; returns the validated id. */
async function assertFolderInProject(
  supabase: SupabaseClient,
  folderId: string,
  projectId: string
): Promise<string> {
  if (!isUuid(folderId)) {
    throw new Error('Invalid folder ID format');
  }
  const { data: folder, error } = await supabase
    .from('folders')
    .select('project_id')
    .eq('id', folderId)
    .single();
  if (error || !folder || folder.project_id !== projectId) {
    throw new Error('Folder not found or does not belong to the project');
  }
  return folderId;
}

/** Owner or accepted admin/editor collaborator may mutate documents. */
async function verifyDocumentWritePermission(
  supabase: SupabaseClient,
  projectId: string,
  userId?: string
): Promise<void> {
  const { role } = await getUserProjectRole(supabase, projectId, userId);
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

  const documents: DocumentSummary[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('documents')
      .select(DOCUMENT_SUMMARY_COLUMNS)
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + DOCUMENT_LIST_PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    const page = (data ?? []) as DocumentSummary[];
    documents.push(...page);
    if (page.length < DOCUMENT_LIST_PAGE_SIZE) break;
    from += DOCUMENT_LIST_PAGE_SIZE;
  }

  return documents;
}

/**
 * Fetch a single document including its Markdown content.
 * Throws {@link DocumentNotFoundError} when the row is missing or unreadable so
 * the editor can distinguish "no access / deleted" from "still loading".
 */
export async function getDocument(
  supabase: SupabaseClient,
  documentId: string
): Promise<DocumentRecord> {
  if (!isUuid(documentId)) {
    throw new Error('Invalid document ID format');
  }

  const { data, error } = await supabase
    .from('documents')
    .select(DOCUMENT_RECORD_COLUMNS)
    .eq('id', documentId)
    .single();

  if (error) {
    // PGRST116 = no rows: either missing or hidden by RLS.
    if (error.code === 'PGRST116') {
      throw new DocumentNotFoundError(documentId);
    }
    throw error;
  }

  return data as unknown as DocumentRecord;
}

type CreateDocumentInput = {
  projectId: string;
  name: string;
  description?: string;
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

  // Cross-project integrity: a folder, when given, must live in this project.
  // The DB trigger enforces this too; validating here yields a clearer error.
  let folderId: string | null = null;
  if (input.folderId) {
    folderId = await assertFolderInProject(supabase, input.folderId, input.projectId);
  }

  const description = (input.description ?? '').trim();

  const { data, error } = await supabase
    .from('documents')
    .insert({
      project_id: input.projectId,
      folder_id: folderId,
      name,
      description,
      content: input.content ?? '',
      created_by: createdBy,
    })
    .select(DOCUMENT_RECORD_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  return data as unknown as DocumentRecord;
}

/** Rename a document. */
export async function updateDocumentName(
  supabase: SupabaseClient,
  documentId: string,
  name: string
): Promise<void> {
  await updateDocumentMetadata(supabase, documentId, { name });
}

/** Update document name and/or notes (description). */
export async function updateDocumentMetadata(
  supabase: SupabaseClient,
  documentId: string,
  updates: { name?: string; description?: string }
): Promise<void> {
  if (!isUuid(documentId)) {
    throw new Error('Invalid document ID format');
  }

  const projectId = await getDocumentProjectId(supabase, documentId);
  await verifyDocumentWritePermission(supabase, projectId);

  const payload: { name?: string; description?: string } = {};
  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (!trimmed) {
      throw new Error('Document name cannot be empty');
    }
    payload.name = trimmed;
  }
  if (updates.description !== undefined) {
    payload.description = updates.description.trim();
  }
  if (Object.keys(payload).length === 0) {
    return;
  }

  const { error } = await supabase
    .from('documents')
    .update(payload)
    .eq('id', documentId);

  if (error) {
    throw error;
  }
}

type MoveDocumentInput = {
  folderId: string | null;
  /** When set, nests under this document (folder follows parent). Null clears nesting. */
  parentDocumentId?: string | null;
};

/** Move a document to a folder/root and/or nest/unnest under another document. */
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

  const parentDocumentId =
    input.parentDocumentId === undefined ? undefined : input.parentDocumentId;

  let folderId: string | null = input.folderId;
  let nextParentId: string | null | undefined = parentDocumentId;

  if (parentDocumentId) {
    if (!isUuid(parentDocumentId)) {
      throw new Error('Invalid parent document ID format');
    }
    if (parentDocumentId === documentId) {
      throw new Error('Document cannot be its own parent');
    }
    const { data: parent, error: parentError } = await supabase
      .from('documents')
      .select('id, project_id, folder_id')
      .eq('id', parentDocumentId)
      .single();
    if (parentError || !parent || parent.project_id !== projectId) {
      throw new Error('Parent document not found in this project');
    }
    folderId = parent.folder_id ?? null;
    nextParentId = parentDocumentId;
  } else if (parentDocumentId === null) {
    nextParentId = null;
    if (input.folderId) {
      folderId = await assertFolderInProject(supabase, input.folderId, projectId);
    } else {
      folderId = null;
    }
  } else {
    // Folder-only move: clear nesting so folder_id can diverge from a former parent.
    nextParentId = null;
    if (input.folderId) {
      folderId = await assertFolderInProject(supabase, input.folderId, projectId);
    } else {
      folderId = null;
    }
  }

  const updatePayload: {
    folder_id: string | null;
    parent_document_id?: string | null;
  } = { folder_id: folderId };
  if (nextParentId !== undefined) {
    updatePayload.parent_document_id = nextParentId;
  }

  const { error } = await supabase
    .from('documents')
    .update(updatePayload)
    .eq('id', documentId);

  if (error) {
    throw error;
  }
}

/** Nest a document under another document (same folder as parent). */
export async function nestDocumentUnderDocument(
  supabase: SupabaseClient,
  documentId: string,
  parentDocumentId: string
): Promise<void> {
  await moveDocument(supabase, documentId, {
    folderId: null,
    parentDocumentId,
  });
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

export type DeleteDocumentExpectedSnapshot = {
  documentId: string;
  projectId: string;
  name: string;
  folderId: string | null;
  updatedAt: string;
  expected: { epoch: number; revision: number };
  expectedUpdateIds: readonly string[];
};

export async function deleteDocumentIfUnchanged(
  supabase: SupabaseClient,
  snapshot: DeleteDocumentExpectedSnapshot
): Promise<void> {
  if (
    !isUuid(snapshot.documentId) ||
    !isUuid(snapshot.projectId) ||
    (snapshot.folderId !== null && !isUuid(snapshot.folderId)) ||
    !snapshot.expectedUpdateIds.every(isUuid) ||
    !Number.isInteger(snapshot.expected.epoch) ||
    snapshot.expected.epoch < 0 ||
    !Number.isInteger(snapshot.expected.revision) ||
    snapshot.expected.revision < 0
  ) {
    throw new Error('Invalid atomic document deletion snapshot');
  }

  const { data, error } = await supabase.rpc('delete_document_if_unchanged', {
    p_document_id: snapshot.documentId,
    p_project_id: snapshot.projectId,
    p_expected_name: snapshot.name,
    p_expected_folder_id: snapshot.folderId,
    p_expected_updated_at: snapshot.updatedAt,
    p_expected_epoch: snapshot.expected.epoch,
    p_expected_revision: snapshot.expected.revision,
    p_expected_update_ids: [...snapshot.expectedUpdateIds],
  });
  if (error) {
    if (error.code === 'PT409') {
      throw new DocumentStateConflictError(error.message, snapshot.expected);
    }
    throw error;
  }
  if (data !== snapshot.documentId) {
    throw new AuthorizationError('Document not found');
  }
}
