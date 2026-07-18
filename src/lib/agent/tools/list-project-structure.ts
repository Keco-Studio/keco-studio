/**
 * list_project_structure — read folders, libraries, documents, and field layout.
 */

import { getLibraryProperties, listProjectFolders } from '../data-access';
import { listResolvedProjectDocuments } from '../document-resolver';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const DOCUMENT_SUMMARY_LIMIT = 50;

function sectionNameFromId(sectionId: string, libraryId: string): string {
  const prefix = `${libraryId}:`;
  return sectionId.startsWith(prefix) ? sectionId.slice(prefix.length) : sectionId;
}

async function execute(_params: unknown, ctx: ToolContext): Promise<ToolResult> {
  try {
    const [folders, documents] = await Promise.all([
      listProjectFolders(ctx.supabase, ctx.projectId, ctx),
      listResolvedProjectDocuments(ctx.supabase, ctx.projectId),
    ]);

    const { data: libraryRows, error } = await ctx.supabase
      .from('libraries')
      .select('id, name, folder_id')
      .eq('project_id', ctx.projectId)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const folderNameById = new Map(folders.map((f) => [f.id, f.name]));
    const returnedDocuments = documents.slice(0, DOCUMENT_SUMMARY_LIMIT);
    const librariesDetailed = await Promise.all(
      (libraryRows ?? []).map(async (row) => {
        const libraryId = row.id as string;
        const properties = await getLibraryProperties(ctx.supabase, libraryId, ctx);
        const sectionIds = [...new Set(properties.map((p) => p.sectionId))];

        return {
          id: libraryId,
          name: row.name as string,
          folderName: row.folder_id ? folderNameById.get(row.folder_id as string) ?? null : null,
          sections: sectionIds.map((sectionId) => ({
            name: sectionNameFromId(sectionId, libraryId),
            fields: properties
              .filter((p) => p.sectionId === sectionId)
              .map((p) => ({ label: p.name, dataType: p.dataType })),
          })),
        };
      })
    );

    return {
      success: true,
      displayHint: 'list',
      data: {
        folderCount: folders.length,
        libraryCount: (libraryRows ?? []).length,
        documentCount: documents.length,
        documentResultMetadata: {
          totalProjectDocumentCount: documents.length,
          returnedDocumentCount: returnedDocuments.length,
          limit: DOCUMENT_SUMMARY_LIMIT,
          isLimited: returnedDocuments.length < documents.length,
          isTruncated: returnedDocuments.length < documents.length,
          nextTool: 'list_documents',
          guidance:
            'Use list_documents with limit and offset (plus optional nameQuery/folderName filters) to page through document metadata.',
        },
        folders: folders.map((f) => ({ id: f.id, name: f.name })),
        libraries: librariesDetailed,
        documents: returnedDocuments.map((document) => ({
          id: document.id,
          name: document.name,
          folderId: document.folder_id,
          folderName: document.folderName,
          createdAt: document.created_at,
          updatedAt: document.updated_at,
        })),
      },
    };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to list project structure.' };
  }
}

export const listProjectStructure: AgentTool = {
  name: 'list_project_structure',
  description:
    'List folders, libraries, bounded document summaries, sections, and field definitions in the current project. Use this FIRST when exploring project layout or before creating new libraries. Use list_documents to page through additional document metadata. Document content is not included. No parameters.',
  category: 'read',
  confirmationMode: 'pre_execute',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  execute,
};
