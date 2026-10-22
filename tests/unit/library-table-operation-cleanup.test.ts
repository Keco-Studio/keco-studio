import { describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));

import { cleanupExpiredLibraryTableOperations } from '@/lib/server/libraryTableOperationCleanup';

describe('cleanupExpiredLibraryTableOperations', () => {
  it('removes only storage paths released by the operation expiry RPC', async () => {
    const remove = jest.fn(async () => ({ error: null }));
    const rpc = jest.fn(async (name: string) => {
      if (name === 'expire_library_table_operations') {
        return { data: { releasedMediaPaths: ['user-1/project-1/removed.png'] }, error: null };
      }
      return { data: null, error: null };
    });
    const serviceClient = { rpc, storage: { from: jest.fn(() => ({ remove })) } } as any;

    await expect(cleanupExpiredLibraryTableOperations({ serviceClient })).resolves.toEqual({
      expired: 1,
      deletedPaths: ['user-1/project-1/removed.png'],
    });

    expect(rpc).toHaveBeenCalledWith('expire_library_table_operations', { p_limit: 100 });
    expect(remove).toHaveBeenCalledWith(['user-1/project-1/removed.png']);
    expect(rpc).toHaveBeenCalledWith('service_settle_project_storage_file_deletion', {
      p_bucket_id: 'library-media-files',
      p_object_path: 'user-1/project-1/removed.png',
    });
    expect(rpc).toHaveBeenCalledWith('complete_library_table_operation_media_cleanup', {
      p_paths: ['user-1/project-1/removed.png'],
    });
  });

  it('keeps a path eligible for retry when storage deletion fails', async () => {
    const serviceClient = {
      rpc: jest.fn(async () => ({ data: { releasedMediaPaths: ['user-1/project-1/removed.png'] }, error: null })),
      storage: { from: jest.fn(() => ({ remove: jest.fn(async () => ({ error: { message: 'temporary failure' } })) })) },
    } as any;

    await expect(cleanupExpiredLibraryTableOperations({ serviceClient })).rejects.toThrow('temporary failure');
  });
});
