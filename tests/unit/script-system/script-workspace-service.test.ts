import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deleteScriptWorkspaceDocument,
  listScriptWorkspaceDocuments,
  upsertScriptWorkspaceDocument,
} from '@/lib/script-system/scriptWorkspaceService';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

type QueryResult = {
  data: unknown;
  error: null | { message: string };
};

function workspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    project_id: PROJECT_ID,
    document_id: DOCUMENT_ID,
    imported_at: '2026-07-31T12:00:00.000Z',
    imported_by: USER_ID,
    ...overrides,
  };
}

function makeClient(options: {
  list?: QueryResult;
  document?: QueryResult;
  upsert?: QueryResult;
  delete?: QueryResult;
} = {}) {
  const calls: Array<{ kind: string; table: string; value?: unknown }> = [];
  const list = options.list ?? { data: [workspaceRow()], error: null };
  const document = options.document ?? {
    data: { id: DOCUMENT_ID, project_id: PROJECT_ID },
    error: null,
  };
  const upsert = options.upsert ?? { data: null, error: null };
  const del = options.delete ?? { data: null, error: null };

  const from = jest.fn((table: string) => {
    const builder = {
      select(columns: string) {
        calls.push({ kind: 'select', table, value: columns });
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push({ kind: `eq:${column}`, table, value });
        return builder;
      },
      single() {
        calls.push({ kind: 'single', table });
        return Promise.resolve(document);
      },
      upsert(payload: unknown, opts: unknown) {
        calls.push({ kind: 'upsert', table, value: { payload, opts } });
        return Promise.resolve(upsert);
      },
      delete() {
        calls.push({ kind: 'delete', table });
        return builder;
      },
      then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ) {
        const result = table === 'script_workspace_documents' ? list : del;
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };
    return builder;
  });

  return {
    client: { from } as unknown as SupabaseClient,
    calls,
    from,
  };
}

describe('scriptWorkspaceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists workspace documents for a project', async () => {
    const { client, calls } = makeClient();
    const rows = await listScriptWorkspaceDocuments(client, PROJECT_ID);

    expect(calls).toContainEqual({
      kind: 'select',
      table: 'script_workspace_documents',
      value: 'project_id, document_id, imported_at, imported_by',
    });
    expect(calls).toContainEqual({
      kind: 'eq:project_id',
      table: 'script_workspace_documents',
      value: PROJECT_ID,
    });
    expect(rows).toEqual([workspaceRow()]);
  });

  it('upserts workspace reference after validating document belongs to project', async () => {
    const { client, calls } = makeClient();
    await upsertScriptWorkspaceDocument(client, {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      userId: USER_ID,
    });

    expect(calls).toContainEqual({
      kind: 'select',
      table: 'documents',
      value: 'id, project_id',
    });
    expect(calls).toContainEqual({
      kind: 'eq:id',
      table: 'documents',
      value: DOCUMENT_ID,
    });
    expect(calls).toContainEqual({
      kind: 'upsert',
      table: 'script_workspace_documents',
      value: {
        payload: {
          project_id: PROJECT_ID,
          document_id: DOCUMENT_ID,
          imported_by: USER_ID,
        },
        opts: { onConflict: 'project_id,document_id', ignoreDuplicates: true },
      },
    });
  });

  it('rejects upsert when document is not in the project', async () => {
    const { client, calls } = makeClient({
      document: {
        data: { id: DOCUMENT_ID, project_id: OTHER_PROJECT_ID },
        error: null,
      },
    });

    await expect(
      upsertScriptWorkspaceDocument(client, {
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        userId: USER_ID,
      })
    ).rejects.toThrow('Document not found in project');

    expect(calls.some((call) => call.kind === 'upsert')).toBe(false);
  });

  it('deletes workspace reference without deleting the document', async () => {
    const { client, calls } = makeClient();
    await deleteScriptWorkspaceDocument(client, {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });

    expect(calls).toContainEqual({
      kind: 'delete',
      table: 'script_workspace_documents',
    });
    expect(calls).toContainEqual({
      kind: 'eq:project_id',
      table: 'script_workspace_documents',
      value: PROJECT_ID,
    });
    expect(calls).toContainEqual({
      kind: 'eq:document_id',
      table: 'script_workspace_documents',
      value: DOCUMENT_ID,
    });
    expect(calls.some((call) => call.table === 'documents' && call.kind === 'delete')).toBe(
      false
    );
  });
});
