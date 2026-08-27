import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('server-only', () => ({}));

import {
  deleteProjectWithServerBoundary,
  processProjectStorageCleanupJob,
} from '@/lib/server/projectDeletion';

type QueryError = { message: string };
type QueryResult = { data: unknown; error: QueryError | null };
type MaybeSingleResult = Promise<QueryResult>;
type SingleResult = Promise<QueryResult>;

type QueryBuilder = {
  select: (columns: string) => QueryBuilder;
  eq: (column: string, value: string) => QueryBuilder;
  single: () => SingleResult;
  maybeSingle: () => MaybeSingleResult;
  delete: () => QueryBuilder;
  update: (values: Record<string, unknown>) => QueryBuilder;
  range: (from: number, to: number) => Promise<QueryResult>;
  then: PromiseLike<QueryResult>['then'];
};

function createAuthClient(role: 'admin' | 'viewer'): SupabaseClient {
  const makeBuilder = (table: string): QueryBuilder => {
    const builder: QueryBuilder = {
      select: () => builder,
      eq: () => builder,
      delete: () => builder,
      update: () => builder,
      range: async () => ({ data: [], error: null }),
      then: (onfulfilled, onrejected) => Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected),
      single: async () => {
        if (table === 'projects') {
          return { data: { owner_id: 'owner-user' }, error: null };
        }
        return { data: null, error: { message: `unexpected single table ${table}` } };
      },
      maybeSingle: async () => {
        if (table === 'project_collaborators') {
          return { data: { role, accepted_at: '2026-07-08T00:00:00.000Z' }, error: null };
        }
        return { data: null, error: { message: `unexpected maybeSingle table ${table}` } };
      },
    };
    return builder;
  };

  return {
    from: (table: string) => makeBuilder(table),
  } as unknown as SupabaseClient;
}

function createServiceClient(
  calls: string[],
  references: Array<{ storage_path: string }> = [],
  removeError: QueryError | null = null,
  bucketId: 'map-assets' | 'character-assets' = 'map-assets',
): SupabaseClient {
  let activeTable = '';
  const builder: QueryBuilder = {
    select: () => {
      calls.push('select');
      return builder;
    },
    eq: (column, value) => {
      calls.push(`${column}:${value}`);
      return builder;
    },
    delete: () => {
      calls.push('delete');
      return builder;
    },
    update: (values) => {
      calls.push(`update:${String(values.status)}`);
      return builder;
    },
    range: async (from, to) => {
      calls.push(`range:${from}:${to}`);
      return { data: activeTable === 'map_reference_images' ? references.slice(from, to + 1) : [], error: null };
    },
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => activeTable === 'project_storage_cleanup_jobs'
      ? {
          data: {
            id: 'cleanup-1',
            project_id: 'project-1',
            bucket_id: bucketId,
            storage_paths: references.map((row) => row.storage_path),
          },
          error: null,
        }
      : ({ data: null, error: null }),
    then: (onfulfilled, onrejected) => Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected),
  };

  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${name}:${String(args.p_project_id)}`);
      return {
        data: references.length > 0
          ? [{ cleanup_job_id: 'cleanup-1', character_cleanup_job_id: 'cleanup-2', storage_paths: references.map((row) => row.storage_path) }]
          : [{ cleanup_job_id: null, character_cleanup_job_id: null, storage_paths: [] }],
        error: null,
      };
    },
    from: (table: string) => {
      activeTable = table;
      calls.push(`from:${table}`);
      return builder;
    },
    storage: {
      from: (bucket: string) => {
        calls.push(`storage:${bucket}`);
        return {
          remove: async (paths: string[]) => {
            calls.push(`remove:${paths.join(',')}`);
            return { data: null, error: removeError };
          },
        };
      },
    },
  } as unknown as SupabaseClient;
}

describe('deleteProjectWithServerBoundary', () => {
  it('allows an admin collaborator to delete through the service-role client', async () => {
    const calls: string[] = [];

    await deleteProjectWithServerBoundary({
      authClient: createAuthClient('admin'),
      serviceClient: createServiceClient(calls),
      projectId: 'project-1',
      userId: 'admin-user',
    });

    expect(calls).toEqual(['rpc:delete_project_and_enqueue_storage_cleanup:project-1']);
  });

  it('rejects non-admin collaborators before service-role deletion', async () => {
    const calls: string[] = [];

    await expect(
      deleteProjectWithServerBoundary({
        authClient: createAuthClient('viewer'),
        serviceClient: createServiceClient(calls),
        projectId: 'project-1',
        userId: 'viewer-user',
      })
    ).rejects.toThrow('Only admin users can delete projects');

    expect(calls).toEqual([]);
  });

  it('atomically deletes the project before its queued reference cleanup runs', async () => {
    const calls: string[] = [];
    const references = [
      { storage_path: 'references/project-1/ref-1/a.png' },
      { storage_path: 'references/project-1/ref-2/b.png' },
    ];

    const result = await deleteProjectWithServerBoundary({
      authClient: createAuthClient('admin'),
      serviceClient: createServiceClient(calls, references),
      projectId: 'project-1',
      userId: 'admin-user',
    });

    expect(result).toEqual({ cleanupJobId: 'cleanup-1', cleanupJobIds: ['cleanup-1', 'cleanup-2'] });
    expect(calls).toEqual(['rpc:delete_project_and_enqueue_storage_cleanup:project-1']);
  });

  it('keeps a failed cleanup job retryable after the project is already deleted', async () => {
    const calls: string[] = [];
    const serviceClient = createServiceClient(
      calls,
      [{ storage_path: 'references/project-1/ref-1/a.png' }],
      { message: 'storage unavailable' },
    );

    const result = await deleteProjectWithServerBoundary({
      authClient: createAuthClient('admin'),
      serviceClient,
      projectId: 'project-1',
      userId: 'admin-user',
    });
    await expect(processProjectStorageCleanupJob({
      serviceClient,
      cleanupJobId: result.cleanupJobId!,
    })).rejects.toThrow('storage unavailable');

    expect(calls[0]).toBe('rpc:delete_project_and_enqueue_storage_cleanup:project-1');
    expect(calls).toContain('update:failed');
    expect(calls).not.toContain('delete');
  });

  it('processes a project-scoped character asset cleanup job', async () => {
    const calls: string[] = [];
    const serviceClient = createServiceClient(
      calls,
      [{ storage_path: 'project-1/character-1/generation-1/a.png' }],
      null,
      'character-assets',
    );

    await processProjectStorageCleanupJob({ serviceClient, cleanupJobId: 'cleanup-1' });

    expect(calls).toContain('storage:character-assets');
    expect(calls).toContain('remove:project-1/character-1/generation-1/a.png');
    expect(calls).toContain('delete');
  });
});
