import type { SupabaseClient } from '@supabase/supabase-js';
import { publishImportedDocument } from '@/lib/documents/documentImportPublisher';

describe('document import publisher', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends semantic Markdown to the authenticated server boundary', async () => {
    const client = {
      auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'token' } }, error: null })) },
    } as unknown as SupabaseClient;
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      document: { id: '11111111-1111-4111-8111-111111111111' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(publishImportedDocument(client, {
      documentId: '11111111-1111-4111-8111-111111111111',
      versionId: '33333333-3333-4333-8333-333333333333',
      projectId: '22222222-2222-4222-8222-222222222222',
      folderId: null,
      name: 'Guide',
      markdown: '# Guide',
    })).resolves.toMatchObject({ id: '11111111-1111-4111-8111-111111111111' });

    expect(fetchSpy).toHaveBeenCalledWith('/api/documents/import', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      body: JSON.stringify({
        documentId: '11111111-1111-4111-8111-111111111111',
        versionId: '33333333-3333-4333-8333-333333333333',
        projectId: '22222222-2222-4222-8222-222222222222',
        folderId: null,
        name: 'Guide',
        markdown: '# Guide',
      }),
    }));
  });

  it('retries an uncertain request with the exact same publication ids', async () => {
    const client = {
      auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'token' } }, error: null })) },
    } as unknown as SupabaseClient;
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        document: { id: '11111111-1111-4111-8111-111111111111' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const input = {
      documentId: '11111111-1111-4111-8111-111111111111',
      versionId: '33333333-3333-4333-8333-333333333333',
      projectId: '22222222-2222-4222-8222-222222222222',
      folderId: null,
      name: 'Guide',
      markdown: '# Guide',
    };

    await expect(publishImportedDocument(client, input)).resolves.toMatchObject({
      id: input.documentId,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(fetchSpy.mock.calls[1]?.[1]);
  });

  it('classifies an exhausted network retry as an unknown publication outcome', async () => {
    const client = {
      auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'token' } }, error: null })) },
    } as unknown as SupabaseClient;
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('connection reset'));

    await expect(publishImportedDocument(client, {
      documentId: '11111111-1111-4111-8111-111111111111',
      versionId: '33333333-3333-4333-8333-333333333333',
      projectId: '22222222-2222-4222-8222-222222222222',
      folderId: null,
      name: 'Guide',
      markdown: '# Guide',
    })).rejects.toMatchObject({ publicationState: 'unknown' });
  });

  it('keeps the outcome unknown when a retry is rejected after an uncertain attempt', async () => {
    const client = {
      auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'token' } }, error: null })) },
    } as unknown as SupabaseClient;
    jest.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'Authentication required',
      }), { status: 401, headers: { 'content-type': 'application/json' } }));

    await expect(publishImportedDocument(client, {
      documentId: '11111111-1111-4111-8111-111111111111',
      versionId: '33333333-3333-4333-8333-333333333333',
      projectId: '22222222-2222-4222-8222-222222222222',
      folderId: null,
      name: 'Guide',
      markdown: '# Guide',
    })).rejects.toMatchObject({ publicationState: 'unknown' });
  });

  it('classifies a definitive client rejection as not published', async () => {
    const client = {
      auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'token' } }, error: null })) },
    } as unknown as SupabaseClient;
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: 'Document import is forbidden',
    }), { status: 403, headers: { 'content-type': 'application/json' } }));

    await expect(publishImportedDocument(client, {
      documentId: '11111111-1111-4111-8111-111111111111',
      versionId: '33333333-3333-4333-8333-333333333333',
      projectId: '22222222-2222-4222-8222-222222222222',
      folderId: null,
      name: 'Guide',
      markdown: '# Guide',
    })).rejects.toMatchObject({ publicationState: 'not-published' });
  });
});
