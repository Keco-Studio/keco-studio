import { NextRequest } from 'next/server';

const resolveUserRole = jest.fn();
const indexLibraryCell = jest.fn();
const indexLibraryRow = jest.fn();
const indexLibrarySchema = jest.fn();
const reindexProjectDocumentAsActor = jest.fn();
const valuesQuery = jest.fn();

jest.mock('@/lib/agent/permissions', () => ({ resolveUserRole }));
jest.mock('@/lib/agent/embedding-index', () => ({
  indexLibraryCell, indexLibraryRow, indexLibrarySchema,
}));
jest.mock('@/lib/server/documentEmbeddingIndexService', () => ({
  reindexProjectDocumentAsActor,
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ limit: valuesQuery }) }) }),
  }),
}));

import { POST } from '@/app/api/mcp/reindex/route';

const projectId = '11111111-1111-4111-8111-111111111111';
const actorUserId = '22222222-2222-4222-8222-222222222222';
const objectId = '33333333-3333-4333-8333-333333333333';

function request(body: unknown, secret = 'codec-test-secret') {
  return new NextRequest('https://keco.test/api/mcp/reindex', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('MCP trusted reindex route', () => {
  const originalSecret = process.env.MCP_CODEC_SECRET;

  beforeEach(() => {
    process.env.MCP_CODEC_SECRET = 'codec-test-secret';
    jest.clearAllMocks();
    resolveUserRole.mockResolvedValue('editor');
    valuesQuery.mockResolvedValue({ data: [{ field_id: objectId }], error: null });
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.MCP_CODEC_SECRET;
    else process.env.MCP_CODEC_SECRET = originalSecret;
  });

  it('rejects untrusted, malformed, and non-writer requests', async () => {
    expect((await POST(request({}, 'wrong'))).status).toBe(401);
    expect((await POST(request({ kind: 'row' }))).status).toBe(400);
    resolveUserRole.mockResolvedValueOnce('viewer');
    expect((await POST(request({ kind: 'row', projectId, actorUserId, rowId: objectId }))).status)
      .toBe(403);
    expect(indexLibraryRow).not.toHaveBeenCalled();
  });

  it('reindexes table, row cells, and document with current actor scope', async () => {
    expect((await POST(request({ kind: 'table', projectId, actorUserId, tableId: objectId }))).status)
      .toBe(200);
    expect(indexLibrarySchema).toHaveBeenCalledWith(expect.anything(), {
      projectId, libraryId: objectId,
    });

    expect((await POST(request({ kind: 'row', projectId, actorUserId, rowId: objectId }))).status)
      .toBe(200);
    expect(indexLibraryRow).toHaveBeenCalledWith(expect.anything(), { projectId, assetId: objectId });
    expect(indexLibraryCell).toHaveBeenCalledWith(expect.anything(), {
      projectId, assetId: objectId, fieldId: objectId,
    });

    expect((await POST(request({ kind: 'document', projectId, actorUserId,
      documentId: objectId }))).status).toBe(200);
    expect(reindexProjectDocumentAsActor).toHaveBeenCalledWith({
      actorUserId, projectId, documentId: objectId,
    });
  });
});
