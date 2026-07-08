import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('server-only', () => ({}));

import { deleteProjectWithServerBoundary } from '@/lib/server/projectDeletion';

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
};

function createAuthClient(role: 'admin' | 'viewer'): SupabaseClient {
  const makeBuilder = (table: string): QueryBuilder => {
    const builder: QueryBuilder = {
      select: () => builder,
      eq: () => builder,
      delete: () => builder,
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

function createServiceClient(calls: string[]): SupabaseClient {
  const builder: QueryBuilder = {
    select: () => builder,
    eq: (column, value) => {
      calls.push(`${column}:${value}`);
      return builder;
    },
    delete: () => {
      calls.push('delete');
      return builder;
    },
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
  };

  return {
    from: (table: string) => {
      calls.push(`from:${table}`);
      return builder;
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

    expect(calls).toEqual(['from:projects', 'delete', 'id:project-1']);
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
});
