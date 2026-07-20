import type { SupabaseClient } from '@supabase/supabase-js';
import { DocumentStateConflictError } from '../../../src/lib/documents/documentStateTypes';

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
    verifyLibraryAccess: jest.fn(async () => undefined),
    verifyLibraryCreationPermission: jest.fn(async () => undefined),
    verifyLibraryUpdatePermission: jest.fn(async () => undefined),
    getUserProjectRole: jest.fn(async () => ({ role: 'editor', isOwner: false })),
    getCurrentUserId: jest.fn(async () => 'user-1'),
  };
});

import {
  getDocument,
  createDocument,
  listDocuments,
  moveDocument,
  deleteDocumentIfUnchanged,
  DocumentNotFoundError,
} from '../../../src/lib/services/documentService';
import {
  createLibrary,
  moveLibraryToFolder,
} from '../../../src/lib/services/libraryService';

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';
const FOLDER = '33333333-3333-4333-8333-333333333333';
const DOC = '44444444-4444-4444-8444-444444444444';
const LIBRARY_ID = '55555555-5555-4555-8555-555555555555';

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

describe('documentService.listDocuments', () => {
  it('fetches deterministic, non-overlapping pages until the first short page', async () => {
    const pages = [1000, 1000, 2].map((length, pageIndex) =>
      Array.from({ length }, (_, rowIndex) => {
        const ordinal = pageIndex * 1000 + rowIndex;
        return {
          id: `doc-${ordinal.toString().padStart(4, '0')}`,
          project_id: PROJECT_A,
          folder_id: null,
          name: `Document ${ordinal}`,
          created_at: '2026-07-16T00:00:00.000Z',
          updated_at: '2026-07-16T00:00:00.000Z',
        };
      })
    );
    const orderCalls: Array<[string, { ascending: boolean }]> = [];
    const rangeCalls: Array<[number, number]> = [];
    const builder = {
      select: jest.fn(),
      eq: jest.fn(),
      order: jest.fn((column: string, options: { ascending: boolean }) => {
        orderCalls.push([column, options]);
        return builder;
      }),
      range: jest.fn(async (from: number, to: number) => {
        rangeCalls.push([from, to]);
        const page = pages[rangeCalls.length - 1] ?? [];
        return { data: page, error: null };
      }),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    const supabase = {
      from: jest.fn(() => builder),
    } as unknown as SupabaseClient;

    const result = await listDocuments(supabase, PROJECT_A);

    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(orderCalls).toEqual([
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(result).toHaveLength(2002);
    expect(result.map((row) => row.id)).toEqual(pages.flat().map((row) => row.id));
    expect(new Set(result.map((row) => row.id)).size).toBe(2002);
  });
});

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

describe('documentService atomic document deletion', () => {
  const snapshot = {
    documentId: DOC,
    projectId: PROJECT_A,
    name: 'Guide',
    folderId: FOLDER,
    updatedAt: '2026-07-16T00:00:00.000Z',
    expected: { epoch: 2, revision: 4 },
    expectedUpdateIds: ['55555555-5555-4555-8555-555555555555'],
  };

  it('exposes a focused unchanged-snapshot delete operation', () => {
    expect(typeof deleteDocumentIfUnchanged).toBe('function');
  });

  it('passes the exact metadata and collaboration snapshot to one atomic RPC', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: DOC, error: null });
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(deleteDocumentIfUnchanged(supabase, snapshot)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('delete_document_if_unchanged', {
      p_document_id: DOC,
      p_project_id: PROJECT_A,
      p_expected_name: 'Guide',
      p_expected_folder_id: FOLDER,
      p_expected_updated_at: '2026-07-16T00:00:00.000Z',
      p_expected_epoch: 2,
      p_expected_revision: 4,
      p_expected_update_ids: ['55555555-5555-4555-8555-555555555555'],
    });
  });

  it('maps metadata mutation at the atomic boundary to a state conflict', async () => {
    const supabase = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PT409', message: 'Document metadata changed' },
      }),
    } as unknown as SupabaseClient;

    await expect(deleteDocumentIfUnchanged(supabase, snapshot)).rejects.toBeInstanceOf(
      DocumentStateConflictError
    );
  });

  it('maps an appended update tail at the atomic boundary to a state conflict', async () => {
    const supabase = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PT409', message: 'Document update tail changed' },
      }),
    } as unknown as SupabaseClient;

    await expect(deleteDocumentIfUnchanged(supabase, snapshot)).rejects.toMatchObject({
      name: 'DocumentStateConflictError',
      message: 'Document update tail changed',
    });
  });
});

describe('document-derived library ownership', () => {
  it('creates a derived library in its source document folder with ownership metadata', async () => {
    const insert = jest.fn((row: unknown) => ({
      select: () => ({
        single: async () => ({ data: { id: 'library-id' }, error: null }),
      }),
    }));
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'documents') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: DOC, project_id: PROJECT_A, folder_id: FOLDER },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'libraries') return { insert };
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient;

    await expect(createLibrary(supabase, {
      projectId: PROJECT_A,
      name: 'Characters',
      folderId: PROJECT_B,
      documentSource: { sourceDocumentId: DOC, exportType: 'table' },
    })).resolves.toBe('library-id');
    expect(insert).toHaveBeenCalledWith({
      project_id: PROJECT_A,
      folder_id: FOLDER,
      name: 'Characters',
      description: null,
      source_document_id: DOC,
      document_export_type: 'table',
    });
  });

  it('rejects independent moves of document-derived libraries before target checks', async () => {
    const supabase = {
      from: jest.fn((table: string) => {
        if (table !== 'libraries') throw new Error(`Unexpected table: ${table}`);
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: LIBRARY_ID,
                  project_id: PROJECT_A,
                  folder_id: FOLDER,
                  name: 'Characters',
                  description: null,
                  source_document_id: DOC,
                  document_export_type: 'table',
                },
                error: null,
              }),
            }),
          }),
        };
      }),
    } as unknown as SupabaseClient;

    await expect(
      moveLibraryToFolder(supabase, LIBRARY_ID, { folderId: 'not-a-uuid' })
    ).rejects.toThrow(
      'Libraries generated from a document move with their source document'
    );
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});
