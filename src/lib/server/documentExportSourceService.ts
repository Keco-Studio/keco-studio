import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentExportSource } from '@/lib/documents/documentExportSource';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { createDocumentExportSnapshotToken } from './documentExportSnapshotSigning';

export async function getDocumentExportSource(
  supabase: SupabaseClient,
  userId: string,
  documentId: string
): Promise<DocumentExportSource> {
  const state = await documentStateGateway.read(supabase, documentId);
  const { role } = await getUserProjectRole(supabase, state.projectId, userId);
  if (role !== 'admin') {
    throw new Error('Only admin users can export project content');
  }

  const { data, error } = await supabase
    .from('documents')
    .select('name, folder_id')
    .eq('id', documentId)
    .single();
  if (error || !data) {
    throw new Error('Document not found or not accessible');
  }
  if (!state.markdown.trim()) {
    throw new Error('Document is empty');
  }

  const source = {
    documentId,
    documentName: data.name,
    projectId: state.projectId,
    folderId: data.folder_id ?? null,
    markdown: state.markdown,
    token: state.token,
  };
  return {
    ...source,
    snapshotToken: createDocumentExportSnapshotToken(source),
  };
}
