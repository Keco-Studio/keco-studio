import type { SupabaseClient } from '@supabase/supabase-js';

export type ScriptWorkspaceDocumentRow = {
  project_id: string;
  document_id: string;
  imported_at: string;
  imported_by: string | null;
};

const SCRIPT_WORKSPACE_COLUMNS =
  'project_id, document_id, imported_at, imported_by';

export async function listScriptWorkspaceDocuments(
  supabase: SupabaseClient,
  projectId: string
): Promise<ScriptWorkspaceDocumentRow[]> {
  const { data, error } = await supabase
    .from('script_workspace_documents')
    .select(SCRIPT_WORKSPACE_COLUMNS)
    .eq('project_id', projectId);

  if (error) throw error;
  return (data ?? []) as ScriptWorkspaceDocumentRow[];
}

export async function isScriptWorkspaceDocument(
  supabase: SupabaseClient,
  { projectId, documentId }: { projectId: string; documentId: string }
): Promise<boolean> {
  const { data, error } = await supabase
    .from('script_workspace_documents')
    .select('document_id')
    .eq('project_id', projectId)
    .eq('document_id', documentId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function upsertScriptWorkspaceDocument(
  supabase: SupabaseClient,
  {
    projectId,
    documentId,
    userId,
  }: { projectId: string; documentId: string; userId: string }
): Promise<void> {
  const { data: doc, error } = await supabase
    .from('documents')
    .select('id, project_id')
    .eq('id', documentId)
    .single();

  if (error || !doc || doc.project_id !== projectId) {
    throw new Error('Document not found in project');
  }

  const { error: upsertError } = await supabase
    .from('script_workspace_documents')
    .upsert(
      { project_id: projectId, document_id: documentId, imported_by: userId },
      { onConflict: 'project_id,document_id', ignoreDuplicates: true }
    );

  if (upsertError) throw upsertError;
}

export async function deleteScriptWorkspaceDocument(
  supabase: SupabaseClient,
  { projectId, documentId }: { projectId: string; documentId: string }
): Promise<void> {
  const { error } = await supabase
    .from('script_workspace_documents')
    .delete()
    .eq('project_id', projectId)
    .eq('document_id', documentId);

  if (error) throw error;
}
