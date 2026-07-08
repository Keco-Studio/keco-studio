import { describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureDefaultLibraryField } from '@/lib/services/libraryAssetsService';

type InsertPayload = {
  library_id: string;
  section_id: string;
  section: string;
  label: string;
  data_type: string;
  order_index: number;
  required: boolean;
};

type QueryCall = {
  table: string;
  operation: 'insert' | 'select';
  payload?: InsertPayload;
  filters: Array<[string, unknown]>;
};

function createSupabaseFake(): { supabase: SupabaseClient; calls: QueryCall[] } {
  const calls: QueryCall[] = [];

  const supabase = {
    from: (table: string) => ({
      insert: (payload: InsertPayload) => {
        const call: QueryCall = { table, operation: 'insert', payload, filters: [] };
        calls.push(call);
        return {
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '23505',
                message:
                  'duplicate key value violates unique constraint "library_field_definitions_section_id_order_key"',
              },
            }),
          }),
        };
      },
      select: () => {
        const call: QueryCall = { table, operation: 'select', filters: [] };
        calls.push(call);
        const builder = {
          eq: (column: string, value: unknown) => {
            call.filters.push([column, value]);
            return builder;
          },
          order: () => builder,
          limit: () => ({
            maybeSingle: async () => ({
              data: { id: 'existing-default-field' },
              error: null,
            }),
          }),
        };
        return builder;
      },
    }),
  };

  return { supabase: supabase as unknown as SupabaseClient, calls };
}

describe('ensureDefaultLibraryField', () => {
  it('reuses the existing default field when concurrent initialization hits the order constraint', async () => {
    const { supabase, calls } = createSupabaseFake();

    await expect(ensureDefaultLibraryField(supabase, 'library-1')).resolves.toEqual({
      fieldId: 'existing-default-field',
      created: false,
    });

    expect(calls).toEqual([
      {
        table: 'library_field_definitions',
        operation: 'insert',
        payload: {
          library_id: 'library-1',
          section_id: 'library-1:section1',
          section: 'section1',
          label: 'ID',
          data_type: 'string',
          order_index: 0,
          required: false,
        },
        filters: [],
      },
      {
        table: 'library_field_definitions',
        operation: 'select',
        filters: [
          ['library_id', 'library-1'],
          ['section_id', 'library-1:section1'],
          ['order_index', 0],
        ],
      },
    ]);
  });
});
