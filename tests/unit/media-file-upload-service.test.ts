import { describe, expect, it, jest } from '@jest/globals';
import { deleteMediaFile } from '@/lib/services/mediaFileUploadService';

jest.mock('@/lib/services/authorizationService', () => ({
  getCurrentUserId: jest.fn(async () => 'user-1'),
}));

describe('deleteMediaFile', () => {
  it('settles storage usage after removal even when a follow-up info read is stale', async () => {
    const remove = jest.fn(async () => ({ data: ['user-1/project-1/file.png'], error: null }));
    const info = jest.fn(async () => ({ data: { name: 'user-1/project-1/file.png' }, error: null }));
    const rpc = jest.fn(async () => ({ data: { releasedBytes: 64 }, error: null }));
    const supabase = {
      storage: { from: () => ({ remove, info }) },
      rpc,
    } as any;

    await expect(deleteMediaFile(supabase, 'user-1/project-1/file.png')).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalledWith(['user-1/project-1/file.png']);
    expect(info).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('settle_project_storage_file_deletion', {
      p_bucket_id: 'library-media-files',
      p_object_path: 'user-1/project-1/file.png',
    });
  });
});
