type LibraryExportMetadata = {
  id: string;
  document_export_type?: string | null;
};

export function filterStudioLibraries<T extends LibraryExportMetadata>(libraries: T[]): T[] {
  return libraries.filter((library) => library.document_export_type !== 'script');
}

export function getStudioLibraryRedirectPath(
  projectId: string,
  library: LibraryExportMetadata | null | undefined,
): string | null {
  if (library?.document_export_type !== 'script') return null;
  return `/script-system/${projectId}/script/${library.id}`;
}
