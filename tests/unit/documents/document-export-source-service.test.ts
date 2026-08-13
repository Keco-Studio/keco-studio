import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('server-only', () => ({}));

const readDocumentState = jest.fn();
const getUserProjectRole = jest.fn();

jest.mock('@/lib/documents/documentStateGateway', () => ({
  documentStateGateway: {
    read: (...args: unknown[]) => readDocumentState(...args),
  },
}));
jest.mock('@/lib/services/authorizationService', () => ({
  getUserProjectRole: (...args: unknown[]) => getUserProjectRole(...args),
}));

import { getDocumentExportSource } from '@/lib/server/documentExportSourceService';
import { verifyDocumentExportSnapshotToken } from '@/lib/server/documentExportSnapshotSigning';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const FOLDER_ID = '33333333-3333-4333-8333-333333333333';

function makeSupabase(metadata = {
  data: { name: 'World Notes', folder_id: null },
  error: null,
}): SupabaseClient {
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(metadata),
  };
  return { from: jest.fn(() => query) } as unknown as SupabaseClient;
}

describe('getDocumentExportSource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readDocumentState.mockResolvedValue({
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      markdown: '# Latest\nBody',
      token: { epoch: 2, revision: 7 },
    });
    getUserProjectRole.mockResolvedValue({ role: 'admin', isOwner: true });
  });

  it('freezes the latest authoritative Markdown and document placement', async () => {
    const supabase = makeSupabase();

    const source = await getDocumentExportSource(supabase, 'admin-id', DOCUMENT_ID);
    expect(source).toMatchObject({
      documentId: DOCUMENT_ID,
      documentName: 'World Notes',
      projectId: PROJECT_ID,
      folderId: null,
      markdown: '# Latest\nBody',
      token: { epoch: 2, revision: 7 },
    });
    const { snapshotToken: _snapshotToken, ...unsignedSource } = source;
    expect(verifyDocumentExportSnapshotToken(source.snapshotToken!)).toEqual(unsignedSource);
    expect(readDocumentState).toHaveBeenCalledWith(supabase, DOCUMENT_ID);
    expect(getUserProjectRole).toHaveBeenCalledWith(supabase, PROJECT_ID, 'admin-id');
  });

  it('allows editors to load export metadata', async () => {
    getUserProjectRole.mockResolvedValue({ role: 'editor', isOwner: false });
    const supabase = makeSupabase();

    await expect(getDocumentExportSource(supabase, 'editor-id', DOCUMENT_ID, 'script'))
      .resolves.toMatchObject({ documentId: DOCUMENT_ID });
  });

  it('rejects viewers before loading export metadata', async () => {
    getUserProjectRole.mockResolvedValue({ role: 'viewer', isOwner: false });
    const supabase = makeSupabase();
    await expect(getDocumentExportSource(supabase, 'viewer-id', DOCUMENT_ID))
      .rejects.toThrow('Only admin and editor users can generate conversations');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('rejects empty authoritative Markdown', async () => {
    readDocumentState.mockResolvedValue({
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      markdown: '  \n',
      token: { epoch: 2, revision: 7 },
    });

    await expect(
      getDocumentExportSource(makeSupabase(), 'admin-id', DOCUMENT_ID)
    ).rejects.toThrow('Document is empty');
  });

  it('maps missing metadata to the stable document access message', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: 'PGRST116' },
    } as never);

    await expect(
      getDocumentExportSource(supabase, 'admin-id', DOCUMENT_ID)
    ).rejects.toThrow('Document not found or not accessible');
  });

  it('preserves the source document folder', async () => {
    await expect(
      getDocumentExportSource(
        makeSupabase({ data: { name: 'World Notes', folder_id: FOLDER_ID }, error: null }),
        'admin-id',
        DOCUMENT_ID
      )
    ).resolves.toMatchObject({ folderId: FOLDER_ID });
  });
});
