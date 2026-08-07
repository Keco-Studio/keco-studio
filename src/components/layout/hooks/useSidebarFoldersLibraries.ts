'use client';

import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { listFolders, Folder } from '@/lib/services/folderService';
import { listLibraries, Library } from '@/lib/services/libraryService';
import { filterStudioLibraries } from '@/lib/studioLibraryIsolation';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidProjectId(projectId: string | null): boolean {
  return !!projectId && UUID_REGEX.test(projectId);
}

/**
 * Fetches and caches folders + libraries for the current project in the Sidebar.
 */
export function useSidebarFoldersLibraries(
  currentProjectId: string | null,
  options: { excludeScriptLibraries?: boolean } = {},
) {
  const supabase = useSupabase();

  const {
    data: foldersAndLibraries,
    isLoading: loadingFoldersAndLibraries,
    refetch: refetchFoldersLibraries,
  } = useQuery({
    queryKey: ['folders-libraries', currentProjectId],
    queryFn: async () => {
      if (!currentProjectId) {
        return { folders: [], libraries: [] };
      }
      const [foldersData, librariesData] = await Promise.all([
        listFolders(supabase, currentProjectId),
        listLibraries(supabase, currentProjectId),
      ]);
      return { folders: foldersData, libraries: librariesData };
    },
    enabled: isValidProjectId(currentProjectId),
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const folders = foldersAndLibraries?.folders ?? [];
  const allLibraries = (foldersAndLibraries?.libraries ?? []) as Library[];
  const libraries = options.excludeScriptLibraries
    ? filterStudioLibraries(allLibraries)
    : allLibraries;

  return {
    folders: folders as Folder[],
    libraries,
    allLibraries,
    isLoading: loadingFoldersAndLibraries,
    refetch: refetchFoldersLibraries,
  };
}
