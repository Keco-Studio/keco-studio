/**
 * Folder delete must remove documents inside the folder.
 * Otherwise documents.folder_id ON DELETE SET NULL resurfaces them at project root.
 */

jest.mock('@/lib/services/authorizationService', () => ({
  verifyFolderDeletionPermission: jest.fn().mockResolvedValue(undefined),
  verifyFolderAccess: jest.fn(),
  verifyFolderCreationPermission: jest.fn(),
  verifyFolderUpdatePermission: jest.fn(),
  verifyProjectAccess: jest.fn(),
}));

import { deleteFolder } from '@/lib/services/folderService';

const FOLDER_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';
const LIB_ID = '33333333-3333-4333-8333-333333333333';

type EqCall = { column: string; value: unknown };

function makeSupabase(options: {
  childFolders?: Array<{ id: string }>;
  libraries?: Array<{ id: string }>;
  documents?: Array<{ id: string }>;
}) {
  const deletes: Array<{ table: string; eqs: EqCall[]; ins?: unknown }> = [];

  const from = jest.fn((table: string) => {
    const state: { eqs: EqCall[]; ins?: unknown; action: 'select' | 'delete' } = {
      eqs: [],
      action: 'select',
    };

    const builder: Record<string, unknown> = {};
    const resolveSelect = () => {
      if (table === 'folders' && state.eqs.some((e) => e.column === 'parent_folder_id')) {
        return Promise.resolve({ data: options.childFolders ?? [], error: null });
      }
      if (table === 'libraries' && state.eqs.some((e) => e.column === 'folder_id')) {
        return Promise.resolve({ data: options.libraries ?? [], error: null });
      }
      if (table === 'documents' && state.eqs.some((e) => e.column === 'folder_id')) {
        return Promise.resolve({ data: options.documents ?? [], error: null });
      }
      if (table === 'folders' && state.eqs.some((e) => e.column === 'id')) {
        return Promise.resolve({
          data: {
            id: FOLDER_ID,
            project_id: '44444444-4444-4444-8444-444444444444',
            parent_folder_id: null,
            name: 'GDS Folder',
            description: null,
            created_at: '',
            updated_at: '',
            updated_by: null,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    };

    builder.select = jest.fn(() => {
      state.action = 'select';
      return builder;
    });
    builder.delete = jest.fn(() => {
      state.action = 'delete';
      return builder;
    });
    builder.in = jest.fn((column: string, values: unknown[]) => {
      state.ins = { column, values };
      deletes.push({ table, eqs: [...state.eqs], ins: state.ins });
      return Promise.resolve({ error: null });
    });
    builder.eq = jest.fn((column: string, value: unknown) => {
      state.eqs.push({ column, value });
      if (state.action === 'delete' && !state.ins) {
        deletes.push({ table, eqs: [...state.eqs] });
        return Promise.resolve({ error: null });
      }
      const thenable = {
        eq: builder.eq,
        single: () =>
          resolveSelect().then((r) => {
            if (Array.isArray(r.data)) {
              return {
                data: r.data[0] ?? null,
                error: r.data[0] ? null : { message: 'not found' },
              };
            }
            return r;
          }),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          resolveSelect().then(resolve, reject),
      };
      return thenable;
    });
    builder.single = jest.fn(() =>
      resolveSelect().then((r) => {
        if (Array.isArray(r.data)) {
          return { data: r.data[0] ?? null, error: null };
        }
        return r;
      })
    );

    return builder;
  });

  return { supabase: { from } as never, deletes, from };
}

describe('deleteFolder document cascade', () => {
  it('deletes documents that live in the folder before removing the folder', async () => {
    const { supabase, deletes } = makeSupabase({
      childFolders: [],
      libraries: [{ id: LIB_ID }],
      documents: [{ id: DOC_ID }],
    });

    await deleteFolder(supabase, FOLDER_ID);

    const documentDelete = deletes.find(
      (d) =>
        d.table === 'documents' &&
        (d.ins as { column: string; values: string[] } | undefined)?.values?.includes(DOC_ID)
    );
    expect(documentDelete).toBeDefined();

    const folderDeleteIndex = deletes.findIndex(
      (d) =>
        d.table === 'folders' &&
        d.eqs.some((e) => e.column === 'id' && e.value === FOLDER_ID)
    );
    const documentDeleteIndex = deletes.findIndex(
      (d) =>
        d.table === 'documents' &&
        (d.ins as { column: string; values: string[] } | undefined)?.values?.includes(DOC_ID)
    );
    expect(documentDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(documentDeleteIndex).toBeLessThan(folderDeleteIndex);
  });
});
