import type { SupabaseClient } from '@supabase/supabase-js';
import { getFolder } from './folderService';

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

export interface DocumentLibrarySourceDisplay {
  documentName: string;
  folderId?: string;
  folderName?: string;
}

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

/** Resolve mutable display placement without exposing source ids to the model. */
export async function resolveDocumentLibrarySourceDisplay(
  supabase: SupabaseClient,
  projectId: string,
  source: DocumentLibrarySource
): Promise<DocumentLibrarySourceDisplay> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, name, project_id, folder_id')
    .eq('id', source.sourceDocumentId)
    .single();

  if (error || !data || data.project_id !== projectId) {
    throw new Error('Source document not found in this project');
  }

  if (!data.folder_id) {
    return { documentName: data.name };
  }

  const folder = await getFolder(supabase, data.folder_id);
  if (!folder || folder.project_id !== projectId) {
    throw new Error('Source document folder not found in this project');
  }

  return {
    documentName: data.name,
    folderId: folder.id,
    folderName: folder.name,
  };
}
