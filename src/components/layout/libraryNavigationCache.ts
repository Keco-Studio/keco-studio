import type { QueryClient } from '@tanstack/react-query';

import type { DocumentSummary } from '@/lib/services/documentService';
import type { Library } from '@/lib/services/libraryService';
import { queryKeys } from '@/lib/utils/queryKeys';

export function primeLibraryNavigationCache(
  queryClient: QueryClient,
  library: Library
): void {
  queryClient.setQueryData(queryKeys.library(library.id), library);
}

export function primeDocumentNavigationCache(
  queryClient: QueryClient,
  document: Pick<DocumentSummary, 'id' | 'name' | 'folder_id'>
): void {
  queryClient.setQueryData(['document-name', document.id] as const, {
    name: document.name,
    folder_id: document.folder_id,
  });
}
