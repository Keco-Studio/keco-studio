'use client';

import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { listFolders, Folder } from '@/lib/services/folderService';
import { listLibraries, Library } from '@/lib/services/libraryService';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidProjectId(projectId: string | null): boolean {
  return !!projectId && UUID_REGEX.test(projectId);
}

/**
 * 当前项目下的 folders + libraries 请求与缓存，供 Sidebar 使用。
 */
export function useSidebarFoldersLibraries(currentProjectId: string | null) {
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
  const libraries = foldersAndLibraries?.libraries ?? [];

  return {
    folders: folders as Folder[],
    libraries: libraries as Library[],
    isLoading: loadingFoldersAndLibraries,
    refetch: refetchFoldersLibraries,
  };
}
