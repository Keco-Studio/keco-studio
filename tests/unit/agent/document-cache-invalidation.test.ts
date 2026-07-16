import type { QueryClient } from '@tanstack/react-query';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { invalidateLibraryAssetsData } from '@/lib/queryInvalidation';
import { queryKeys } from '@/lib/utils/queryKeys';
import { invalidateAgentCaches } from '@/components/agent/useAgentChat';
import type { AgentInvalidation } from '@/components/agent/types';

jest.mock('@/lib/queryInvalidation', () => ({
  invalidateLibraryAssetsData: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: jest.fn() }));

const invalidateLibraryAssetsDataMock = jest.mocked(invalidateLibraryAssetsData);

describe('Agent document cache invalidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps library invalidations on the existing library refresh path', async () => {
    const queryClient = { invalidateQueries: jest.fn() } as unknown as QueryClient;
    const router = { refresh: jest.fn() } as unknown as AppRouterInstance;
    const invalidations: AgentInvalidation[] = [{ type: 'library', id: 'library-1' }];

    await invalidateAgentCaches(queryClient, router, invalidations);

    expect(invalidateLibraryAssetsDataMock).toHaveBeenCalledWith(queryClient, {
      libraryId: 'library-1',
      includeSchema: true,
      refetchActiveAssets: true,
    });
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
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
      [{ queryKey: queryKeys.document('document-1') }],
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
});
