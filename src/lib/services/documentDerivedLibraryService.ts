import type { SupabaseClient } from '@supabase/supabase-js';

export type DocumentExportType = 'table' | 'script';

export type DocumentLibrarySource = {
  sourceDocumentId: string;
  exportType: DocumentExportType;
};

export type DerivedLibraryPlacement = {
  projectId: string;
  folderId: string | null;
  sourceDocumentId: string;
  documentExportType: DocumentExportType;
};

export async function resolveDerivedLibraryPlacement(
  supabase: SupabaseClient,
  projectId: string,
  source: DocumentLibrarySource
): Promise<DerivedLibraryPlacement> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, project_id, folder_id')
    .eq('id', source.sourceDocumentId)
    .single();

  if (error || !data || data.project_id !== projectId) {
    throw new Error('Source document not found in this project');
  }

  return {
    projectId,
    folderId: data.folder_id ?? null,
    sourceDocumentId: data.id,
    documentExportType: source.exportType,
  };
}
