import type { SupabaseClient } from '@supabase/supabase-js';

const markdownToYjsState = jest.fn(async (markdown: string) => `state:${markdown}`);
const yjsStateToMarkdown = jest.fn(async () => '# Derived');
const mergeYjsState = jest.fn(() => 'merged-state');

jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: {
    validate: jest.fn((markdown: string) => ({ markdown })),
    markdownToYjsState,
    yjsStateToMarkdown,
    mergeYjsState,
  },
  mergeYjsState,
}));

import {
  appendDocumentYjsUpdates,
  compactDocumentState,
  initializeDocumentState,
  readDocumentState,
} from '@/lib/documents/documentStateGateway';
import {
  DocumentAccessError,
  DocumentStateConflictError,
} from '@/lib/documents/documentStateTypes';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const UPDATE_A = '33333333-3333-4333-8333-333333333333';
const UPDATE_B = '44444444-4444-4444-8444-444444444444';

type ResponseValue = { data: unknown; error: null | { code?: string; message?: string } };

function makeSupabase(options: {
  head?: ResponseValue;
  tail?: ResponseValue;
  append?: ResponseValue;
  rpc?: ResponseValue;
} = {}) {
  const calls: Array<{ kind: string; value: unknown }> = [];
  const head = options.head ?? {
    data: {
      id: DOCUMENT_ID,
      project_id: PROJECT_ID,
      content: '# Stored',
      yjs_state: 'snapshot',
      collab_epoch: 2,
      collab_revision: 4,
      updated_at: '2026-07-14T12:00:00.000Z',
    },
    error: null,
  };
  const tail = options.tail ?? {
    data: [
      { id: UPDATE_A, update_data: 'tail-a', created_at: '2026-07-14T12:00:01.000Z' },
      { id: UPDATE_B, update_data: 'tail-b', created_at: '2026-07-14T12:00:02.000Z' },
    ],
    error: null,
  };

  const from = jest.fn((table: string) => {
    if (table === 'documents') {
      const builder = {
        select(columns: string) {
          calls.push({ kind: 'document-select', value: columns });
          return builder;
        },
        eq(column: string, value: unknown) {
          calls.push({ kind: `document-eq:${column}`, value });
          return builder;
        },
        single: async () => head,
      };
      return builder;
    }

    const updateBuilder = {
      select(columns: string) {
        calls.push({ kind: 'tail-select', value: columns });
        return updateBuilder;
      },
      eq(column: string, value: unknown) {
        calls.push({ kind: `tail-eq:${column}`, value });
        return updateBuilder;
      },
      order(column: string, config: unknown) {
        calls.push({ kind: `tail-order:${column}`, value: config });
        if (column === 'id') return Promise.resolve(tail);
        return updateBuilder;
      },
      upsert: async (rows: unknown, config: unknown) => {
        calls.push({ kind: 'tail-upsert', value: { rows, config } });
        return options.append ?? { data: null, error: null };
      },
    };
    return updateBuilder;
  });

  const rpc = jest.fn(async (name: string, args: unknown) => {
    calls.push({ kind: `rpc:${name}`, value: args });
    return options.rpc ?? {
      data: [
        {
          collab_epoch: 2,
          collab_revision: 5,
          yjs_state: 'committed-state',
          content: '# Committed',
          updated_at: '2026-07-14T12:00:03.000Z',
        },
      ],
      error: null,
    };
  });

  return {
    calls,
    client: { from, rpc } as unknown as SupabaseClient,
  };
}

describe('documentStateGateway.read', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns legacy Markdown without invoking the Yjs codec', async () => {
    const { client } = makeSupabase({
      head: {
        data: {
          id: DOCUMENT_ID,
          project_id: PROJECT_ID,
          content: '# Legacy',
          yjs_state: null,
          collab_epoch: 0,
          collab_revision: 0,
          updated_at: '2026-07-14T12:00:00.000Z',
        },
        error: null,
      },
      tail: { data: [], error: null },
    });

    await expect(readDocumentState(client, DOCUMENT_ID)).resolves.toMatchObject({
      mode: 'legacy',
      markdown: '# Legacy',
      yjsStateBase64: null,
      updateTail: [],
      token: { epoch: 0, revision: 0 },
    });
    expect(yjsStateToMarkdown).not.toHaveBeenCalled();
  });

  it('derives current Markdown from the snapshot and ordered current-epoch tail', async () => {
    const { client, calls } = makeSupabase();
    const state = await readDocumentState(client, DOCUMENT_ID);

    expect(state).toMatchObject({
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      mode: 'collaborative',
      markdown: '# Derived',
      token: { epoch: 2, revision: 4 },
    });
    expect(state.updateTail.map((update) => update.id)).toEqual([UPDATE_A, UPDATE_B]);
    expect(yjsStateToMarkdown).toHaveBeenCalledWith('snapshot', ['tail-a', 'tail-b']);
    expect(calls).toContainEqual({ kind: 'tail-eq:epoch', value: 2 });
    expect(calls).toContainEqual({
      kind: 'tail-select',
      value: 'id, update_data, created_at',
    });
  });

  it('maps a hidden or missing document to DocumentAccessError', async () => {
    const { client } = makeSupabase({
      head: { data: null, error: { code: 'PGRST116' } },
    });
    await expect(readDocumentState(client, DOCUMENT_ID)).rejects.toBeInstanceOf(
      DocumentAccessError
    );
  });
});

describe('documentStateGateway mutations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('initializes Markdown and Yjs atomically through the guarded RPC', async () => {
    const { client, calls } = makeSupabase({
      rpc: {
        data: [
          {
            collab_epoch: 0,
            collab_revision: 1,
            yjs_state: 'state:# Initial',
            content: '# Initial',
            updated_at: '2026-07-14T12:00:00.000Z',
          },
        ],
        error: null,
      },
    });
    const state = await initializeDocumentState(client, DOCUMENT_ID, '# Initial');

    expect(markdownToYjsState).toHaveBeenCalledWith('# Initial');
    expect(calls).toContainEqual({
      kind: 'rpc:initialize_document_collab_state',
      value: {
        p_document_id: DOCUMENT_ID,
        p_expected_epoch: 0,
        p_yjs_state: 'state:# Initial',
        p_markdown: '# Initial',
      },
    });
    expect(state.token).toEqual({ epoch: 0, revision: 1 });
  });

  it('maps initialization CAS failures to DocumentStateConflictError', async () => {
    const { client } = makeSupabase({
      rpc: { data: null, error: { code: 'PT409', message: 'changed' } },
    });
    await expect(
      initializeDocumentState(client, DOCUMENT_ID, '# Initial')
    ).rejects.toBeInstanceOf(DocumentStateConflictError);
  });

  it('appends an idempotent batch through the guarded creator-stamping RPC', async () => {
    const { client, calls } = makeSupabase();
    await expect(
      appendDocumentYjsUpdates(client, {
        documentId: DOCUMENT_ID,
        epoch: 2,
        updates: [
          { id: UPDATE_A, updateBase64: 'tail-a' },
          { id: UPDATE_B, updateBase64: 'tail-b' },
        ],
      })
    ).resolves.toEqual({ acceptedIds: [UPDATE_A, UPDATE_B] });

    expect(calls).toContainEqual({
      kind: 'rpc:append_document_yjs_updates',
      value: {
        p_document_id: DOCUMENT_ID,
        p_epoch: 2,
        p_updates: [
          { id: UPDATE_A, updateBase64: 'tail-a' },
          { id: UPDATE_B, updateBase64: 'tail-b' },
        ],
      },
    });
  });

  it('maps stale append epochs to DocumentStateConflictError', async () => {
    const { client } = makeSupabase({
      rpc: { data: null, error: { code: 'PT409', message: 'epoch changed' } },
    });
    await expect(
      appendDocumentYjsUpdates(client, {
        documentId: DOCUMENT_ID,
        epoch: 2,
        updates: [{ id: UPDATE_A, updateBase64: 'tail-a' }],
      })
    ).rejects.toBeInstanceOf(DocumentStateConflictError);
  });

  it('compacts exactly the head and tail read under the expected token', async () => {
    const { client, calls } = makeSupabase();
    const state = await compactDocumentState(client, {
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 4 },
    });

    expect(mergeYjsState).toHaveBeenCalledWith('snapshot', ['tail-a', 'tail-b']);
    expect(yjsStateToMarkdown).toHaveBeenCalledWith('merged-state', []);
    expect(calls).toContainEqual({
      kind: 'rpc:compact_document_collab_state',
      value: {
        p_document_id: DOCUMENT_ID,
        p_expected_epoch: 2,
        p_expected_revision: 4,
        p_included_update_ids: [UPDATE_A, UPDATE_B],
        p_yjs_state: 'merged-state',
        p_markdown: '# Derived',
      },
    });
    expect(state.token).toEqual({ epoch: 2, revision: 5 });
  });

  it('rejects compaction when the caller token is already stale locally', async () => {
    const { client, calls } = makeSupabase();
    await expect(
      compactDocumentState(client, {
        documentId: DOCUMENT_ID,
        expected: { epoch: 2, revision: 3 },
      })
    ).rejects.toBeInstanceOf(DocumentStateConflictError);
    expect(calls.some((call) => call.kind.startsWith('rpc:compact'))).toBe(false);
  });
});
