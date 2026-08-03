import 'server-only';

import type { DocumentRecord } from '@/lib/services/documentService';
import { isUuid } from '@/lib/utils/uuid';
import { getSupabaseServiceRoleClient } from './supabaseServiceRole';

function firstDocument(data: unknown): DocumentRecord {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('Import transaction returned no document');
  return row as DocumentRecord;
}

export async function publishImportedDocumentAsActor(input: {
  documentId: string;
  versionId: string;
  actorUserId: string;
  projectId: string;
  folderId: string | null;
  name: string;
  description?: string | null;
  markdown: string;
}): Promise<DocumentRecord> {
  if (
    !isUuid(input.documentId) ||
    !isUuid(input.versionId) ||
    !isUuid(input.actorUserId) ||
    !isUuid(input.projectId) ||
    (input.folderId !== null && !isUuid(input.folderId))
  ) {
    throw new Error('Invalid document import scope');
  }
  const name = input.name.trim();
  if (!name || name.length > 255) throw new Error('Invalid document name');
  const description = input.description?.trim() ?? '';
  if (description.length > 250) throw new Error('Invalid document notes');
  const { documentContentCodec } = await import('@/lib/documents/documentContentCodec');
  documentContentCodec.validate(input.markdown);
  const yjsState = await documentContentCodec.markdownToYjsState(input.markdown);
  const admin = getSupabaseServiceRoleClient();
  const { data, error } = await admin.rpc('create_imported_document', {
    p_document_id: input.documentId,
    p_version_id: input.versionId,
    p_actor_user_id: input.actorUserId,
    p_project_id: input.projectId,
    p_folder_id: input.folderId,
    p_name: name,
    p_description: description,
    p_markdown: input.markdown,
    p_yjs_state: yjsState,
  });
  if (error) throw error;
  return firstDocument(data);
}
