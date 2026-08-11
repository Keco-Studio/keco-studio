import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { AuthorizationError, getUserProjectRole } from '@/lib/services/authorizationService';

export type CreateMapDocumentSource = {
  documentId: string;
  projectId: string;
  documentName: string;
  documentUpdatedAt: string;
  markdown: string;
  token: { epoch: number; revision: number };
};

export class CreateMapDocumentSourceError extends Error {
  constructor(readonly code: 'document_not_found' | 'document_project_mismatch' | 'document_empty') {
    super(code);
    this.name = 'CreateMapDocumentSourceError';
  }
}

export async function readCreateMapDocumentSource(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  documentId: string
): Promise<CreateMapDocumentSource> {
  const { role } = await getUserProjectRole(supabase, projectId, userId);
  if (role !== 'admin' && role !== 'editor') {
    throw new AuthorizationError('Only admin and editor users can create maps');
  }

  const { data, error } = await supabase
    .from('documents')
    .select('name, project_id, updated_at')
    .eq('id', documentId)
    .single();
  if (error || !data) throw new CreateMapDocumentSourceError('document_not_found');
  if (data.project_id !== projectId) throw new CreateMapDocumentSourceError('document_project_mismatch');

  const state = await documentStateGateway.read(supabase, documentId);
  if (state.projectId !== projectId) throw new CreateMapDocumentSourceError('document_project_mismatch');
  if (!state.markdown.trim()) throw new CreateMapDocumentSourceError('document_empty');

  return {
    documentId,
    projectId: state.projectId,
    documentName: data.name as string,
    documentUpdatedAt: state.updatedAt || (data.updated_at as string),
    markdown: state.markdown,
    token: state.token,
  };
}
