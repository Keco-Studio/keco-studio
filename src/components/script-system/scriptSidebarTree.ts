import type { ScriptWorkspaceDocumentRef } from './useScriptWorkspaceMembership';

export type ScriptSidebarFolderRef = {
  id: string;
  name: string;
  parent_folder_id: string | null;
};

export type ScriptSidebarFolderNode = ScriptSidebarFolderRef & {
  documents: ScriptWorkspaceDocumentRef[];
};

export type ScriptSidebarTree = {
  rootDocuments: ScriptWorkspaceDocumentRef[];
  folders: ScriptSidebarFolderNode[];
};

export const DEFAULT_RESOURCE_FOLDER_NAME = 'Resources Folder';

/**
 * Script shares project folders with Studio but intentionally renders them as
 * one level. Only documents explicitly present in the Script workspace enter
 * this tree.
 */
export function buildScriptSidebarTree(
  folders: ScriptSidebarFolderRef[],
  documents: ScriptWorkspaceDocumentRef[],
): ScriptSidebarTree {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const documentsByFolder = new Map<string, ScriptWorkspaceDocumentRef[]>();
  const rootDocuments: ScriptWorkspaceDocumentRef[] = [];

  for (const document of documents) {
    if (!document.folderId || !folderIds.has(document.folderId)) {
      rootDocuments.push(document);
      continue;
    }
    const grouped = documentsByFolder.get(document.folderId) ?? [];
    grouped.push(document);
    documentsByFolder.set(document.folderId, grouped);
  }

  return {
    rootDocuments,
    folders: [...folders]
      .sort((left, right) => {
        const leftIsDefault = left.name === DEFAULT_RESOURCE_FOLDER_NAME;
        const rightIsDefault = right.name === DEFAULT_RESOURCE_FOLDER_NAME;
        if (leftIsDefault !== rightIsDefault) return leftIsDefault ? -1 : 1;
        return 0;
      })
      .map((folder) => ({
        ...folder,
        documents: documentsByFolder.get(folder.id) ?? [],
      })),
  };
}
