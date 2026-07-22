import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyLibraryCreationPermission } from '@/lib/services/authorizationService';
import { importLibraryFromFile } from '@/lib/services/importService';
import { parseWorkbookRows } from '@/lib/utils/workbook';

jest.mock('@/lib/services/authorizationService', () => ({
  verifyLibraryCreationPermission: jest.fn(),
}));

jest.mock('@/lib/utils/workbook', () => ({
  parseWorkbookRows: jest.fn(),
}));

const verifyPermissionMock = verifyLibraryCreationPermission as jest.MockedFunction<
  typeof verifyLibraryCreationPermission
>;
const parseWorkbookRowsMock = parseWorkbookRows as jest.MockedFunction<typeof parseWorkbookRows>;

describe('spreadsheet import batching (issue #224)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('inserts all field definitions in one request', async () => {
    verifyPermissionMock.mockResolvedValue(undefined);
    parseWorkbookRowsMock.mockResolvedValue([
      { name: 'Characters', rows: [['Name', 'Role', 'Bio']] },
      { name: 'Locations', rows: [['Name', 'Region']] },
    ]);

    const fieldInsertCalls: unknown[] = [];
    const supabase = {
      from: (table: string) => {
        let inserted: unknown;
        const builder = {
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          // Keep the builder chainable; name uniqueness checks call .eq/.is after .limit(1).
          limit: () => builder,
          insert: (rows: unknown) => {
            inserted = rows;
            if (table === 'library_field_definitions') fieldInsertCalls.push(rows);
            return builder;
          },
          single: async () => {
            if (table === 'folders') {
              return { data: { id: 'folder', project_id: 'project-1' }, error: null };
            }
            if (table === 'libraries') {
              return { data: { id: 'library-1' }, error: null };
            }
            if (table === 'library_field_definitions') {
              return { data: { id: `field-${fieldInsertCalls.length}` }, error: null };
            }
            throw new Error(`Unexpected single() for ${table}`);
          },
          then: (
            resolve: (value: { data: unknown[]; error: null }) => void,
            reject?: (reason: unknown) => void
          ) => {
            if (inserted === undefined) {
              return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            }
            const rows = Array.isArray(inserted) ? inserted : [];
            return Promise.resolve({
              data: rows.map((_, index) => ({ id: `field-${index}` })),
              error: null,
            }).then(resolve, reject);
          },
        };
        return builder;
      },
    } as unknown as SupabaseClient;

    const result = await importLibraryFromFile(supabase, {
      userId: 'user-1',
      projectId: 'project-1',
      folderId: '00000000-0000-4000-8000-000000000001',
      libraryName: 'World bible',
      fileBuffer: Buffer.from('workbook'),
      fileName: 'world.xlsx',
    });

    expect(fieldInsertCalls).toHaveLength(1);
    expect(fieldInsertCalls[0]).toHaveLength(5);
    expect(result.fieldCount).toBe(5);
  });
});
