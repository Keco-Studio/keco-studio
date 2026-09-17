import { describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('server-only', () => ({}));

import {
  deleteAccountedStorageFile,
  processProjectStorageCleanupJob,
} from '@/lib/server/projectDeletion';

type StorageError = { message: string } | null;

function createCleanupClient({
  calls,
  removeError = null,
  settlementErrors = [],
}: {
  calls: string[];
  removeError?: StorageError;
  settlementErrors?: StorageError[];
}): SupabaseClient {
  let settlementAttempt = 0;
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({
      data: {
        id: 'cleanup-1',
        project_id: 'project',
        bucket_id: 'project-assets',
        storage_paths: ['owner/project/file.png'],
        storage_file_ids: ['file-1'],
        storage_file_owner_ids: ['owner'],
        storage_file_bytes: [12],
      },
      error: null,
    }),
    update: () => query,
    delete: () => {
      calls.push('delete-job');
      return query;
    },
    then: (onfulfilled: (value: { data: null; error: null }) => unknown) => (
      Promise.resolve({ data: null, error: null }).then(onfulfilled)
    ),
  };

  return {
    from: () => query,
    storage: {
      from: (bucketId: string) => {
        calls.push(`storage:${bucketId}`);
        return {
          remove: async (paths: string[]) => {
            calls.push(`remove:${paths.join(',')}`);
            return { data: null, error: removeError };
          },
        };
      },
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${name}:${String(args.p_bucket_id)}:${String(args.p_object_path)}`);
      const error = settlementErrors[settlementAttempt++] ?? null;
      return { data: error ? null : { releasedBytes: 12, reused: false }, error };
    },
  } as unknown as SupabaseClient;
}

describe('accounted storage deletion settlement', () => {
  it('removes a cleanup object before settling its quota bytes and deleting its job', async () => {
    const calls: string[] = [];

    await processProjectStorageCleanupJob({
      cleanupJobId: 'cleanup-1',
      serviceClient: createCleanupClient({ calls }),
    });

    expect(calls).toEqual([
      'storage:project-assets',
      'remove:owner/project/file.png',
      'rpc:service_settle_project_storage_file_deletion:project-assets:owner/project/file.png',
      'delete-job',
    ]);
  });

  it('does not settle bytes or delete the job when physical removal fails', async () => {
    const calls: string[] = [];

    await expect(processProjectStorageCleanupJob({
      cleanupJobId: 'cleanup-1',
      serviceClient: createCleanupClient({ calls, removeError: { message: 'storage unavailable' } }),
    })).rejects.toThrow('storage unavailable');

    expect(calls).toEqual(['storage:project-assets', 'remove:owner/project/file.png']);
  });

  it('keeps settlement failures retryable, where the idempotent RPC prevents a second decrement', async () => {
    const calls: string[] = [];
    const client = createCleanupClient({
      calls,
      settlementErrors: [{ message: 'settlement response interrupted' }],
    });

    await expect(processProjectStorageCleanupJob({ cleanupJobId: 'cleanup-1', serviceClient: client }))
      .rejects.toThrow('settlement response interrupted');
    await processProjectStorageCleanupJob({ cleanupJobId: 'cleanup-1', serviceClient: client });

    expect(calls).toEqual([
      'storage:project-assets',
      'remove:owner/project/file.png',
      'rpc:service_settle_project_storage_file_deletion:project-assets:owner/project/file.png',
      'storage:project-assets',
      'remove:owner/project/file.png',
      'rpc:service_settle_project_storage_file_deletion:project-assets:owner/project/file.png',
      'delete-job',
    ]);
  });

  it('settles an individual media object only after Storage confirms removal', async () => {
    const calls: string[] = [];
    const client = createCleanupClient({ calls });

    await deleteAccountedStorageFile({
      client,
      bucketId: 'library-media-files',
      objectPath: 'owner/project/file.png',
    });

    expect(calls).toEqual([
      'storage:library-media-files',
      'remove:owner/project/file.png',
      'rpc:settle_project_storage_file_deletion:library-media-files:owner/project/file.png',
    ]);
  });
});
