import { describe, expect, it, jest } from '@jest/globals';
import { queryKeys } from '@/lib/utils/queryKeys';
import { invalidateSidebarLibraryChange } from './useSidebarRealtime';

describe('sidebar library realtime invalidation', () => {
  it('invalidates each library change once', async () => {
    const queryClient = {
      invalidateQueries: jest.fn<(
        filters: { queryKey: readonly unknown[] }
      ) => Promise<void>>(async () => undefined),
      refetchQueries: jest.fn(async () => undefined),
    };

    await invalidateSidebarLibraryChange(
      queryClient as never,
      'project-1',
      { id: 'library-1', folder_id: 'folder-1' },
      {}
    );

    const detailCalls = queryClient.invalidateQueries.mock.calls.filter(([filters]) => (
      JSON.stringify(filters.queryKey) === JSON.stringify(queryKeys.library('library-1'))
    ));
    expect(detailCalls).toHaveLength(1);
  });
});
