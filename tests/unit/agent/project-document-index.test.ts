import type { SupabaseClient } from '@supabase/supabase-js';

const getSupabaseServiceRoleClient = jest.fn();
const read = jest.fn();
const embedTexts = jest.fn();
let mockIndexingEnabled = true;

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient }));
jest.mock('@/lib/documents/documentStateGateway', () => ({
  documentStateGateway: { read },
}));
jest.mock('@/lib/agent/embedding-client', () => ({ embedTexts }));
jest.mock('@/lib/agent/embedding-config', () => ({
  get AGENT_INDEXING_ENABLED() {
    return mockIndexingEnabled;
  },
}));

import {
  reindexProjectDocumentAsActor,
  reindexProjectDocumentsAsActor,
  removeProjectDocumentIndex,
} from '@/lib/server/documentEmbeddingIndexService';
import { indexDesignDocumentFromMessage } from '@/lib/agent/embedding-index';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';
const UPDATE_ID = '55555555-5555-4555-8555-555555555555';

function query(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const builder: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq', 'like', 'delete', 'upsert', 'single', 'maybeSingle']) {
    builder[method] = jest.fn(() => builder);
  }
  Object.assign(builder, {
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(resolve({ data: result.data ?? null, error: result.error ?? null })),
  });
  return builder;
}

describe('design document message indexing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIndexingEnabled = true;
    embedTexts.mockResolvedValue([[0.1, 0.2]]);
  });

  it.each([
    ['current', '[Document attachment]'],
    ['legacy', '[Design document]'],
  ])('indexes %s envelopes without embedding the header', async (_label, header) => {
    const indexQuery = query();
    const supabase = {
      from: jest.fn(() => indexQuery),
    } as unknown as SupabaseClient;
    const body = 'Visible document content that is long enough to produce an embedding chunk.';

    await indexDesignDocumentFromMessage(supabase, {
      projectId: PROJECT_ID,
      userId: ACTOR_ID,
      conversationId: 'conversation-id',
      messageId: 'message-id',
      messageText: `${header}\n${body}`,
      messageCreatedAt: '2026-07-21T00:00:00.000Z',
    });

    expect(embedTexts).toHaveBeenCalledWith([body]);
    expect(indexQuery.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ source_type: 'design_document', content: body })],
      { onConflict: 'source_type,source_id,chunk_index,content_hash' }
    );
  });
});

describe('project document embedding index service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIndexingEnabled = true;
    read.mockResolvedValue({
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      markdown: '# Latest\nCurrent logical state.',
      updatedAt: '2026-07-16T06:30:00.000Z',
      token: { epoch: 2, revision: 4 },
      updateTail: [],
    });
    embedTexts.mockResolvedValue([[0.1, 0.2]]);
  });

  it('rechecks actor access, reads logical Markdown, clears stale rows, and upserts metadata', async () => {
    const metadataQuery = query({
      data: {
        id: DOCUMENT_ID,
        project_id: PROJECT_ID,
        folder_id: '44444444-4444-4444-8444-444444444444',
        name: 'Guide',
        updated_at: '2026-07-16T06:30:00.000Z',
      },
    });
    const folderQuery = query({ data: { name: 'Docs' } });
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    const from = jest.fn((table: string) => {
      if (table === 'documents') return metadataQuery;
      if (table === 'folders') return folderQuery;
      throw new Error(`unexpected table ${table}`);
    });
    getSupabaseServiceRoleClient.mockReturnValue({ rpc, from } as unknown as SupabaseClient);

    await expect(
      reindexProjectDocumentAsActor({
        actorUserId: ACTOR_ID,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
      })
    ).resolves.toEqual({ documentId: DOCUMENT_ID, chunks: 1 });

    expect(rpc).toHaveBeenCalledWith('user_has_project_access', {
      p_project_id: PROJECT_ID,
      p_user_id: ACTOR_ID,
    });
    expect(read).toHaveBeenCalledWith(expect.anything(), DOCUMENT_ID);
    expect(embedTexts).toHaveBeenCalledWith(['# Latest\nCurrent logical state.']);
    expect(rpc).toHaveBeenLastCalledWith(
      'replace_project_document_embedding_chunks',
      expect.objectContaining({
        p_project_id: PROJECT_ID,
        p_document_id: DOCUMENT_ID,
        p_expected_epoch: 2,
        p_expected_revision: 4,
        p_expected_update_ids: [],
        p_rows: [expect.objectContaining({
          sourceId: `${DOCUMENT_ID}:chunk:0`,
          chunkIndex: 0,
          content: '# Latest\nCurrent logical state.',
          metadata: expect.objectContaining({
            documentId: DOCUMENT_ID,
            documentName: 'Guide',
            folderName: 'Docs',
            heading: 'Latest',
            startLine: 1,
            endLine: 2,
            documentUpdatedAt: '2026-07-16T06:30:00.000Z',
          }),
        })],
      })
    );
  });

  it('denies a service-role operation when the actor lacks project access', async () => {
    const from = jest.fn();
    getSupabaseServiceRoleClient.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: false, error: null }),
      from,
    } as unknown as SupabaseClient);

    await expect(
      removeProjectDocumentIndex({
        actorUserId: ACTOR_ID,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
      })
    ).rejects.toThrow(/access/i);
    expect(from).not.toHaveBeenCalled();
  });

  it('skips single and project-wide reindexing when indexing is disabled', async () => {
    mockIndexingEnabled = false;

    await expect(
      reindexProjectDocumentAsActor({
        actorUserId: ACTOR_ID,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
      })
    ).resolves.toEqual({ documentId: DOCUMENT_ID, chunks: 0, skipped: true });
    await expect(
      reindexProjectDocumentsAsActor({ actorUserId: ACTOR_ID, projectId: PROJECT_ID })
    ).resolves.toEqual({ documents: 0, chunks: 0, skipped: true });

    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it('retries latest logical state when only the un-compacted update tail changed', async () => {
    const metadataQuery = query({
      data: { id: DOCUMENT_ID, project_id: PROJECT_ID, folder_id: null, name: 'Guide' },
    });
    read
      .mockResolvedValueOnce({
        documentId: DOCUMENT_ID,
        projectId: PROJECT_ID,
        markdown: '# Old\nOld state.',
        updatedAt: '2026-07-16T06:30:00.000Z',
        token: { epoch: 2, revision: 4 },
        updateTail: [],
      })
      .mockResolvedValueOnce({
        documentId: DOCUMENT_ID,
        projectId: PROJECT_ID,
        markdown: '# New\nLatest state.',
        updatedAt: '2026-07-16T06:30:00.000Z',
        token: { epoch: 2, revision: 4 },
        updateTail: [{ id: UPDATE_ID }],
      });
    embedTexts.mockResolvedValueOnce([[0.1]]).mockResolvedValueOnce([[0.2]]);
    let replacement = 0;
    const rpc = jest.fn(async (name: string) => {
      if (name === 'user_has_project_access') return { data: true, error: null };
      replacement += 1;
      return { data: replacement > 1, error: null };
    });
    getSupabaseServiceRoleClient.mockReturnValue({
      rpc,
      from: jest.fn((table: string) => {
        if (table === 'documents') return metadataQuery;
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as SupabaseClient);

    await expect(
      reindexProjectDocumentAsActor({
        actorUserId: ACTOR_ID,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
      })
    ).resolves.toEqual({ documentId: DOCUMENT_ID, chunks: 1 });
    expect(embedTexts).toHaveBeenNthCalledWith(1, ['# Old\nOld state.']);
    expect(embedTexts).toHaveBeenNthCalledWith(2, ['# New\nLatest state.']);
    expect(rpc).toHaveBeenLastCalledWith(
      'replace_project_document_embedding_chunks',
      expect.objectContaining({
        p_expected_revision: 4,
        p_expected_update_ids: [UPDATE_ID],
        p_expected_updated_at: '2026-07-16T06:30:00.000Z',
        p_rows: [expect.objectContaining({ content: '# New\nLatest state.' })],
      })
    );
  });

  it('clears stale rows without embedding or upserting when the logical document is empty', async () => {
    read.mockResolvedValue({
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      markdown: '  \n',
      updatedAt: '2026-07-16T06:30:00.000Z',
      token: { epoch: 0, revision: 0 },
      updateTail: [],
    });
    const metadataQuery = query({
      data: { id: DOCUMENT_ID, project_id: PROJECT_ID, folder_id: null, name: 'Empty' },
    });
    const from = jest.fn((table: string) => {
      if (table === 'documents') return metadataQuery;
      throw new Error(`unexpected table ${table}`);
    });
    getSupabaseServiceRoleClient.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: true, error: null }),
      from,
    } as unknown as SupabaseClient);

    await expect(
      reindexProjectDocumentAsActor({
        actorUserId: ACTOR_ID,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
      })
    ).resolves.toEqual({ documentId: DOCUMENT_ID, chunks: 0 });
    expect(embedTexts).not.toHaveBeenCalled();
    expect(getSupabaseServiceRoleClient().rpc).toHaveBeenLastCalledWith(
      'replace_project_document_embedding_chunks',
      expect.objectContaining({ p_rows: [] })
    );
  });

  it('paginates past 1000 documents without skipping logical document state', async () => {
    const documents = Array.from({ length: 1001 }, (_, index) => ({
      id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
      project_id: PROJECT_ID,
      folder_id: null,
      name: `Document ${index + 1}`,
      updated_at: '2026-07-16T06:30:00.000Z',
    }));
    const ranges: Array<[number, number]> = [];
    const from = jest.fn((table: string) => {
      if (table === 'documents') {
        const filters = new Map<string, unknown>();
        const builder: Record<string, jest.Mock> = {};
        builder.select = jest.fn(() => builder);
        builder.eq = jest.fn((column: string, value: unknown) => {
          filters.set(column, value);
          return builder;
        });
        builder.order = jest.fn(() => builder);
        builder.range = jest.fn(async (start: number, end: number) => {
          ranges.push([start, end]);
          return { data: documents.slice(start, end + 1), error: null };
        });
        builder.single = jest.fn(async () => ({
          data: documents.find((document) => document.id === filters.get('id')) ?? null,
          error: null,
        }));
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    });
    read.mockImplementation(async (_admin: unknown, documentId: string) => ({
      documentId,
      projectId: PROJECT_ID,
      markdown: '',
      updatedAt: '2026-07-16T06:30:00.000Z',
      token: { epoch: 0, revision: 0 },
      updateTail: [],
    }));
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    getSupabaseServiceRoleClient.mockReturnValue({
      rpc,
      from,
    } as unknown as SupabaseClient);

    await expect(
      reindexProjectDocumentsAsActor({ actorUserId: ACTOR_ID, projectId: PROJECT_ID })
    ).resolves.toEqual({ documents: 1001, chunks: 0 });
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(read).toHaveBeenCalledTimes(1001);
    expect(rpc.mock.calls.filter(([name]) => name === 'replace_project_document_embedding_chunks')).toHaveLength(1001);
  });
});
