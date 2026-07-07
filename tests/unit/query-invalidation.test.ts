import { describe, expect, it, jest } from '@jest/globals';
import {
  invalidateFolderData,
  invalidateLibraryAssetsData,
  invalidateLibraryData,
  invalidateLibrarySchemaData,
  invalidateProjectData,
  sidebarAssetsKey,
} from '@/lib/queryInvalidation';
import { queryKeys } from '@/lib/utils/queryKeys';

const createClient = () => ({
  invalidateQueries: jest.fn<() => Promise<void>>(() => Promise.resolve()),
  refetchQueries: jest.fn<() => Promise<void>>(() => Promise.resolve()),
});

describe('query invalidation helpers', () => {
  it('invalidates project list and project detail keys', async () => {
    const client = createClient();
    await invalidateProjectData(client as never, {
      projectId: 'project-1',
      userProjectList: true,
      refetchActiveProjects: true,
    });

    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.projects() });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.project('project-1') });
    expect(client.refetchQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projects(),
      type: 'active',
    });
  });

  it('invalidates folder and folder/library collection keys', async () => {
    const client = createClient();
    await invalidateFolderData(client as never, {
      projectId: 'project-1',
      folderId: 'folder-1',
      refetchActiveFoldersLibraries: true,
    });

    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.projectFolders('project-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.folder('folder-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['folders-libraries', 'project-1'] });
    expect(client.refetchQueries).toHaveBeenCalledWith({
      queryKey: ['folders-libraries', 'project-1'],
      type: 'active',
    });
  });

  it('invalidates library list, detail, summary, and sidebar collection keys', async () => {
    const client = createClient();
    await invalidateLibraryData(client as never, {
      projectId: 'project-1',
      folderId: 'folder-1',
      libraryId: 'library-1',
      refetchActiveFoldersLibraries: true,
    });

    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.projectLibraries('project-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.folderLibraries('folder-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.library('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.librarySummary('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['folders-libraries', 'project-1'] });
  });

  it('invalidates asset, library asset, summary, schema, and sidebar asset keys', async () => {
    const client = createClient();
    await invalidateLibraryAssetsData(client as never, {
      libraryId: 'library-1',
      assetId: 'asset-1',
      includeSchema: true,
      refetchActiveAssets: true,
    });

    expect(sidebarAssetsKey('library-1')).toEqual(['sidebar-assets', 'library-1']);
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.asset('asset-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.libraryAssets('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.librarySummary('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.librarySchema('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: sidebarAssetsKey('library-1') });
    expect(client.refetchQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.libraryAssets('library-1'),
      type: 'active',
    });
  });

  it('invalidates schema-dependent caches', async () => {
    const client = createClient();
    await invalidateLibrarySchemaData(client as never, {
      libraryId: 'library-1',
      refetchActiveSchema: true,
    });

    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.librarySchema('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.libraryAssets('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.librarySummary('library-1') });
    expect(client.refetchQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.librarySchema('library-1'),
      type: 'active',
    });
  });
});
