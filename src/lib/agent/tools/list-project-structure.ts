/**
 * list_project_structure — read folders, libraries, and field layout for the project.
 */

import { getLibraryProperties, listProjectFolders } from '../data-access';
import type { AgentTool, ToolContext, ToolResult } from '../types';

function sectionNameFromId(sectionId: string, libraryId: string): string {
  const prefix = `${libraryId}:`;
  return sectionId.startsWith(prefix) ? sectionId.slice(prefix.length) : sectionId;
}

async function execute(_params: unknown, ctx: ToolContext): Promise<ToolResult> {
  try {
    const folders = await listProjectFolders(ctx.supabase, ctx.projectId);

    const { data: libraryRows, error } = await ctx.supabase
      .from('libraries')
      .select('id, name, folder_id')
      .eq('project_id', ctx.projectId)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const folderNameById = new Map(folders.map((f) => [f.id, f.name]));
    const librariesDetailed = await Promise.all(
      (libraryRows ?? []).map(async (row) => {
        const libraryId = row.id as string;
        const properties = await getLibraryProperties(ctx.supabase, libraryId);
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
        folders: folders.map((f) => ({ id: f.id, name: f.name })),
        libraries: librariesDetailed,
      },
    };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to list project structure.' };
  }
}

export const listProjectStructure: AgentTool = {
  name: 'list_project_structure',
  description:
    'List folders, libraries, sections, and field definitions in the current project. Use this FIRST when exploring project layout or before creating new libraries. No parameters.',
  category: 'read',
  confirmationMode: 'pre_execute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute,
};
