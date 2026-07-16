import type { SupabaseClient } from '@supabase/supabase-js';

const getSupabaseServiceRoleClient = jest.fn();
const markdownToYjsState = jest.fn();
const validate = jest.fn();
jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient }));
jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: { validate, markdownToYjsState },
}));

import { publishImportedDocumentAsActor } from '@/lib/server/documentImportPublishService';

describe('document import publish server command', () => {
  it('generates Yjs state server-side and calls the service-role-only transaction', async () => {
    const rpc = jest.fn(async () => ({ data: [{ id: '11111111-1111-4111-8111-111111111111' }], error: null }));
    getSupabaseServiceRoleClient.mockReturnValue({ rpc } as unknown as SupabaseClient);
    markdownToYjsState.mockResolvedValue('server-yjs-state');

    await publishImportedDocumentAsActor({
      documentId: '11111111-1111-4111-8111-111111111111',
      versionId: '44444444-4444-4444-8444-444444444444',
      actorUserId: '33333333-3333-4333-8333-333333333333',
      projectId: '22222222-2222-4222-8222-222222222222',
      folderId: null,
      name: 'Guide',
      markdown: '# Guide',
    });

    expect(rpc).toHaveBeenCalledWith('create_imported_document', expect.objectContaining({
      p_document_id: '11111111-1111-4111-8111-111111111111',
      p_version_id: '44444444-4444-4444-8444-444444444444',
      p_actor_user_id: '33333333-3333-4333-8333-333333333333',
      p_markdown: '# Guide',
      p_yjs_state: 'server-yjs-state',
    }));
  });
});
