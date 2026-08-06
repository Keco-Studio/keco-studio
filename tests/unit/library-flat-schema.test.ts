import { describe, expect, it } from '@jest/globals';
import {
  addLibraryField,
  getLibrarySchema,
} from '@/lib/services/libraryAssetsService';
import { orderProperties } from '@/components/libraries/utils/tableStructure';
import type { PropertyConfig } from '@/lib/types/libraryAssets';

const property = (id: string, name: string, orderIndex: number): PropertyConfig => ({
  id,
  key: id,
  name,
  valueType: 'string',
  dataType: 'string',
  orderIndex,
});

describe('flat library schema API', () => {
  it('orders all properties by global order index and id', () => {
    expect(orderProperties([
      property('third', 'Third', 2),
      property('first', 'First', 0),
      property('second', 'Second', 1),
    ]).map((item) => item.id)).toEqual(['first', 'second', 'third']);
  });

  it('exports flat schema and field creation APIs', () => {
    expect(getLibrarySchema).toBeDefined();
    expect(addLibraryField).toBeDefined();
  });
});
