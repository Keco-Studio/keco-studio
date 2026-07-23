import type { QueryClient } from '@tanstack/react-query';

import type { Library } from '@/lib/services/libraryService';
import { queryKeys } from '@/lib/utils/queryKeys';

export function primeLibraryNavigationCache(
  queryClient: QueryClient,
  library: Library
): void {
  queryClient.setQueryData(queryKeys.library(library.id), library);
}
