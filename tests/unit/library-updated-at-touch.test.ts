import { describe, expect, it } from '@jest/globals';
import {
  touchLibraryAssetEditUpdatedAt,
  touchLibraryUpdatedAt,
} from '@/lib/library/updatedAt';

describe('touchLibraryAssetEditUpdatedAt', () => {
  it('uses a single RPC round-trip and returns the server updated_at', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const supabase = {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return { data: '2026-07-07T10:00:00.000Z', error: null };
      },
    };

    await expect(
      touchLibraryAssetEditUpdatedAt(supabase, {
        assetId: 'asset-1',
        libraryId: 'library-1',
      })
    ).resolves.toBe('2026-07-07T10:00:00.000Z');

    expect(calls).toEqual([
      {
        name: 'touch_library_asset_edit_updated_at',
        args: { p_asset_id: 'asset-1', p_library_id: 'library-1' },
      },
    ]);
  });
});

describe('touchLibraryUpdatedAt', () => {
  it('updates library metadata and cascades to parent project and folder', async () => {
    const calls: Array<{
      table: string;
      values?: Record<string, unknown>;
      eq?: [string, unknown];
      select?: string;
      single?: boolean;
    }> = [];

    const createBuilder = (table: string) => {
      const call: {
        table: string;
        values?: Record<string, unknown>;
        eq?: [string, unknown];
        select?: string;
        single?: boolean;
      } = { table };
      calls.push(call);

      const selectedBuilder = {
        single: async () => {
          call.single = true;
          return {
            data: {
              folder_id: 'folder-1',
              project_id: 'project-from-library',
            },
            error: null,
          };
        },
        then: undefined,
      };

      const filterBuilder = {
        eq: (column: string, value: unknown) => {
          call.eq = [column, value];
          return filterBuilder;
        },
        select: (columns: string) => {
          call.select = columns;
          return selectedBuilder;
        },
        then: (resolve: (value: { data: null; error: null }) => void) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };

      return {
        update: (values: Record<string, unknown>) => {
          call.values = values;
          return filterBuilder;
        },
      };
    };

    const supabase = {
      from: (table: string) => createBuilder(table),
    };

    await touchLibraryUpdatedAt(supabase, 'library-1');

    expect(calls.map((call) => call.table)).toEqual(['libraries', 'projects', 'folders']);
    expect(calls[0]).toMatchObject({
      table: 'libraries',
      eq: ['id', 'library-1'],
      select: 'folder_id, project_id',
      single: true,
    });
    expect(calls[1]).toMatchObject({
      table: 'projects',
      eq: ['id', 'project-from-library'],
    });
    expect(calls[2]).toMatchObject({
      table: 'folders',
      eq: ['id', 'folder-1'],
    });
  });
});
