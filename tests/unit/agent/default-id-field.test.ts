import {
  findUnusedDefaultIdField,
  isDefaultIdFieldShape,
} from '@/lib/agent/default-id-field';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

const defaultId: PropertyConfig = {
  id: 'id-field',
  key: 'id-field',
  name: 'ID',
  valueType: 'string',
  dataType: 'string',
  required: false,
  orderIndex: 0,
};

const typeField: PropertyConfig = {
  id: 'type-field',
  key: 'type-field',
  name: 'Cat Type',
  valueType: 'string',
  dataType: 'string',
  required: false,
  orderIndex: 1,
};

const row = (idValue: unknown): AssetRow => ({
  id: 'row-1',
  libraryId: 'library-1',
  name: '',
  propertyValues: { 'id-field': idValue },
});

describe('isDefaultIdFieldShape', () => {
  it('recognizes only the optional first string field named ID', () => {
    expect(isDefaultIdFieldShape(defaultId)).toBe(true);
    expect(isDefaultIdFieldShape({ ...defaultId, name: 'Identifier' })).toBe(false);
    expect(isDefaultIdFieldShape({ ...defaultId, dataType: 'int' })).toBe(false);
    expect(isDefaultIdFieldShape({ ...defaultId, required: true })).toBe(false);
    expect(isDefaultIdFieldShape({ ...defaultId, orderIndex: 1 })).toBe(false);
  });
});

describe('findUnusedDefaultIdField', () => {
  it.each([null, undefined, '', '   ', []])(
    'returns a default ID with empty value %p when another business field exists',
    (emptyValue) => {
      expect(
        findUnusedDefaultIdField(
          [defaultId, typeField],
          [row(emptyValue)],
          { 'Cat Type': 'Sick Cat' }
        )
      ).toBe(defaultId);
    }
  );

  it('preserves a populated ID field', () => {
    expect(
      findUnusedDefaultIdField(
        [defaultId, typeField],
        [row('CAT-001')],
        { 'Cat Type': 'Sick Cat' }
      )
    ).toBeUndefined();
  });

  it.each([
    { ID: 'CAT-001' },
    { iD: 'CAT-001' },
    { 'id-field': 'CAT-001' },
    { item: { ID: 'CAT-001' } },
  ])('preserves ID when the incoming values explicitly contain it: %p', (values) => {
    expect(
      findUnusedDefaultIdField([defaultId, typeField], [row('')], values)
    ).toBeUndefined();
  });

  it('preserves the only field in a table', () => {
    expect(findUnusedDefaultIdField([defaultId], [row('')], {})).toBeUndefined();
  });

  it('preserves fields that do not have the default shape', () => {
    expect(
      findUnusedDefaultIdField(
        [{ ...defaultId, name: 'Identifier' }, typeField],
        [row('')],
        { 'Cat Type': 'Sick Cat' }
      )
    ).toBeUndefined();
  });
});
