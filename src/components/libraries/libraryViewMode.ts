export type LibraryViewMode = 'table' | 'script';

export function resolveLibraryViewMode(
  documentExportType: 'table' | 'script' | null | undefined
): LibraryViewMode {
  return documentExportType === 'script' ? 'script' : 'table';
}
