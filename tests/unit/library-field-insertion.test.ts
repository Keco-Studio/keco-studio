import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { insertLibraryFieldAfter } from '@/lib/services/libraryAssetsService';

jest.mock('@/lib/services/authorizationService', () => ({}));
jest.mock('@/lib/services/referenceSyncService', () => ({
  syncReferencesForSourceChanges: jest.fn(),
}));

describe('library field insertion', () => {
  it('inserts a field immediately after the requested field through one RPC', async () => {
    const rpc = jest.fn(async () => ({ data: 'new-field-id', error: null }));
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(insertLibraryFieldAfter(supabase, 'library-1', 'field-1', {
      label: 'Inserted field',
      dataType: 'string',
    })).resolves.toEqual({ id: 'new-field-id' });

    expect(rpc).toHaveBeenCalledWith('insert_library_field_after', {
      p_library_id: 'library-1',
      p_after_field_id: 'field-1',
      p_label: 'Inserted field',
      p_data_type: 'string',
      p_description: null,
      p_required: false,
      p_enum_options: null,
      p_reference_libraries: null,
      p_formula_expression: null,
    });
  });
});
