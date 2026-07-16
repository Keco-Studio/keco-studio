import type { SupabaseClient } from '@supabase/supabase-js';

// Authorization is exercised by its own suites; here we stub it so the tests
// focus on documentService's own validation (ids, folder-project integrity,
// not-found mapping).
jest.mock('../../../src/lib/services/authorizationService', () => {
  class AuthorizationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AuthorizationError';
    }
  }
  return {
    __esModule: true,
    AuthorizationError,
    verifyProjectAccess: jest.fn(async () => undefined),
    getUserProjectRole: jest.fn(async () => ({ role: 'editor', isOwner: false })),
    getCurrentUserId: jest.fn(async () => 'user-1'),
  };
});

import {
  getDocument,
  createDocument,
  moveDocument,
  DocumentNotFoundError,
} from '../../../src/lib/services/documentService';

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';
const FOLDER = '33333333-3333-4333-8333-333333333333';
const DOC = '44444444-4444-4444-8444-444444444444';

type Resp = { data: unknown; error: unknown };

function makeSupabase(cfg: {
  docSingle?: Resp;
  docInsert?: Resp;
  folderSingle?: Resp;
} = {}): SupabaseClient {
  const from = (table: string) => {
    if (table === 'folders') {
      return {
        select: () => ({
          eq: () => ({
            single: async () =>
              cfg.folderSingle ?? { data: null, error: { code: 'PGRST116' } },
          }),
        }),
      };
    }
    // documents
    return {
      select: () => ({
        eq: () => ({
          single: async () =>
            cfg.docSingle ?? { data: null, error: { code: 'PGRST116' } },
          order: async () => ({ data: [], error: null }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () => cfg.docInsert ?? { data: null, error: null },
        }),
      }),
      update: () => ({
        eq: () => {
          const p = Promise.resolve({ error: null }) as Promise<{ error: null }> & {
            select?: () => { single: () => Promise<Resp> };
          };
          p.select = () => ({
            single: async () => ({ data: { updated_at: 'now' }, error: null }),
          });
          return p;
        },
      }),
    };
  };
  return { from } as unknown as SupabaseClient;
}

describe('documentService.getDocument', () => {
  it('throws DocumentNotFoundError when the row is missing or hidden by RLS', async () => {
    const supabase = makeSupabase({ docSingle: { data: null, error: { code: 'PGRST116' } } });
    await expect(getDocument(supabase, DOC)).rejects.toBeInstanceOf(DocumentNotFoundError);
  });

  it('rejects malformed ids before hitting the database', async () => {
    await expect(getDocument(makeSupabase(), 'not-a-uuid')).rejects.toThrow(/Invalid document ID/);
  });

  it('returns the record on success', async () => {
    const record = {
      id: DOC,
      project_id: PROJECT_A,
      folder_id: null,
      name: 'Doc',
      content: '# Hi',
      created_by: 'user-1',
      created_at: 't',
      updated_at: 't',
    };
    const supabase = makeSupabase({ docSingle: { data: record, error: null } });
    await expect(getDocument(supabase, DOC)).resolves.toMatchObject({ id: DOC, content: '# Hi' });
  });
});

describe('documentService cross-project folder integrity', () => {
  it('rejects creating a document into a folder from another project', async () => {
    const supabase = makeSupabase({
      folderSingle: { data: { project_id: PROJECT_B }, error: null },
    });
    await expect(
      createDocument(supabase, { projectId: PROJECT_A, name: 'X', folderId: FOLDER })
    ).rejects.toThrow(/does not belong to the project/);
  });

  it('creates a document when the folder belongs to the same project', async () => {
    const record = {
      id: DOC,
      project_id: PROJECT_A,
      folder_id: FOLDER,
      name: 'X',
      content: '',
      created_by: 'user-1',
      created_at: 't',
      updated_at: 't',
    };
    const supabase = makeSupabase({
      folderSingle: { data: { project_id: PROJECT_A }, error: null },
      docInsert: { data: record, error: null },
    });
    await expect(
      createDocument(supabase, { projectId: PROJECT_A, name: 'X', folderId: FOLDER })
    ).resolves.toMatchObject({ id: DOC, folder_id: FOLDER });
  });

  it('rejects moving a document into a folder from another project', async () => {
    const supabase = makeSupabase({
      docSingle: { data: { project_id: PROJECT_A }, error: null },
      folderSingle: { data: { project_id: PROJECT_B }, error: null },
    });
    await expect(
      moveDocument(supabase, DOC, { folderId: FOLDER })
    ).rejects.toThrow(/does not belong to the project/);
  });
});
