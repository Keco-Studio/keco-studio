import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/utils/queryKeys';

export const sidebarAssetsKey = (libraryId: string) =>
  ['sidebar-assets', libraryId] as const;

export type UpdatableEntityType = 'project' | 'library' | 'folder' | 'asset';

export function shouldInvalidateEntityListAfterUpdate(
  queryKey: readonly unknown[],
  entityType: UpdatableEntityType,
  libraryId?: string
): boolean {
  if (entityType === 'project') {
    return queryKey[0] === 'projects';
  }

  if (entityType === 'library') {
    return (
      (queryKey[0] === 'project' && queryKey[2] === 'libraries') ||
      (queryKey[0] === 'folder' && queryKey[2] === 'libraries') ||
      queryKey[0] === 'folders-libraries'
    );
  }

  if (entityType === 'folder') {
    return (
      (queryKey[0] === 'project' && queryKey[2] === 'folders') ||
      queryKey[0] === 'folders-libraries'
    );
  }

  if (entityType === 'asset') {
    if (libraryId) {
      return (
        (queryKey[0] === 'library' && queryKey[1] === libraryId && queryKey[2] === 'assets') ||
        (queryKey[0] === 'library' && queryKey[1] === libraryId && queryKey[2] === 'summary') ||
        (queryKey[0] === 'sidebar-assets' && queryKey[1] === libraryId)
      );
    }
    return queryKey[0] === 'library' && queryKey[2] === 'assets';
  }

  return false;
}

export async function invalidateProjectData(
  queryClient: QueryClient,
  options: {
    projectId?: string | null;
    userProjectList?: boolean;
    refetchActiveProjects?: boolean;
  } = {}
) {
  if (options.userProjectList) {
    await queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
    if (options.refetchActiveProjects) {
      await queryClient.refetchQueries({
        queryKey: queryKeys.projects(),
        type: 'active',
      });
    }
  }

  if (options.projectId) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.project(options.projectId),
    });
  }
}

export async function invalidateFolderData(
  queryClient: QueryClient,
  options: {
    projectId?: string | null;
    folderId?: string | null;
    refetchActiveFoldersLibraries?: boolean;
  }
) {
  if (options.projectId) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.projectFolders(options.projectId),
    });
    await queryClient.invalidateQueries({
      queryKey: ['folders-libraries', options.projectId],
    });
    if (options.refetchActiveFoldersLibraries) {
      await queryClient.refetchQueries({
        queryKey: ['folders-libraries', options.projectId],
        type: 'active',
      });
    }
  }

  if (options.folderId) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.folder(options.folderId),
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.folderLibraries(options.folderId),
    });
  }
}

export async function invalidateLibraryData(
  queryClient: QueryClient,
  options: {
    projectId?: string | null;
    folderId?: string | null;
    libraryId?: string | null;
    refetchActiveFoldersLibraries?: boolean;
  }
) {
  if (options.projectId) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.projectLibraries(options.projectId),
    });
    await queryClient.invalidateQueries({
      queryKey: ['folders-libraries', options.projectId],
    });
    if (options.refetchActiveFoldersLibraries) {
      await queryClient.refetchQueries({
        queryKey: ['folders-libraries', options.projectId],
        type: 'active',
      });
    }
  }

  if (options.folderId) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.folderLibraries(options.folderId),
    });
  }

  if (options.libraryId) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.library(options.libraryId),
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.librarySummary(options.libraryId),
    });
    await queryClient.invalidateQueries({
      queryKey: sidebarAssetsKey(options.libraryId),
    });
  }
}

export async function invalidateLibraryAssetsData(
  queryClient: QueryClient,
  options: {
    libraryId: string;
    assetId?: string | null;
    includeSchema?: boolean;
    refetchActiveAssets?: boolean;
  }
) {
  if (options.assetId) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.asset(options.assetId),
    });
  }

  await queryClient.invalidateQueries({
    queryKey: queryKeys.libraryAssets(options.libraryId),
  });
  await queryClient.invalidateQueries({
    queryKey: queryKeys.librarySummary(options.libraryId),
  });
  await queryClient.invalidateQueries({
    queryKey: sidebarAssetsKey(options.libraryId),
  });

  if (options.includeSchema) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.librarySchema(options.libraryId),
    });
  }

  if (options.refetchActiveAssets) {
    await queryClient.refetchQueries({
      queryKey: queryKeys.libraryAssets(options.libraryId),
      type: 'active',
    });
  }
}

export async function invalidateLibrarySchemaData(
  queryClient: QueryClient,
  options: { libraryId: string; refetchActiveSchema?: boolean }
) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.librarySchema(options.libraryId),
  });
  await queryClient.invalidateQueries({
    queryKey: queryKeys.libraryAssets(options.libraryId),
  });
  await queryClient.invalidateQueries({
    queryKey: queryKeys.librarySummary(options.libraryId),
  });

  if (options.refetchActiveSchema) {
    await queryClient.refetchQueries({
      queryKey: queryKeys.librarySchema(options.libraryId),
      type: 'active',
    });
  }
}
