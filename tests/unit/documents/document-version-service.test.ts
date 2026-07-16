import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DocumentAccessError,
  DocumentReadOnlyError,
  DocumentStateConflictError,
} from '@/lib/documents/documentStateTypes';

const readDocumentState = jest.fn();
const mergeYjsState = jest.fn();
const yjsStateToMarkdown = jest.fn();

jest.mock('@/lib/documents/documentStateGateway', () => ({
  readDocumentState: (...args: unknown[]) => readDocumentState(...args),
}));

jest.mock('@/lib/documents/documentContentCodec', () => ({
  mergeYjsState: (...args: unknown[]) => mergeYjsState(...args),
  documentContentCodec: {
    yjsStateToMarkdown: (...args: unknown[]) => yjsStateToMarkdown(...args),
  },
}));

import {
  createDocumentImportCheckpoint,
  createDocumentVersion,
  deleteDocumentVersion,
  getDocumentVersionPreview,
  listDocumentVersions,
} from '@/lib/documents/documentVersionService';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const UPDATE_A = '55555555-5555-4555-8555-555555555555';
const UPDATE_B = '66666666-6666-4666-8666-666666666666';

type QueryResult = { data: unknown; error: null | { code?: string; message?: string } };

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    document_id: DOCUMENT_ID,
    project_id: PROJECT_ID,
    name: 'Release 1',
    version_type: 'manual',
    source_version_id: null,
    snapshot_epoch: 2,
    snapshot_revision: 4,
    created_by: USER_ID,
    created_at: '2026-07-14T12:00:00.000Z',
    ...overrides,
  };
}

function makeClient(options: {
  list?: QueryResult;
  document?: QueryResult;
  preview?: QueryResult;
  profiles?: QueryResult;
  rpc?: QueryResult[];
} = {}) {
  const calls: Array<{ kind: string; table?: string; value?: unknown }> = [];
  const list = options.list ?? { data: [versionRow()], error: null };
  const preview = options.preview ?? {
    data: versionRow({ snapshot_content: '# Release 1' }),
    error: null,
  };
  const document = options.document ?? {
    data: { id: DOCUMENT_ID },
    error: null,
  };
  const profiles = options.profiles ?? {
    data: [{ id: USER_ID, full_name: 'Ada Editor', username: 'ada' }],
    error: null,
  };
  const rpcResults = [...(options.rpc ?? [])];

  const from = jest.fn((table: string) => {
    let selected = '';
    const builder = {
      select(columns: string) {
        selected = columns;
        calls.push({ kind: 'select', table, value: columns });
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push({ kind: `eq:${column}`, table, value });
        return builder;
      },
      order(column: string, value: unknown) {
        calls.push({ kind: `order:${column}`, table, value });
        return builder;
      },
      limit(value: number) {
        calls.push({ kind: 'limit', table, value });
        return builder;
      },
      in(column: string, value: unknown) {
        calls.push({ kind: `in:${column}`, table, value });
        return Promise.resolve(profiles);
      },
      single() {
        calls.push({ kind: 'single', table, value: selected });
        return Promise.resolve(preview);
      },
      maybeSingle() {
        calls.push({ kind: 'maybeSingle', table, value: selected });
        return Promise.resolve(document);
      },
      then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ) {
        return Promise.resolve(list).then(onfulfilled, onrejected);
      },
    };
    return builder;
  });
  const rpc = jest.fn(async (name: string, args: unknown) => {
    calls.push({ kind: `rpc:${name}`, value: args });
    return rpcResults.shift() ?? {
      data: [
        {
          version_id: VERSION_ID,
          ...versionRow(),
          id: undefined,
        },
      ],
      error: null,
    };
  });
  return {
    client: { from, rpc } as unknown as SupabaseClient,
    calls,
    from,
    rpc,
  };
}

describe('documentVersionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readDocumentState.mockResolvedValue({
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      mode: 'collaborative',
      markdown: '# Current',
      yjsStateBase64: 'snapshot',
      updateTail: [
        { id: UPDATE_A, updateBase64: 'tail-a' },
        { id: UPDATE_B, updateBase64: 'tail-b' },
      ],
      token: { epoch: 2, revision: 4 },
      updatedAt: '2026-07-14T12:00:00.000Z',
    });
    mergeYjsState.mockReturnValue('merged-state');
    yjsStateToMarkdown.mockResolvedValue('# Current merged');
  });

  it('lists metadata only and maps creator profile names', async () => {
    const { client, calls } = makeClient();
    const versions = await listDocumentVersions(client, DOCUMENT_ID);

    const versionSelect = calls.find(
      (call) => call.kind === 'select' && call.table === 'document_versions'
    );
    expect(versionSelect?.value).toBe(
      'id, document_id, project_id, name, version_type, source_version_id, snapshot_epoch, snapshot_revision, created_by, created_at'
    );
    expect(String(versionSelect?.value)).not.toContain('snapshot_content');
    expect(String(versionSelect?.value)).not.toContain('snapshot_yjs_state');
    expect(calls).toContainEqual({
      kind: 'select',
      table: 'profiles',
      value: 'id, full_name, username',
    });
    expect(versions).toEqual([
      {
        id: VERSION_ID,
        documentId: DOCUMENT_ID,
        projectId: PROJECT_ID,
        name: 'Release 1',
        type: 'manual',
        sourceVersionId: null,
        snapshotToken: { epoch: 2, revision: 4 },
        createdBy: USER_ID,
        createdByName: 'Ada Editor',
        createdAt: '2026-07-14T12:00:00.000Z',
      },
    ]);
  });

  it('returns an accessible empty history after a metadata-only document probe', async () => {
    const { client, calls } = makeClient({
      list: { data: [], error: null },
    });

    await expect(listDocumentVersions(client, DOCUMENT_ID)).resolves.toEqual([]);

    const documentSelect = calls.find(
      (call) => call.kind === 'select' && call.table === 'documents'
    );
    expect(documentSelect?.value).toBe('id');
    expect(calls).toContainEqual({
      kind: 'eq:id',
      table: 'documents',
      value: DOCUMENT_ID,
    });
    expect(String(documentSelect?.value)).not.toContain('content');
    expect(String(documentSelect?.value)).not.toContain('yjs_state');
  });

  it('maps a hidden or missing document behind an empty history to DocumentAccessError', async () => {
    const { client } = makeClient({
      list: { data: [], error: null },
      document: { data: null, error: null },
    });

    await expect(
      listDocumentVersions(client, DOCUMENT_ID)
    ).rejects.toBeInstanceOf(DocumentAccessError);
  });

  it.each(['42501', 'PGRST116'])(
    'does not leak document access probe error %s',
    async (code) => {
      const { client } = makeClient({
        list: { data: [], error: null },
        document: { data: null, error: { code, message: 'hidden detail' } },
      });

      await expect(
        listDocumentVersions(client, DOCUMENT_ID)
      ).rejects.toBeInstanceOf(DocumentAccessError);
    }
  );

  it('preserves unexpected document access probe errors', async () => {
    const error = { code: 'XX000', message: 'database unavailable' };
    const { client } = makeClient({
      list: { data: [], error: null },
      document: { data: null, error },
    });

    await expect(listDocumentVersions(client, DOCUMENT_ID)).rejects.toBe(error);
  });

  it.each(['42501', 'PGRST116'])(
    'does not leak version list error %s',
    async (code) => {
      const { client, calls } = makeClient({
        list: { data: null, error: { code, message: 'hidden detail' } },
      });

      await expect(
        listDocumentVersions(client, DOCUMENT_ID)
      ).rejects.toBeInstanceOf(DocumentAccessError);
      expect(calls.some((call) => call.table === 'documents')).toBe(false);
    }
  );

  it('preserves unexpected version list errors without probing the document', async () => {
    const error = { code: 'XX000', message: 'database unavailable' };
    const { client, calls } = makeClient({
      list: { data: null, error },
    });

    await expect(listDocumentVersions(client, DOCUMENT_ID)).rejects.toBe(error);
    expect(calls.some((call) => call.table === 'documents')).toBe(false);
  });

  it('loads Markdown but never Yjs payload for one preview', async () => {
    const { client, calls } = makeClient();
    const preview = await getDocumentVersionPreview(
      client,
      DOCUMENT_ID,
      VERSION_ID
    );

    const select = calls.find(
      (call) => call.kind === 'select' && call.table === 'document_versions'
    );
    expect(String(select?.value)).toContain('snapshot_content');
    expect(String(select?.value)).not.toContain('snapshot_yjs_state');
    expect(preview.markdown).toBe('# Release 1');
  });

  it('rejects invalid or hidden version ids without leaking access details', async () => {
    const invalid = makeClient();
    await expect(
      getDocumentVersionPreview(invalid.client, DOCUMENT_ID, 'not-a-uuid')
    ).rejects.toThrow('Invalid document version ID format');
    expect(invalid.from).not.toHaveBeenCalled();

    const hidden = makeClient({
      preview: { data: null, error: { code: 'PGRST116' } },
    });
    await expect(
      getDocumentVersionPreview(hidden.client, DOCUMENT_ID, VERSION_ID)
    ).rejects.toBeInstanceOf(DocumentAccessError);
  });

  it('deletes a version through the guarded document-scoped RPC', async () => {
    const { client, rpc } = makeClient({
      rpc: [{ data: VERSION_ID, error: null }],
    });

    await expect(
      deleteDocumentVersion(client, DOCUMENT_ID, VERSION_ID)
    ).resolves.toBe(VERSION_ID);
    expect(rpc).toHaveBeenCalledWith('delete_document_version', {
      p_document_id: DOCUMENT_ID,
      p_version_id: VERSION_ID,
    });
  });

  it('maps deletion permission and reference conflicts to typed errors', async () => {
    const denied = makeClient({
      rpc: [{ data: null, error: { code: '42501', message: 'denied' } }],
    });
    await expect(
      deleteDocumentVersion(denied.client, DOCUMENT_ID, VERSION_ID)
    ).rejects.toBeInstanceOf(DocumentReadOnlyError);

    const referenced = makeClient({
      rpc: [{ data: null, error: { code: 'PT409', message: 'referenced' } }],
    });
    await expect(
      deleteDocumentVersion(referenced.client, DOCUMENT_ID, VERSION_ID)
    ).rejects.toBeInstanceOf(DocumentStateConflictError);
  });

  it('maps missing deletion targets to DocumentAccessError', async () => {
    const missing = makeClient({
      rpc: [{ data: null, error: { code: 'P0002', message: 'missing' } }],
    });

    await expect(
      deleteDocumentVersion(missing.client, DOCUMENT_ID, VERSION_ID)
    ).rejects.toBeInstanceOf(DocumentAccessError);
  });

  it('maps protected audit deletion to DocumentStateConflictError', async () => {
    const protectedAudit = makeClient({
      rpc: [{ data: null, error: { code: 'PT409', message: 'audit protected' } }],
    });

    await expect(
      deleteDocumentVersion(protectedAudit.client, DOCUMENT_ID, VERSION_ID)
    ).rejects.toBeInstanceOf(DocumentStateConflictError);
  });

  it('validates deletion ids before calling the RPC', async () => {
    const { client, rpc } = makeClient();

    await expect(
      deleteDocumentVersion(client, 'not-a-document', VERSION_ID)
    ).rejects.toThrow('Invalid document ID format');
    await expect(
      deleteDocumentVersion(client, DOCUMENT_ID, 'not-a-version')
    ).rejects.toThrow('Invalid document version ID format');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('creates one exact merged snapshot and retries conflicts with a stable id', async () => {
    const { client, rpc } = makeClient({
      rpc: [
        { data: null, error: { code: 'PT409', message: 'tail changed' } },
        {
          data: [
            {
              version_id: VERSION_ID,
              document_id: DOCUMENT_ID,
              project_id: PROJECT_ID,
              name: 'Release 1',
              version_type: 'manual',
              source_version_id: null,
              snapshot_epoch: 2,
              snapshot_revision: 4,
              created_by: USER_ID,
              created_at: '2026-07-14T12:00:00.000Z',
            },
          ],
          error: null,
        },
      ],
    });

    await expect(
      createDocumentVersion(client, {
        documentId: DOCUMENT_ID,
        name: '  Release 1  ',
      })
    ).resolves.toMatchObject({ id: VERSION_ID, name: 'Release 1' });

    expect(readDocumentState).toHaveBeenCalledTimes(2);
    expect(mergeYjsState).toHaveBeenCalledWith('snapshot', ['tail-a', 'tail-b']);
    expect(yjsStateToMarkdown).toHaveBeenCalledWith('merged-state', []);
    const firstArgs = rpc.mock.calls[0]![1] as Record<string, unknown>;
    const secondArgs = rpc.mock.calls[1]![1] as Record<string, unknown>;
    expect(secondArgs.p_version_id).toBe(firstArgs.p_version_id);
    expect(secondArgs).toMatchObject({
      p_document_id: DOCUMENT_ID,
      p_expected_epoch: 2,
      p_expected_revision: 4,
      p_included_update_ids: [UPDATE_A, UPDATE_B],
      p_name: 'Release 1',
      p_yjs_state: 'merged-state',
      p_markdown: '# Current merged',
    });
  });

  it('maps mutation permission failures to DocumentReadOnlyError', async () => {
    const { client } = makeClient({
      rpc: [{ data: null, error: { code: '42501', message: 'denied' } }],
    });
    await expect(
      createDocumentVersion(client, {
        documentId: DOCUMENT_ID,
        name: 'Viewer attempt',
      })
    ).rejects.toBeInstanceOf(DocumentReadOnlyError);
  });

  it('creates an import checkpoint from a server-owned initialized snapshot', async () => {
    const { client, rpc } = makeClient({
      rpc: [{
        data: [{
          version_id: VERSION_ID,
          document_id: DOCUMENT_ID,
          project_id: PROJECT_ID,
          name: 'Imported world.docx',
          version_type: 'import',
          source_version_id: null,
          snapshot_epoch: 1,
          snapshot_revision: 1,
          created_by: USER_ID,
          created_at: '2026-07-14T12:00:00.000Z',
        }],
        error: null,
      }],
    });

    await expect(createDocumentImportCheckpoint(client, {
      documentId: DOCUMENT_ID,
      expected: { epoch: 1, revision: 1 },
      name: 'Imported world.docx',
    })).resolves.toMatchObject({ type: 'import', name: 'Imported world.docx' });

    expect(rpc).toHaveBeenCalledWith('create_document_import_checkpoint', {
      p_version_id: expect.any(String),
      p_document_id: DOCUMENT_ID,
      p_expected_epoch: 1,
      p_expected_revision: 1,
      p_name: 'Imported world.docx',
    });
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args).not.toHaveProperty('p_yjs_state');
    expect(args).not.toHaveProperty('p_markdown');
  });
});
