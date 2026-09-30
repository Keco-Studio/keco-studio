import type { QueryClient } from '@tanstack/react-query';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  invalidateFolderData,
  invalidateLibraryAssetsData,
  invalidateLibraryData,
  invalidateProjectData,
} from '@/lib/queryInvalidation';
import { queryKeys } from '@/lib/utils/queryKeys';
import {
  invalidateAgentCaches,
  parseAgentInvalidations,
} from '@/components/agent/useAgentChat';
import type { AgentInvalidation } from '@/components/agent/types';

jest.mock('@/lib/queryInvalidation', () => ({
  invalidateFolderData: jest.fn().mockResolvedValue(undefined),
  invalidateLibraryAssetsData: jest.fn().mockResolvedValue(undefined),
  invalidateLibraryData: jest.fn().mockResolvedValue(undefined),
  invalidateProjectData: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: jest.fn() }));

const invalidateLibraryAssetsDataMock = jest.mocked(invalidateLibraryAssetsData);
const invalidateLibraryDataMock = jest.mocked(invalidateLibraryData);
const invalidateFolderDataMock = jest.mocked(invalidateFolderData);
const invalidateProjectDataMock = jest.mocked(invalidateProjectData);

describe('Agent document cache invalidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps library invalidations on the existing library refresh path', async () => {
    const queryClient = { invalidateQueries: jest.fn() } as unknown as QueryClient;
    const router = { refresh: jest.fn() } as unknown as AppRouterInstance;
    const invalidations: AgentInvalidation[] = [{ type: 'library', id: 'library-1' }];

    await invalidateAgentCaches(queryClient, router, invalidations);

    expect(invalidateLibraryDataMock).toHaveBeenCalledWith(queryClient, {
      projectId: undefined,
      libraryId: 'library-1',
    });
    expect(invalidateLibraryAssetsDataMock).toHaveBeenCalledWith(queryClient, {
      libraryId: 'library-1',
      includeSchema: true,
      refetchActiveAssets: true,
    });
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('prefers structured invalidations when a compatibility event has both fields', () => {
    const invalidations: AgentInvalidation[] = [{
      type: 'documents',
      projectId: 'project-1',
      documentId: 'document-1',
    }];

    expect(parseAgentInvalidations({
      type: 'cache_invalidated',
      invalidations,
      paths: ['library-must-not-run'],
    })).toEqual(invalidations);
  });

  it('translates a legacy paths-only event into library invalidations', () => {
    expect(parseAgentInvalidations({
      type: 'cache_invalidated',
      paths: ['library-1', 'library-2'],
    })).toEqual([
      { type: 'library', id: 'library-1' },
      { type: 'library', id: 'library-2' },
    ]);
  });

  it('keeps structured document invalidations unchanged', () => {
    const invalidations: AgentInvalidation[] = [{
      type: 'documents',
      projectId: 'project-1',
      documentId: 'document-1',
    }];

    expect(parseAgentInvalidations({
      type: 'cache_invalidated',
      invalidations,
    })).toEqual(invalidations);
  });

  it('invalidates document lists and every document cache before one refresh', async () => {
    const invalidateQueries = jest.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;
    const router = { refresh: jest.fn() } as unknown as AppRouterInstance;
    const invalidations: AgentInvalidation[] = [
      { type: 'documents', projectId: 'project-1', documentId: 'document-1' },
      { type: 'documents', projectId: 'project-2' },
    ];

    await invalidateAgentCaches(queryClient, router, invalidations);

    expect(invalidateQueries.mock.calls).toEqual([
      [{ queryKey: queryKeys.documents('project-1') }],
      [{ queryKey: queryKeys.document('document-1'), exact: true }],
      [{ queryKey: queryKeys.documentState('document-1') }],
      [{ queryKey: queryKeys.documentVersions('document-1') }],
      [{ queryKey: queryKeys.documents('project-2') }],
    ]);
    expect(invalidateLibraryAssetsDataMock).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when the invalidation batch is empty', async () => {
    const queryClient = { invalidateQueries: jest.fn() } as unknown as QueryClient;
    const router = { refresh: jest.fn() } as unknown as AppRouterInstance;

    await invalidateAgentCaches(queryClient, router, []);

    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('refreshes project lists and project structure after agent changes', async () => {
    const queryClient = { invalidateQueries: jest.fn() } as unknown as QueryClient;
    const router = { refresh: jest.fn() } as unknown as AppRouterInstance;

    await invalidateAgentCaches(queryClient, router, [
      { type: 'projects', projectId: 'project-1' },
      { type: 'project-structure', projectId: 'project-1' },
    ]);

    expect(invalidateProjectDataMock).toHaveBeenCalledWith(queryClient, {
      projectId: 'project-1', userProjectList: true, refetchActiveProjects: true,
    });
    expect(invalidateFolderDataMock).toHaveBeenCalledWith(queryClient, {
      projectId: 'project-1', refetchActiveFoldersLibraries: true,
    });
    expect(invalidateLibraryDataMock).toHaveBeenCalledWith(queryClient, {
      projectId: 'project-1', refetchActiveFoldersLibraries: true,
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes GDS lists and detail after agent changes', async () => {
    const invalidateQueries = jest.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;
    const router = { refresh: jest.fn() } as unknown as AppRouterInstance;

    await invalidateAgentCaches(queryClient, router, [{ type: 'game-design-systems', designSystemId: 'system-1', projectId: 'project-1' }]);

    expect(invalidateQueries.mock.calls).toEqual([
      [{ queryKey: queryKeys.gameDesignSystems() }],
      [{ queryKey: queryKeys.projectGameDesignSystem('project-1') }],
      [{ queryKey: queryKeys.gameDesignSystem('system-1') }],
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes the project game media list after upload or reuse', async () => {
    const invalidateQueries = jest.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;
    const router = { refresh: jest.fn() } as unknown as AppRouterInstance;

    await invalidateAgentCaches(queryClient, router, [
      { type: 'game-media', projectId: 'project-1' },
    ]);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['project-game-assets', 'project-1'] });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes Script workspace membership after agent changes', async () => {
    const invalidateQueries = jest.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;
    const router = { refresh: jest.fn() } as unknown as AppRouterInstance;

    await invalidateAgentCaches(queryClient, router, [{
      type: 'script-workspace', projectId: 'project-1', documentId: 'document-1',
    }]);

    expect(invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ['script-workspace', 'project-1'] }],
      [{ queryKey: ['script-workspace-document', 'project-1', 'document-1'] }],
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes the collaborator list after agent changes', async () => {
    const invalidateQueries = jest.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;
    const router = { refresh: jest.fn() } as unknown as AppRouterInstance;

    await invalidateAgentCaches(queryClient, router, [{ type: 'project-collaborators', projectId: 'project-1' }]);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.projectCollaborators('project-1') });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
