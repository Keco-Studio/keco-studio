export type FolderBreadcrumbSource = {
  id: string;
  name: string;
  parent_folder_id: string | null;
};

export type FolderBreadcrumb = Pick<FolderBreadcrumbSource, 'id' | 'name'>;

/** Build a root-to-leaf folder path without looping on corrupt legacy data. */
export function buildFolderBreadcrumbPath(
  folders: FolderBreadcrumbSource[],
  currentFolderId: string | null
): FolderBreadcrumb[] {
  if (!currentFolderId) return [];

  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: FolderBreadcrumb[] = [];
  const visited = new Set<string>();
  let cursor: string | null = currentFolderId;

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const folder = byId.get(cursor);
    if (!folder) break;
    path.push({ id: folder.id, name: folder.name });
    cursor = folder.parent_folder_id;
  }

  return path.reverse();
}
