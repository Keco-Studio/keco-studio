import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listDocuments,
  type DocumentSummary,
} from '@/lib/services/documentService';
import { listProjectFolders } from './data-access';

export interface DocumentSelector {
  documentId?: string;
  documentName?: string;
  folderName?: string;
}

export type ResolvedDocument = DocumentSummary & {
  folderName: string | null;
};

type DocumentCandidate = {
  id: string;
  name: string;
  folderId: string | null;
  folderName: string | null;
  updatedAt: string;
};

export type DocumentResolution =
  | {
      ok: true;
      document: ResolvedDocument;
      source: 'id' | 'name' | 'current';
    }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'AMBIGUOUS' | 'NO_TARGET';
      error: string;
      candidates?: DocumentCandidate[];
    };

function candidateFromDocument(document: ResolvedDocument): DocumentCandidate {
  return {
    id: document.id,
    name: document.name,
    folderId: document.folder_id,
    folderName: document.folderName,
    updatedAt: document.updated_at,
  };
}

export async function listResolvedProjectDocuments(
  supabase: SupabaseClient,
  projectId: string
): Promise<ResolvedDocument[]> {
  const [documents, folders] = await Promise.all([
    listDocuments(supabase, projectId),
    listProjectFolders(supabase, projectId),
  ]);
  const folderNameById = new Map(folders.map((folder) => [folder.id, folder.name]));

  return documents.map((document) => ({
    ...document,
    folderName: document.folder_id
      ? folderNameById.get(document.folder_id) ?? null
      : null,
  }));
}

export async function resolveDocumentForTool(
  supabase: SupabaseClient,
  projectId: string,
  selector: DocumentSelector,
  context: { currentDocumentId?: string }
): Promise<DocumentResolution> {
  const documents = await listResolvedProjectDocuments(supabase, projectId);

  if (selector.documentId !== undefined) {
    const document = documents.find((row) => row.id === selector.documentId);
    if (document) return { ok: true, document, source: 'id' };
    return {
      ok: false,
      code: 'NOT_FOUND',
      error: `Document "${selector.documentId}" was not found in this project.`,
    };
  }

  if (selector.documentName !== undefined) {
    const matches = documents.filter(
      (row) =>
        row.name === selector.documentName &&
        (selector.folderName === undefined || row.folderName === selector.folderName)
    );
    if (matches.length === 1) {
      return { ok: true, document: matches[0], source: 'name' };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        code: 'AMBIGUOUS',
        error: `Multiple documents named "${selector.documentName}" were found in this project.`,
        candidates: matches.map(candidateFromDocument),
      };
    }
    const folderQualifier =
      selector.folderName === undefined ? '' : ` in folder "${selector.folderName}"`;
    return {
      ok: false,
      code: 'NOT_FOUND',
      error: `Document "${selector.documentName}"${folderQualifier} was not found in this project.`,
    };
  }

  if (context.currentDocumentId !== undefined) {
    const document = documents.find((row) => row.id === context.currentDocumentId);
    if (document) return { ok: true, document, source: 'current' };
    return {
      ok: false,
      code: 'NOT_FOUND',
      error: 'The current document was not found in this project.',
    };
  }

  return {
    ok: false,
    code: 'NO_TARGET',
    error: 'No document was specified and there is no current document.',
  };
}
