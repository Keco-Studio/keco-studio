import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

const deleteLibraryField = jest.fn();
jest.mock('@/lib/services/libraryAssetsService', () => ({
  deleteLibraryField: (...args: unknown[]) => deleteLibraryField(...args),
}));

import { removeUnusedDefaultIdField } from '@/lib/agent/default-id-cleanup';

const supabase = {} as SupabaseClient;
const idField: PropertyConfig = {
  id: 'id-field',
  key: 'id-field',
  name: 'ID',
  valueType: 'string',
  dataType: 'string',
  required: false,
  orderIndex: 0,
};
const businessField: PropertyConfig = {
  id: 'type-field',
  key: 'type-field',
  name: 'Cat Type',
  valueType: 'string',
  dataType: 'string',
  required: false,
  orderIndex: 1,
};
const blankRows: AssetRow[] = [{
  id: 'row-1',
  libraryId: 'library-1',
  name: '',
  propertyValues: { 'id-field': '' },
}];

describe('removeUnusedDefaultIdField', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes and returns the removed field id', async () => {
    deleteLibraryField.mockResolvedValue(undefined);

    await expect(removeUnusedDefaultIdField(
      supabase,
      'library-1',
      [idField, businessField],
      blankRows,
      { 'Cat Type': 'Sick Cat' }
    )).resolves.toEqual({ removed: true, fieldId: 'id-field' });
    expect(deleteLibraryField).toHaveBeenCalledWith(supabase, 'library-1', 'id-field');
  });

  it('does not call delete when the field is not disposable', async () => {
    await expect(removeUnusedDefaultIdField(
      supabase,
      'library-1',
      [idField],
      blankRows,
      {}
    )).resolves.toEqual({ removed: false });
    expect(deleteLibraryField).not.toHaveBeenCalled();
  });

  it('propagates deletion failure so the row write stops', async () => {
    deleteLibraryField.mockRejectedValue(new Error('delete denied'));

    await expect(removeUnusedDefaultIdField(
      supabase,
      'library-1',
      [idField, businessField],
      blankRows,
      { 'Cat Type': 'Sick Cat' }
    )).rejects.toThrow('delete denied');
  });
});
